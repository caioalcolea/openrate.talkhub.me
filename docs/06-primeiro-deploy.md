# 06 — Primeiro Deploy (passo a passo, do zero)

> Guia para colocar o OpenRate no ar pela **primeira vez** na VPS Talkhub, do
> `git clone` ao stack rodando. Assume Docker Swarm + Traefik + Portainer +
> Supabase + MinIO **já em produção** (o OpenRate só adiciona serviços novos).
> Complementa [`../deploy/runbook.md`](../deploy/runbook.md) (referência detalhada)
> e automatiza tudo em [`../deploy/first-up.sh`](../deploy/first-up.sh).

Resumo: **configurar o git → clonar → preencher `.env` → `bash deploy/first-up.sh`**.

---

## 1. Git na VPS (chave SSH com passphrase)

A chave já está na VPS. Como ela tem **passphrase**, carregue-a no `ssh-agent`
uma vez por sessão (assim o git não pede a senha a cada comando):

```bash
# inicia o agente e adiciona a chave (vai pedir a passphrase UMA vez)
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519          # ou o caminho da sua chave (id_rsa, etc.)

# valida o acesso ao GitHub (deve dizer "Hi caioalcolea! ...")
ssh -T git@github.com || true
```

> Dica: para não redigitar a passphrase a cada login, instale `keychain`
> (`apt-get install -y keychain`) e adicione ao `~/.bashrc`:
> `eval "$(keychain --eval --quiet ~/.ssh/id_ed25519)"`.

Clone o repositório **via SSH** (não HTTPS) e entre nele:

```bash
sudo mkdir -p /opt/apps && cd /opt/apps
git clone git@github.com:caioalcolea/openrate.talkhub.me.git
cd openrate.talkhub.me
git checkout claude/openrate-setup-analysis-yoz3ut   # branch de trabalho atual

# identidade do git (para commits/pull futuros)
git config user.name  "Deploy Talkhub"
git config user.email "deploy@talkhub.me"
```

Atualizações futuras: `git pull` (com o `ssh-agent` ativo) e rode o `first-up.sh`
de novo (ele é idempotente) para rebuildar/reimplantar.

---

## 2. Preencher o `.env`

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Preencha (ver comentários no arquivo). Os essenciais:

| Variável | O que é |
|---|---|
| `OPENRATE_DB_PASSWORD` | senha da role de runtime `openrate_app` (você escolhe) |
| `OPENRATE_DB_OWNER_PASSWORD` | senha da role de migração `openrate_owner` (você escolhe) |
| `OPENRATE_REDIS_PASSWORD` | senha do Redis dedicado (você escolhe) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` | da stack Supabase já em produção |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | credencial do usuário MinIO dedicado (o script cria com esses valores) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | root do MinIO em produção (o script usa p/ criar bucket/usuário) |
| `ANTHROPIC_API_KEY` | chave da Anthropic |
| `ASAAS_API_KEY` / `ASAAS_BASE_URL` | Asaas (pode ser sandbox no início) |
| `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | Evolution API (WhatsApp) |
| `BULLBOARD_BASICAUTH` | `htpasswd -nbB openrate 'SUA_SENHA'` — **entre aspas simples** no `.env` |

> ⚠️ Use senhas **alfanuméricas** (sem `@ : / #`): elas entram em URLs
> (`DATABASE_URL`, `REDIS_URL`) e no `--requirepass`. O `BULLBOARD_BASICAUTH`
> deve ficar entre aspas simples (o hash tem `$`).

Gerar o hash do Bull Board:

```bash
sudo apt-get install -y apache2-utils   # se htpasswd não existir
htpasswd -nbB openrate 'SUA_SENHA_FORTE'   # cole a saída (entre aspas) em BULLBOARD_BASICAUTH
```

---

## 3. Pré-requisitos que dependem de terceiros

Antes do deploy, garanta (fora do escopo do script — são recursos de terceiros):

1. **DNS** dos 3 hosts apontando para o IP da VPS (o Traefik precisa resolver
   para emitir o TLS): `openrate.talkhub.me`, `openrate-api.talkhub.me`,
   `openrate-queues.talkhub.me`.
2. **Traefik**: confirme os nomes reais do entrypoint e do certresolver. O yaml
   usa `websecure` e `letsencryptresolver` (padrão das outras stacks). Se forem
   diferentes no seu Traefik, ajuste `deploy/openrate.yaml`. Para conferir:
   ```bash
   docker service inspect traefik_traefik --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}' | tr ',' '\n' | grep -iE 'entrypoint|certresolver'
   ```
3. **Instância Evolution** `openrate` criada e conectada (número de WhatsApp),
   se for usar notificações no go-live (pode ser feito depois).

