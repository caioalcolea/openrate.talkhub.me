# Runbook de deploy — stack `openrate` (Docker Swarm / Portainer)

Passo a passo para colocar o OpenRate em produção na rede overlay `talkhub`,
reaproveitando `supabase_db` (Postgres), `supabase_auth` (gotrue), MinIO,
Evolution API e Browserless. Todos os comandos são executados no nó manager,
salvo indicação contrária.

Arquivos usados:

- `deploy/openrate.yaml` — stack para colar no Portainer
- `deploy/.env.example` — referência das variáveis de ambiente da stack
- `db/migrations/0001_init.sql` — migration inicial do schema `openrate`

---

## 1. Pré-requisitos de DNS

Criar os três registros apontando para o IP público do servidor (mesmo IP dos
demais serviços `*.talkhub.me`). Pode ser registro A direto ou CNAME para
`talkhub.me`:

| Host | Tipo | Destino |
|---|---|---|
| `openrate.talkhub.me` | A (ou CNAME) | IP do servidor |
| `openrate-api.talkhub.me` | A (ou CNAME) | IP do servidor |
| `openrate-queues.talkhub.me` | A (ou CNAME) | IP do servidor |

Validar a propagação antes de seguir (o Let's Encrypt do Traefik precisa
resolver os hosts):

```bash
dig +short openrate.talkhub.me
dig +short openrate-api.talkhub.me
dig +short openrate-queues.talkhub.me
```

Os três devem retornar o IP do servidor.

## 2. Criar o volume do Redis dedicado

O yaml referencia o volume como `external: true`, então ele precisa existir
antes do deploy:

```bash
docker volume create openrate_redis_data
```

Conferir que não colide com nada existente:

```bash
docker volume ls | grep openrate
```

## 3. Criar role e schema no Postgres do Supabase + aplicar migrations

Tudo dentro do container `supabase_db` (Postgres 15.8). **Não tocar nos
schemas `auth`, `storage` e `public` do Supabase.**

3.1. Abrir o psql no container (filtro ANCORADO ao nome de task do Swarm —
`name=supabase_db` sem âncora é substring e pode casar com outro container):

```bash
CID=$(docker ps -q -f name='^supabase_db\.')
docker ps --format '{{.Names}}' -f name='^supabase_db\.'   # conferir: exatamente 1 linha
docker exec -it "$CID" psql -U postgres -d postgres
```

3.2. Criar as DUAS roles e o schema. O modelo de segurança exige separação:
`openrate_owner` (migração) é DONA do schema e dos objetos; `openrate_app`
(runtime, usada pela API/worker) **não é dona de nada** — é isso que faz o
`FORCE ROW LEVEL SECURITY` valer para ela e impede que um bug/SQLi na
aplicação desabilite o RLS com `ALTER TABLE`:

```sql
-- Role de MIGRAÇÃO: dona do schema; usada só por psql/dbmate para aplicar DDL
CREATE ROLE openrate_owner LOGIN PASSWORD 'TROQUE_SENHA_OWNER'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  CONNECTION LIMIT 3;

-- Role de APLICAÇÃO (runtime): senha vai em OPENRATE_DB_PASSWORD
CREATE ROLE openrate_app LOGIN PASSWORD 'TROQUE_ESTA_SENHA'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 20;

-- Schema dedicado. No supabase_db o "postgres" NÃO é superuser e o supautils
-- bloqueia `CREATE SCHEMA ... AUTHORIZATION <role>` e `SET ROLE`. Então o schema é
-- criado pelo postgres (fica dono do schema) e concedemos CREATE/USAGE ao owner,
-- que cria as TABELAS conectando direto — as tabelas ficam do owner, que é o que
-- importa p/ o FORCE RLS.
CREATE SCHEMA IF NOT EXISTS openrate;
GRANT USAGE, CREATE ON SCHEMA openrate TO openrate_owner;
GRANT USAGE ON SCHEMA openrate TO openrate_app;

-- search_path fixado no nível das roles (a DATABASE_URL não precisa de parâmetro)
ALTER ROLE openrate_owner SET search_path = openrate;
ALTER ROLE openrate_app   SET search_path = openrate;

-- Defesa em profundidade: a role de runtime não cria objetos no public
REVOKE CREATE ON SCHEMA public FROM openrate_app;
```

Sair com `\q`.

3.3. Aplicar a migration inicial (SQL puro, com RLS/policies/triggers).
`--single-transaction` é obrigatório: falha no meio faz rollback total em vez
de deixar o schema meio-criado no banco compartilhado:

O arquivo traz marcadores dbmate `-- migrate:up` / `-- migrate:down`; no path
psql corte o bloco `down` (senão o `DROP SCHEMA` ao final desfaz tudo). O `sed`
é **ancorado em início de linha** (`^`) para casar só o marcador real, e não as
menções a `-- migrate:down` que aparecem no comentário de cabeçalho do arquivo:

```bash
# openrate_owner conecta DIRETO (TCP + senha), sem SET ROLE. Troque a senha.
sed '/^-- migrate:down/,$d' db/migrations/0001_init.sql \
  | docker exec -e PGPASSWORD='TROQUE_SENHA_OWNER' -i "$CID" \
      psql -h 127.0.0.1 -U openrate_owner -d postgres -v ON_ERROR_STOP=1 --single-transaction -f -
```

(No `supabase_db` o papel `postgres` **NÃO é superuser** (é `CREATEROLE`) e o
`supautils` do Supabase ENCERRA a conexão em `SET ROLE` e em `GRANT <role> TO
postgres`. Por isso NÃO se usa `SET ROLE` nem `CREATE SCHEMA ... AUTHORIZATION`:
as migrations rodam com `openrate_owner` **conectando direto** — TCP + senha, a
mesma via do app. O que **não** pode é aplicar migrations como `openrate_app`.)

Alternativa com dbmate (versionamento contínuo das migrations), rodando na
própria rede `talkhub`. Atenção: conectar como `openrate_owner` (NUNCA
`openrate_app`) e fixar a tabela de controle dentro do schema `openrate` para
o dbmate não criar `schema_migrations` no `public` do Supabase. O arquivo
`0001_init.sql` já contém os marcadores `-- migrate:up` / `-- migrate:down`:

```bash
docker run --rm --network talkhub -v "$PWD/db:/db" ghcr.io/amacneil/dbmate:2 \
  --url "postgresql://openrate_owner:TROQUE_SENHA_OWNER@supabase_db:5432/postgres?sslmode=disable" \
  --migrations-table openrate.schema_migrations up
```

3.3.1. Aplicar `0002` e `0003` **como `openrate_owner` conectando direto** (sem
`SET ROLE`, que o supautils bloqueia). A `0002` cria uma policy só-para-o-owner em
`affiliate_links` (a função `SECURITY DEFINER` roda como o owner) e a `0003`
suspende o FORCE só durante o seed de `video_types` globais (org NULL) e o
restaura. **O caminho dbmate acima NÃO serve p/ estas duas**:

```bash
for m in 0002_affiliate_link_resolver 0003_seed_video_types; do
  sed '/^-- migrate:down/,$d' "db/migrations/$m.sql" \
    | docker exec -e PGPASSWORD='TROQUE_SENHA_OWNER' -i "$CID" \
        psql -h 127.0.0.1 -U openrate_owner -d postgres -v ON_ERROR_STOP=1 --single-transaction -f -
done
```

> Atalho: `deploy/first-up.sh` já faz os passos 2–7 (roles, schema, 0001/0002/0003
> como owner, bucket, build, deploy) de forma idempotente.

3.4. Smoke test da role (deve conectar e enxergar o schema `openrate`):

```bash
docker run --rm --network talkhub postgres:15-alpine \
  psql "postgresql://openrate_app:TROQUE_ESTA_SENHA@supabase_db:5432/postgres" \
  -c "SELECT current_user, current_schemas(false);"
```

## 4. Criar bucket, lifecycle e usuário dedicado no MinIO

Usar o cliente `mc` em um container temporário na rede `talkhub`:

```bash
docker run --rm -it --network talkhub --entrypoint /bin/sh quay.io/minio/mc
```

Dentro do container:

```sh
# 4.1. Alias apontando para o MinIO interno (root user "Admin")
mc alias set talkhub http://minio_minio:9000 Admin 'SENHA_ROOT_DO_MINIO'

# 4.2. Bucket dedicado (região eu-south já é o default do servidor)
mc mb talkhub/openrate-media

# 4.3. Bucket privado — acesso somente via credenciais/presigned URLs
mc anonymous set none talkhub/openrate-media

# 4.4. Lifecycle: expirar uploads brutos (raw/) após 30 dias
mc ilm rule add talkhub/openrate-media --prefix "raw/" --expire-days 30
mc ilm rule ls talkhub/openrate-media

# 4.5. Usuário dedicado (NUNCA usar o root Admin na aplicação)
mc admin user add talkhub openrate-app 'TROQUE_PELA_S3_SECRET_KEY'

# 4.6. Policy restrita ao bucket openrate-media
cat > /tmp/openrate-media-rw.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": ["arn:aws:s3:::openrate-media"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": ["arn:aws:s3:::openrate-media/*"]
    }
  ]
}
EOF
mc admin policy create talkhub openrate-media-rw /tmp/openrate-media-rw.json
mc admin policy attach talkhub openrate-media-rw --user openrate-app

exit
```

Os prefixos `raw/` (upload bruto via presigned multipart no endpoint público
`https://bucketss3.talkhub.me`), `final/` (vídeo editado) e `thumbs/` são
criados implicitamente pelos uploads — não é preciso criar "pastas".

4.7. **CORS** — como o atendente é um PWA, o upload multipart parte do
**navegador** (origem `https://openrate.talkhub.me`) direto para
`https://bucketss3.talkhub.me`. O MinIO responde CORS liberado por padrão
(`MINIO_API_CORS_ALLOW_ORIGIN=*`); validar o preflight sem alterar nenhuma
config global do MinIO:

```bash
curl -sSI -X OPTIONS "https://bucketss3.talkhub.me/openrate-media/raw/teste" \
  -H "Origin: https://openrate.talkhub.me" \
  -H "Access-Control-Request-Method: PUT" | grep -i access-control
# esperado: Access-Control-Allow-Origin presente (e ETag exposto nos headers)
```

Se a stack do MinIO tiver restringido `MINIO_API_CORS_ALLOW_ORIGIN`, adicionar
a origem `https://openrate.talkhub.me` é uma **decisão de infraestrutura
global** (afeta a stack minio) — alinhar antes, não editar por conta própria.

## 5. Build das imagens no servidor

Mesmo fluxo dos outros projetos `talkhub/*` (build local no manager, sem
registry externo). Tagueie também com o SHA do git para permitir rollback:

```bash
cd /opt/apps/openrate   # clone do repositório da aplicação
git pull
SHA=$(git rev-parse --short HEAD)

docker build -t talkhub/openrate-api:latest       -t talkhub/openrate-api:$SHA       -f apps/api/Dockerfile .
docker build -t talkhub/openrate-worker:latest    -t talkhub/openrate-worker:$SHA    -f apps/worker/Dockerfile .
docker build -t talkhub/openrate-web:latest       -t talkhub/openrate-web:$SHA       -f apps/web/Dockerfile .
docker build -t talkhub/openrate-bullboard:latest -t talkhub/openrate-bullboard:$SHA -f apps/bullboard/Dockerfile .

docker image ls | grep talkhub/openrate
```

Observações:

- A imagem do worker precisa conter `ffmpeg`, `faster-whisper` (CPU) e o
  script `dist/healthcheck.js` (usado pelo healthcheck do yaml — faz PING no
  Redis e `SELECT 1` no Postgres).
- Os healthchecks de api/web/bullboard usam `node -e "fetch(...)"` — exigem
  **Node >= 18** na imagem final (fetch nativo), mas não dependem de
  `wget`/`curl`, então qualquer base (alpine ou debian-slim) serve.
- A imagem do bullboard é um Express mínimo com `@bull-board/express` lendo
  as filas do `REDIS_URL` (porta 3000).
- `NEXT_PUBLIC_API_URL` é *build-time* no Next.js: passe como `--build-arg`
  no build da web se o Dockerfile exigir.

## 6. Gerar o BULLBOARD_BASICAUTH

```bash
sudo apt-get install -y apache2-utils   # se htpasswd não existir
htpasswd -nbB openrate 'SUA_SENHA_FORTE'
# saída ex.: openrate:$2y$05$abcdefghijk...
```

- **Via env var do Portainer (fluxo deste runbook):** cole a saída CRUA em
  `BULLBOARD_BASICAUTH` (com `$` simples). A interpolação do compose acontece
  uma única vez e não reprocessa o valor da variável.