---

## 4. Subir tudo (um comando)

```bash
bash deploy/first-up.sh
```

O script é **idempotente** (pode rodar de novo com segurança) e faz, em ordem:

1. Pré-checagens (docker, manager do Swarm, `.env`, rede `talkhub`).
2. Confere DNS (só avisa).
3. Cria o volume `openrate_redis_data`.
4. **Postgres**: cria as roles `openrate_owner`/`openrate_app`, o schema
   `openrate` e aplica as migrations `0001`/`0002`/`0003` **como `openrate_owner`**
   (no supabase_db o `postgres` não é superuser; o script o torna membro de
   `openrate_owner` com `GRANT openrate_owner TO CURRENT_USER` e usa `SET ROLE`).
5. **MinIO**: cria o bucket `openrate-media`, a lifecycle de 30 dias em `raw/`,
   o usuário dedicado e a policy restrita.
6. **Build** das 4 imagens `talkhub/openrate-*` (tags `latest` + SHA do git).
7. `docker stack deploy openrate`.
8. Smoke tests (`/health`, Bull Board 401).

Ao final, os 5 serviços devem ficar `1/1`:

```bash
docker service ls | grep openrate
docker service logs -f openrate_openrate_api
```

> ⚠️ **Rodou `docker stack deploy` na mão (fora do `first-up.sh`)?** O
> `docker stack deploy` interpola os `${VAR}` a partir do ambiente do SHELL, NÃO
> lê o `deploy/.env` sozinho. Sem carregar o `.env` antes, TODOS os `${VAR}` viram
> string vazia — o Redis sobe com `--requirepass` vazio (erro fatal de config,
> 0/1) e a API aborta por segredos ausentes. Sempre carregue o env primeiro:
> ```bash
> cd <raiz-do-repo>
> set -a; . deploy/.env; set +a
> docker stack deploy -c deploy/openrate.yaml openrate
> ```
> (O `first-up.sh` já faz isso — prefira ele.)

### Alternativa: deploy pela UI do Portainer

Se preferir a UI (em vez do `docker stack deploy` do script), rode o `first-up.sh`
**até o passo 6** (ou os passos 3–6 do `deploy/runbook.md`) para preparar
infra + imagens, e então: Portainer → **Stacks → Add stack** → nome `openrate`
→ cole `deploy/openrate.yaml` → preencha as *Environment variables* (as mesmas
do `.env`, exceto as da seção "provisionamento") → **Deploy the stack**.

---

## 5. Pós-deploy (primeiro acesso)

O banco sobe **vazio**. A API usa **auth própria** (o gotrue compartilhado tem
login por e-mail desabilitado): ela guarda o hash da senha em `openrate.users` e
emite o próprio JWT HS256, assinado com `SUPABASE_JWT_SECRET`.

1. **Primeiro `super_admin`** — via endpoint público de primeiro acesso
   `POST /v1/auth/bootstrap` (auto-desabilita depois do 1º; chamadas seguintes → 409):
   ```bash
   curl -s -X POST https://openrate-api.talkhub.me/v1/auth/bootstrap \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@talkhub.me","password":"UMA_SENHA_FORTE","fullName":"Admin OpenRate"}'
   ```
   Retorna `access_token`/`refresh_token` (já autentica) e cria o super_admin
   (`organization_id` NULL) em `openrate.users`.
2. **Login** em `https://openrate.talkhub.me` com esse e-mail/senha → criar
   organização → criar lojas → convidar `owner`/`manager`/`attendant`. O convite
   (`POST /v1/users/invite`) cria o usuário em `openrate.users` com uma **senha
   temporária** (retornada na resposta) que o convidante repassa; o convidado troca depois.
3. **Atendente**: abre `https://openrate.talkhub.me`, faz login, "adiciona à
   tela inicial" (PWA) e começa a gravar.

---

## 6. Operação

- **Backup antes do 1º fechamento financeiro** (dados de comissão/payout):
  ```bash
  CID=$(docker ps -q -f name='^supabase_db\.')
  docker exec "$CID" pg_dump -U postgres -n openrate -Fc -f /tmp/openrate.dump postgres
  docker cp "$CID":/tmp/openrate.dump ./backups/
  ```
  Agende (cron) e leve uma cópia **para fora da VPS** (o MinIO está no mesmo disco).
- **Filas**: `https://openrate-queues.talkhub.me` (Bull Board, atrás de basicauth).
- **Rollback / remoção**: ver `deploy/runbook.md` §9.
- **Atualizar**: `git pull` + `bash deploy/first-up.sh` (rebuilda e reimplanta).