- **Somente se for hardcodar o hash direto no yaml** (não recomendado),
  duplique os cifrões para escapar do compose:

```bash
htpasswd -nbB openrate 'SUA_SENHA_FORTE' | sed -e 's/\$/\$\$/g'
```

## 7. Deploy via Portainer

1. Portainer → **Stacks** → **Add stack**.
2. Nome da stack: **`openrate`** (padrão do servidor). As chaves de serviço do
   yaml já são prefixadas (`openrate_api`, `openrate_redis`, ...), então os
   nomes COMPLETOS dos serviços ficam `openrate_openrate_api`,
   `openrate_openrate_redis` etc. — mesmo padrão de `evolution_evolution_api`
   e `chatwoot_chatwoot_app`. O DNS interno usado no yaml é o alias curto
   (`openrate_redis`), que funciona qualquer que seja o nome da stack.
3. **Web editor** → colar o conteúdo de `deploy/openrate.yaml`.
4. Em **Environment variables**, preencher todas as variáveis conforme
   `deploy/.env.example`:
   `OPENRATE_DB_PASSWORD`, `OPENRATE_REDIS_PASSWORD`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
   `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `ANTHROPIC_API_KEY`, `ASAAS_API_KEY`,
   `ASAAS_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`,
   `BULLBOARD_BASICAUTH`.
5. **Deploy the stack**.
6. Acompanhar:

```bash
docker service ls | grep openrate
docker service ps openrate_openrate_api --no-trunc
docker service logs -f openrate_openrate_api
docker service logs -f openrate_openrate_worker
```

Todos os serviços devem ficar `1/1` com healthcheck `healthy`.

## 8. Smoke tests

```bash
# 8.1. API de pé com TLS válido
curl -sS https://openrate-api.talkhub.me/health
# esperado: {"status":"ok", ...}

# 8.2. Painel web
curl -sSI https://openrate.talkhub.me | head -5
# esperado: HTTP/2 200

# 8.3. Bull Board protegido: sem credencial = 401, com credencial = 200
curl -sSI https://openrate-queues.talkhub.me | head -1          # HTTP/2 401
curl -sSI -u openrate:SUA_SENHA_FORTE https://openrate-queues.talkhub.me | head -1  # HTTP/2 200

# 8.4. Login de teste (gotrue) — criar um usuário de teste via API admin e autenticar
curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"teste@talkhub.me","password":"SenhaDeTeste123"}'
# esperado: access_token JWT; a API deve aceitar esse token em rotas autenticadas

# 8.5. Upload de teste: pedir presigned URL à API e subir um arquivo pequeno
TOKEN="<access_token do passo 8.4>"
curl -sS -X POST https://openrate-api.talkhub.me/v1/uploads/presign \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"filename":"smoke.mp4","contentType":"video/mp4"}'
# usar a URL retornada (https://bucketss3.talkhub.me/...) com curl -X PUT --data-binary
# e conferir o objeto: mc ls talkhub/openrate-media/raw/
```

Verificar também no Bull Board se as filas `video-processing`,
`ai-script-generation`, `metrics-sync`, `commission-settlement`, `payout-pix`
e `notifications` aparecem registradas.

## 9. Rollback

**Aplicação (imagens):** as imagens são tagueadas com o SHA do git (passo 5).

- Via CLI (mais rápido):

```bash
docker service update --image talkhub/openrate-api:<SHA_ANTERIOR>       openrate_openrate_api
docker service update --image talkhub/openrate-worker:<SHA_ANTERIOR>    openrate_openrate_worker
docker service update --image talkhub/openrate-web:<SHA_ANTERIOR>       openrate_openrate_web
docker service update --image talkhub/openrate-bullboard:<SHA_ANTERIOR> openrate_openrate_bullboard
```

- Via Portainer: Stacks → openrate → Editor → trocar a tag da imagem →
  **Update the stack** (marcar *Re-pull image and redeploy* se aplicável).

**Banco (migrations):** com dbmate, reverter a última migration (conectar como
`openrate_owner`, nunca `openrate_app`, e apontar a mesma tabela de controle):

```bash
docker run --rm --network talkhub -v "$PWD/db:/db" ghcr.io/amacneil/dbmate:2 \
  --url "postgresql://openrate_owner:SENHA_OWNER@supabase_db:5432/postgres?sslmode=disable" \
  --migrations-table openrate.schema_migrations down
```

O `down` de `0001_init.sql` é `DROP SCHEMA openrate CASCADE` (recria do zero) —
reverter a migration inicial apaga TODOS os dados do OpenRate. Regra: só rode
`down` se a migration tiver bloco `-- migrate:down` testado. Migrations
destrutivas (DROP) devem ser precedidas de dump do schema:

```bash
docker exec "$CID" pg_dump -U postgres -n openrate -Fc -f /tmp/openrate-pre-rollback.dump postgres
docker cp "$CID":/tmp/openrate-pre-rollback.dump ./backups/
```

**Remoção completa da stack** (último recurso — não apaga volume nem schema):

```bash
docker stack rm openrate
# volume openrate_redis_data e schema openrate permanecem intactos
```

## 10. Checklist anti-conflito final

Antes de dar o deploy por concluído, confirmar:

- [ ] **Alias DNS curto sem colisão** na overlay `talkhub`: antes do deploy,
      confirmar que os aliases curtos usados no yaml não são de outra stack —
      `docker run --rm --network talkhub busybox nslookup openrate_redis` deve
      **falhar** (nome ainda não existe) antes do deploy e retornar 1 VIP depois.
      As chaves de serviço já são prefixadas (`openrate_*`) justamente para não
      colidir com aliases genéricos (`redis`, `api`, `web`) de outras stacks.
- [ ] **Zero `ports:` publicados** no yaml — todo o tráfego entra pelo Traefik
      (80/443). `docker service inspect openrate_openrate_api | grep -i publishedport`
      não deve retornar nada.
- [ ] **Routers/services Traefik únicos**, todos prefixados `openrate_`
      (`openrate_api`, `openrate_web`, `openrate_bullboard`,
      middleware `openrate_bullboard_auth`) — sem colisão com `minio_public`,
      `minio_console` ou routers de outras stacks:
      `docker service ls -q | xargs -n1 docker service inspect --format '{{json .Spec.Labels}}' | grep -o 'traefik.http.routers.[a-z_]*' | sort -u`
- [ ] **Hosts únicos**: `openrate.talkhub.me`, `openrate-api.talkhub.me` e
      `openrate-queues.talkhub.me` não são usados por nenhuma outra stack
      (subdomínios flat, sem sub-subdomínio).
- [ ] **Folga de recursos do nó**: `nproc`, `free -h` e `docker stats --no-stream`
      no manager antes do deploy — só prosseguir com ≥ ~4 vCPU e ~6 GiB livres em
      pico (a stack soma ~4,25 vCPU / ~5,25 GiB de limits de burst). Sem folga,
      reduzir o worker para 1,5 CPU / 2 GiB mantendo `video-processing`=1.
- [ ] **Volume novo**: apenas `openrate_redis_data` foi criado; nenhum volume
      de outra stack foi montado.
- [ ] **Redis correto**: `REDIS_URL` aponta para `openrate_redis:6379` (Redis
      dedicado com `noeviction`, `maxmemory 400mb` e `requirepass`) — nenhuma
      referência ao global `redis_redis`.
- [ ] **Banco isolado**: role de runtime `openrate_app` (NOBYPASSRLS, não-dona)
      sem privilégios em `public`, `auth` e `storage`; schema `openrate` de
      propriedade de `openrate_owner`; objetos criados apenas no schema `openrate`.
- [ ] **MinIO isolado**: aplicação usa o usuário `openrate-app` com policy
      restrita ao bucket `openrate-media`; lifecycle de 30 dias ativo em `raw/`.
- [ ] **Bull Board protegido**: `curl -I https://openrate-queues.talkhub.me`
      retorna 401 sem credenciais.
- [ ] **Limites de recursos** aplicados em todos os serviços (api 1cpu/1G,
      worker 2cpu/3G, web 0.5cpu/512M, redis 0.5cpu/512M, bullboard
      0.25cpu/256M) — `docker service inspect openrate_openrate_worker --format '{{.Spec.TaskTemplate.Resources.Limits}}'`.
- [ ] **Sem replicas extras**: todos os serviços `1/1` em `docker service ls`.
