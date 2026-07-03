# 01 — Análise Crítica da Especificação OpenRate (v1.0)

> Documento de análise técnica de `openrate-produto-e-stack.md`, com foco em viabilidade de implantação no ambiente real de produção (Docker Swarm, nó único manager, rede overlay `talkhub`). Cada lacuna identificada vem acompanhada de melhoria concreta. Este documento **não reabre decisões já fechadas** — apenas as valida, detalha ou corrige onde a spec está imprecisa.

---

## 1. O que está bom e deve ser mantido

| Decisão da spec | Por que está correta |
|---|---|
| **Redis dedicado para BullMQ com `maxmemory-policy=noeviction`** | Acerto crítico. O `redis_redis` compartilhado do servidor roda sem `noeviction`; sob pressão de memória o Redis descartaria chaves de jobs do BullMQ silenciosamente (jobs perdidos, locks corrompidos). A documentação do BullMQ exige `noeviction`. Instância própria (`openrate_redis`, `redis:7-alpine`, `appendonly yes`, volume externo `openrate_redis_data`) também isola blast radius: um `FLUSHALL` acidental ou um pico de uso de outro produto não derruba as filas do OpenRate. Manter. |
| **BullMQ em vez de Supabase Cron/Edge Functions** | Correto para o perfil de carga: jobs longos (FFmpeg pode levar minutos), retries com backoff, prioridade, concorrência controlada e observabilidade via Bull Board. Edge Functions do Supabase self-hosted têm timeout curto e nenhuma garantia de entrega. |
| **Descarte do MoneyPrinterV2 como dependência** | Correto pelos dois motivos citados: não atende ao caso de uso (vídeo 100% sintético vs. gravação humana guiada) e AGPL-3.0 contaminaria o SaaS fechado. Aproveitar apenas padrões conceituais é a postura certa. |
| **Reuso de Postgres/gotrue/MinIO/Traefik já em produção** | Evita duplicar infraestrutura pesada num nó único. A estratégia de schema dedicado + bucket dedicado + router novo é o jeito certo de coabitar (com as ressalvas de isolamento detalhadas na seção 2). |
| **Multi-tenancy com RLS + escopo de produto (`store`/`organization`/`platform`)** | O modelo de escopo com regra de comissão "mais específica vence" é um bom desenho de domínio. RLS como camada de defesa é correto — o problema é *como* a spec assume que ela funciona (ver 2.1). |
| **API + Worker em containers separados** | Essencial: o worker de FFmpeg/Whisper não pode competir por event loop nem por deploy com a API. Escala e reinicia de forma independente. |
| **Conectores de publicação como adapters plugáveis** | Isola a fragilidade das integrações com redes sociais (APIs que mudam, aprovação de app pendente, scraping temporário) do core do produto. |
| **Upload resumível do app do atendente** | Direção certa (rede móvel em loja física é hostil); a spec só erra em não dizer *para onde* o upload vai — ver 2.3. Como o produto é 100% web (PWA, ver 2.13), o resumível é feito com multipart do MinIO direto do navegador, reenviando parte a parte. |
| **Credenciais de integração criptografadas (pgcrypto)** | Correto. `integrations.credentials` em texto plano seria inaceitável num banco compartilhado com outros produtos. |
| **Roadmap em 3 fases (MVP → Dinheiro → Escala)** | Sequenciamento correto: valida o loop de conteúdo antes de construir o motor financeiro, e deixa integrações frágeis (APIs de plataformas) para o fim. |

---

## 2. Lacunas e riscos técnicos (cada um com melhoria proposta)

### 2.1 RLS com `auth.jwt()` NÃO funciona em conexão direta da API — a spec ignora isso

**Problema.** A seção 2.6 da spec define a policy padrão como `organization_id = auth.jwt() ->> 'org_id'`. A função `auth.jwt()` do Supabase é apenas açúcar sobre `current_setting('request.jwt.claims', true)::jsonb` — e **quem popula esse setting é o PostgREST** (`supabase_rest`), a cada request, depois de validar o JWT. A API NestJS vai conectar **direto** em `supabase_db:5432` (via pool próprio), sem passar pelo PostgREST. Nessa conexão, `request.jwt.claims` está vazio, `auth.jwt()` retorna NULL e **toda policy RLS avalia como falso** — ou, pior, se a role de conexão tiver `BYPASSRLS` ou for dona das tabelas, as policies nem são aplicadas e o multi-tenant vira ilusão.

**Melhoria proposta (padrão obrigatório na API):**
1. Role `openrate_app` criada como `NOSUPERUSER NOBYPASSRLS`, e **não dona** das tabelas (dono = role de migração separada, ex.: `openrate_owner`), pois o owner de uma tabela ignora RLS por padrão a menos que se use `FORCE ROW LEVEL SECURITY` — usar `ALTER TABLE ... FORCE ROW LEVEL SECURITY` de todo modo, como cinto e suspensório.
2. Todo acesso a dados tenant-scoped abre transação e injeta os claims validados:
   ```sql
   BEGIN;
   SELECT set_config('request.jwt.claims',
     '{"sub":"<user_id>","org_id":"<org>","store_id":"<store>","role":"manager"}',
     true);  -- true = escopo de transação, não vaza para a próxima query do pool
   -- queries do request aqui
   COMMIT;
   ```
   O terceiro argumento `true` (is_local) é inegociável com pool de conexões (pgBouncer/supavisor ou pool do driver): sem ele, os claims de um request vazariam para o próximo request que reutilizar a conexão — cross-tenant leak clássico.
3. As policies passam a ler `current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'` diretamente (não depender de `auth.jwt()`, que vive no schema `auth` do Supabase e pode mudar entre versões).
4. **RLS é defesa em profundidade, não a única defesa.** A camada de serviço da API valida tenant explicitamente (guard/interceptor NestJS que compara `org_id` do JWT com o recurso acessado) e escreve `WHERE organization_id = $1` nas queries. Se alguém esquecer o `set_config`, o RLS bloqueia; se o RLS tiver um furo de policy, a query com filtro explícito segura.
5. Teste automatizado de regressão multi-tenant: suíte que autentica como org A e tenta ler/escrever recursos da org B por todos os endpoints.

### 2.2 gotrue não emite `org_id` no JWT "por mágica" — falta o fluxo de provisionamento

**Problema.** A spec diz "Supabase Auth (gotrue) — JWT com `org_id`" como se fosse comportamento nativo. Não é. O gotrue só serializa no JWT o que estiver em `app_metadata` (controlado pelo servidor) e `user_metadata` (controlado pelo usuário — **nunca** usar para autorização). Sem provisionamento explícito, o JWT sai sem `org_id`, `store_id` ou `role`, e tanto o RLS quanto os guards da API ficam cegos.

**Melhoria proposta — fluxo de provisionamento de usuário:**
1. `manager`/`owner` cadastra o atendente no painel → API NestJS chama a **Admin API do gotrue** (`POST /admin/users`, autenticada com `SUPABASE_SERVICE_ROLE_KEY`, host interno `supabase_auth`) criando o usuário já com `app_metadata: { org_id, store_id, role: "attendant" }`.
2. Convite por e-mail/WhatsApp (via Evolution API) com link de definição de senha (`invite` do gotrue ou magic link).
3. Mudança de role/loja = `PUT /admin/users/:id` atualizando `app_metadata`. Importante: o JWT antigo continua válido até expirar — definir `JWT_EXP` curto (15–60 min) com refresh token, e a API deve tratar remoção de acesso crítico (demissão) com denylist curta ou checagem de `users.active` no banco.
4. Alternativa suportada pelo gotrue ≥ 2.x: **Custom Access Token Hook** (hook Postgres/HTTP que enriquece claims na emissão do token). Vale considerar quando as claims precisarem de dados dinâmicos (ex.: lista de lojas em `user_stores`), mas para o MVP `app_metadata` via Admin API é mais simples e suficiente.
5. A API valida o JWT localmente com `SUPABASE_JWT_SECRET` (HS256) — sem round-trip ao gotrue por request.
6. Documentar a fonte de verdade: `app_metadata` carrega o *snapshot* de autorização; a tabela `users`/`user_stores` no schema `openrate` é a verdade relacional. Job de reconciliação se divergirem.

### 2.3 Upload de vídeo passando pela API seria gargalo — presigned multipart direto no MinIO

**Problema.** A spec fala em "upload resumível" mas não define o caminho. Se o vídeo bruto (100 MB–1 GB+, câmera de celular em 1080p/4K) trafegar `app → Traefik → openrate_api → MinIO`, três coisas quebram: (1) a API (1 CPU / 1 GB de limit) vira proxy de streaming e satura com poucos uploads simultâneos; (2) o Traefik mantém a conexão aberta durante todo o upload — em redes móveis lentas isso significa conexões de vários minutos sujeitas aos timeouts do proxy (`respondingTimeouts.readTimeout` e afins; em Traefik v3 o default de readTimeout é 60s, e qualquer estouro mata o upload no meio); (3) upload monolítico sem retomada = recomeçar 800 MB do zero quando o 4G da loja oscilar.

**Melhoria proposta:**
1. **Presigned multipart upload direto no MinIO**: a API expõe `POST /videos/:id/upload-session` que executa `CreateMultipartUpload` no bucket `openrate-media` e devolve URLs presigned por parte (5–16 MB cada), apontando para o endpoint público `https://bucketss3.talkhub.me`. O app envia as partes direto ao MinIO; ao final chama `POST /videos/:id/complete` e a API executa `CompleteMultipartUpload` e enfileira `video-processing`.
2. O vídeo **não passa pela API em nenhum byte**. Cada parte é uma request HTTP curta e independente — cabe folgadamente em qualquer timeout do Traefik, e parte que falhar é reenviada isoladamente (retomada nativa).
3. Chaves com prefixo e tenant no path: `raw/{org_id}/{video_id}/source.mp4`. Presign com expiração curta (15–60 min) e `Content-Length`/`Content-MD5` quando possível para impedir abuso da URL.
4. A spec cita bucket `openrate-videos`; a decisão fechada é **`openrate-media`** com prefixos `raw/`, `final/`, `thumbs/` — corrigir a spec para o nome único (um bucket, três prefixos, uma lifecycle rule — ver 2.8).
5. Validação pós-upload no worker (ffprobe: duração, codec, áudio presente) antes de gastar CPU com edição.

### 2.4 FFmpeg + Whisper no mesmo nó manager que roda TODA a produção — risco real de CPU starvation

**Problema.** O Swarm tem **um único nó**, que é manager e roda Traefik, Supabase inteiro, MySQL, Chatwoot, Evolution, djangocrm e mais uma dúzia de stacks. FFmpeg com preset default usa todos os cores disponíveis; faster-whisper em CPU idem. Dois vídeos processando em paralelo sem limite podem levar o load do nó a um ponto em que o Traefik degrada e **todos os produtos do servidor** sofrem — incluindo o heartbeat do próprio Swarm manager.

**Melhoria proposta (defesa em camadas):**
1. **Limits do Swarm no worker**: `deploy.resources.limits: { cpus: "2", memory: 3G }` (já decidido). Isso é teto duro via cgroups — o worker nunca passa de 2 cores mesmo que o FFmpeg peça mais.
2. **Concorrência do BullMQ = 1** na fila `video-processing` no MVP (no máximo 2 depois de medir). Um vídeo por vez; a fila absorve o burst, não a CPU.
3. **`ffmpeg -threads 2`** explícito (não confiar só no cgroup, que gera contenção interna) e execução do processo com `nice -n 10` / `ionice` dentro do container, para que, mesmo dentro do teto de 2 CPUs, o kernel priorize os vizinhos em disputa.
4. **faster-whisper modelo `small`, `compute_type=int8`, CPU**: ~2–4× tempo real em 2 cores para áudio de 60s — aceitável para vídeos curtos de UGC. Se virar gargalo, AssemblyAI como alternativa gerenciada (custo por minuto, zero CPU local) antes de pensar em GPU.
5. **Timeout e retry por job**: job de vídeo com timeout (ex.: 15 min), `attempts: 2`, e mover para failed com o stderr do FFmpeg no log do job (visível no Bull Board).
6. **Caminho futuro documentado**: adicionar um **nó worker dedicado** ao Swarm (`docker swarm join`) e mudar o constraint do `openrate_worker` para `node.labels.role == media` — a arquitetura já suporta, é só placement. Esse é o upgrade correto quando o volume de vídeo crescer, não aumentar limits no manager.

### 2.5 Modelo de IA "claude-sonnet-4-6" está desatualizado

**Problema.** A spec (seção 2.1) cita `claude-sonnet-4-6`, que não é um identificador atual.

**Melhoria proposta:** padronizar em **`claude-sonnet-5`** para geração das 40 ideias e roteiros (tarefa criativa com estrutura — hooks, passos, hashtags — onde qualidade de escrita importa para o produto) e **`claude-haiku-4-5`** como fallback econômico/rápido para tarefas de menor valor (regenerar uma legenda, reescrever um hook, classificar produto em categoria). Implementar no worker `ai-script-generation` com o nome do modelo em variável de ambiente (`ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_FALLBACK`) — troca de modelo sem rebuild. Pedir saída estruturada (JSON com schema das ideias) e validar com zod antes de persistir em `video_ideas`; resposta inválida → retry no fallback.

### 2.6 Stripe não faz payout Pix para terceiros no Brasil — fechar em Asaas

**Problema.** A spec deixa "Asaas ou Stripe (Pix)" em aberto. Stripe no Brasil aceita Pix como **meio de recebimento** (charge), mas não oferece payout Pix para chave de terceiro arbitrário (o payout do Stripe vai para a conta bancária do próprio merchant; Stripe Connect não cobre o caso "transferir para a chave Pix do atendente"). Manter a dúvida na spec é risco de retrabalho na Fase 3.

**Melhoria proposta:** fechar em **Asaas** (transfer API para chave Pix), já decidido. Detalhar as exigências que a spec omite:
1. **KYC do recebedor**: o Asaas exige identificação do destinatário — coletar CPF e chave Pix do atendente no onboarding do app, validar titularidade (nome retornado na consulta da chave vs. cadastro) antes do primeiro payout.
2. **Agenda de repasse**: o fechamento (`commission-settlement`) gera o payout em estado `pending_approval`; aprovação humana (owner/manager) libera o job `payout-pix`. Nunca pagar direto do webhook de venda — vendas de afiliado têm janela de cancelamento/estorno nas plataformas; respeitar carência (ex.: D+30) antes de tornar a comissão pagável.
3. **Webhook de confirmação**: a transferência Pix no Asaas é assíncrona — o payout só transita para `paid` no webhook `TRANSFER_DONE` (e `failed` em `TRANSFER_FAILED`, com retry manual). Endpoint de webhook idempotente (dedupe por event id) e assinatura validada (token do webhook Asaas).
4. **Idempotência financeira**: chave de idempotência por payout (`payout_id`) na chamada ao Asaas; jamais reexecutar o job sem checar estado remoto — retry de fila em operação de dinheiro sem idempotência = pagamento duplo.
5. Saldo da conta Asaas monitorado (job diário) com alerta via Evolution API quando insuficiente para o próximo ciclo.

### 2.7 Falta estratégia de backup e observabilidade mínima

**Problema.** A spec não fala uma palavra sobre backup nem sobre monitoramento. O banco vive num Postgres **compartilhado** com outros produtos — um backup "do servidor" não é um plano de restore do OpenRate; e dados financeiros (`commission_entries`, `payouts`) sem backup testado é passivo real.

**Melhoria proposta:**
1. **Backup lógico por schema**: job agendado (cron do host ou serviço Swarm one-shot agendado) rodando `pg_dump -h supabase_db -n openrate -Fc` diário, gravando em `s3://openrate-backups/` no próprio MinIO com retenção de 30 dias (lifecycle) e cópia semanal para fora do servidor (o MinIO está no mesmo host — backup no mesmo disco não sobrevive à perda do host). Testar restore num Postgres descartável mensalmente.
2. **Lifecycle no bucket** como parte da política de dados (detalhado em 2.8).
3. **Healthchecks Docker em todos os serviços** (já decidido): API e web com endpoint `/health` (checando Postgres e Redis), worker com healthcheck de liveness do processo BullMQ, redis com `redis-cli ping`. Swarm reinicia container unhealthy sozinho.
4. **Bull Board** em `openrate-queues.talkhub.me` protegido por middleware `basicauth` do Traefik — é a janela de observabilidade das filas (jobs failed, stalled, latência) sem abrir o Redis.
5. **Logs**: stdout/stderr estruturado (JSON via pino no NestJS/worker), consumidos pelo Portainer (já é a ferramenta de operação do servidor). Sem stack nova de logging no MVP; se precisar de agregação, o Logflare/Vector do Supabase já existe como caminho.
6. **Alertas baratos**: job `notifications` que manda WhatsApp (Evolution API) para o operador quando: fila com > N jobs failed, payout falhou, disco do MinIO > 80%.

### 2.8 Falta política de retenção/custo de storage de vídeo

**Problema.** Vídeo bruto de celular é grande (0,5–1 GB não é raro em 4K). Com 10 lojas × 5 atendentes × 1 vídeo/dia, entram ~50–250 GB/mês só de raw. O MinIO está no disco do único servidor — sem política de retenção, storage vira o primeiro incidente de capacidade do produto.

**Melhoria proposta:**
1. Bucket `openrate-media`, prefixos `raw/`, `final/`, `thumbs/`.
2. **Lifecycle rule no MinIO: expirar `raw/` após 30 dias** (`mc ilm rule add --expire-days 30 --prefix raw/`). O raw só precisa existir entre upload e aprovação do vídeo editado; 30 dias dá folga para reprocessamento.
3. **`final/` permanece** (é o ativo do produto — o vídeo publicado e vinculado a link de afiliado/comissão), mas comprimido pelo worker (H.264, CRF ~23, 1080p máx — um final de 60s fica em 20–60 MB, ~10–20× menor que o raw).
4. `thumbs/` é desprezível em volume; imgproxy redimensiona on-the-fly a partir do original (não pré-gerar N tamanhos).
5. Dashboard/alerta de uso de bucket por organização (métrica para custo por tenant — insumo futuro de pricing).
6. Documentar no termo de uso que o bruto é descartado após 30 dias (expectativa do usuário alinhada com a lifecycle).

### 2.9 Redis compartilhado não serve para BullMQ — a spec acerta; reforçar o porquê

**Problema/validação.** A spec já pede instância dedicada com `noeviction` — decisão correta que merece a justificativa explícita para ninguém "simplificar" depois apontando para o `redis_redis` existente.

**Por quê (registrar):** (1) o BullMQ guarda o **estado dos jobs** em chaves Redis; com política de eviction diferente de `noeviction`, o Redis sob pressão de memória apaga chaves de jobs/locks e o BullMQ corrompe filas silenciosamente — é requisito documentado da lib; (2) o `redis_redis` compartilhado atende outros produtos: um `KEYS *`/`FLUSHDB` de vizinho, ou simplesmente a concorrência por memória, viraria incidente do OpenRate; (3) `appendonly yes` no dedicado dá durabilidade de fila a restart de container — no compartilhado a config não pode ser alterada sem afetar os demais. Custo da instância própria: ~50 MB de RAM. Não há trade-off real; manter `openrate_redis` dedicado.

### 2.10 "Métricas via scraping" onde não há API — usar o Browserless que JÁ existe, com ressalvas

**Problema.** A fila `metrics-sync` promete views/likes/comentários "das plataformas", mas várias delas (Kwai, Shopee Video, ML Clips) não têm API pública de métricas de vídeo. A spec não diz como resolve.

**Melhoria proposta:**
1. Onde houver API oficial (YouTube Data API, TikTok Display API quando o app for aprovado), usar API — sempre preferível.
2. Onde não houver, usar o **`browserless_browserless` já em produção** (porta 3000, Chrome headless via CDP/puppeteer) para scraping das páginas públicas dos vídeos. Não subir Chrome próprio.
3. **Ressalvas obrigatórias no design**: scraping é frágil (seletor quebra sem aviso) e pode violar ToS das plataformas — tratar como **best-effort**: métricas marcadas com `source: 'scrape' | 'api'` e `synced_at`; falha de scraping degrada para "métrica desatualizada", nunca bloqueia fluxo de comissão (comissão vem de venda confirmada de afiliado, não de views).
4. Rate limit e jitter no job (`metrics-sync` a cada 15 min é agressivo para scraping — espaçar por publicação, ex.: cada vídeo sincroniza a cada 2–6 h com jitter), user-agent honesto, e circuit breaker por plataforma (N falhas seguidas → pausa a plataforma e alerta).
5. Isolar cada plataforma num adapter (`MetricsProvider`) — mesma filosofia dos conectores de publicação — para trocar scraping por API oficial sem tocar o core.

### 2.11 Termo de cessão de imagem do atendente — obrigação jurídica ignorada pela spec

**Problema.** O produto publica **a imagem e a voz de funcionários** em conteúdo comercial de terceiros (a loja, a plataforma). Sem cessão de direito de imagem documentada, a loja e o OpenRate ficam expostos (direito de imagem — art. 20 do Código Civil — e dados pessoais/LGPD). A spec não menciona o tema. Isso não é feature "nice to have": é pré-requisito para o primeiro vídeo publicado.

**Melhoria proposta:**
1. Usar o **Docuseal já em produção** no servidor: no onboarding do atendente, a API cria uma submission a partir de template "Termo de Cessão de Uso de Imagem e Voz" via API do Docuseal, envia o link (WhatsApp via Evolution API), e recebe webhook de conclusão.
2. Gate no produto: atendente com `image_release_status != 'signed'` **não consegue enviar vídeo para aprovação** (pode gravar/testar, não publicar).
3. Guardar o PDF assinado no MinIO (`openrate-media`, prefixo dedicado fora da lifecycle de 30 dias, ex.: `legal/`) e referência em `users`/`audit_log`.
4. Versão do termo versionada: mudou o texto → nova assinatura exigida.
5. Prever revogação: atendente desligado pode revogar cessão futura; o fluxo de despublicação de vídeos precisa existir (mesmo que manual no MVP).

### 2.12 Lacunas menores (registrar para não perder)

- **Nome do bucket divergente**: spec diz `openrate-videos`, decisão fechada é `openrate-media`. Corrigir a spec.
- **Filas incompletas na spec**: a tabela 2.3 omite `notifications` (WhatsApp via Evolution) — adicionar às seis filas decididas: `video-processing`, `ai-script-generation`, `metrics-sync`, `commission-settlement`, `payout-pix`, `notifications`.
- **"NestJS ou Express"**: fechar em **NestJS** (decisão já tomada) — guards/interceptors resolvem o padrão de tenant-check + `set_config` de forma transversal.
- **Migrations**: a spec não define ferramenta. Decidido: migrations versionadas (dbmate ou prisma migrate) rodando com a role de migração, target `search_path=openrate`, e **nunca** tocando outros schemas do banco compartilhado.
- **Painel web ausente da tabela de infra**: a spec descreve o painel Next.js na stack mas não o lista como serviço em 2.2 — a stack fechada tem `openrate_web` (porta 3000, host `openrate.talkhub.me`) e a API em `openrate-api.talkhub.me`. Refletir na spec.
- **Métricas de negócio vs. views**: deixar explícito no modelo que comissão deriva de `affiliate_sales` (venda confirmada), nunca de métricas de engajamento — evita acoplamento do financeiro ao scraping frágil.

### 2.13 App do atendente 100% web (PWA)

**Decisão (correção da spec 2.1).** A spec previa um app instalado por loja de aplicativos; a decisão fechada é **produto 100% web**: o atendente usa um **PWA** — a mesma aplicação Next.js do painel (`openrate_web`), com rotas por role — aberto no navegador do celular. Sem toolchain de build à parte e sem publicação em loja de aplicativos.

**Por que isso é vantajoso aqui:**
1. **Menos superfície e menos custo**: um único front (Next.js) atende painel e atendente; o `packages/shared` de tipos/zod já é compartilhado. Zero pipeline de build à parte, zero contas de developer, zero espera de revisão de loja para publicar correção.
2. **Deploy uniforme**: o PWA sai no mesmo `openrate_web` do Swarm, atrás do mesmo Traefik/TLS — nada de artefato fora da infra do servidor. Atualização é um redeploy da imagem, chega a todos na hora.
3. **Onboarding instantâneo**: atendente abre `https://openrate.talkhub.me` e "adiciona à tela inicial" — nada a instalar.
4. **Capacidades cobertas pelo navegador**: câmera e gravação via `getUserMedia`/`MediaRecorder`; upload resumível via multipart do MinIO (parte a parte); instalação, ícone e splash via Web App Manifest; fila offline e notificações via service worker + Web Push.

**Riscos assumidos e mitigação:**
- **Diferença entre navegadores**: `MediaRecorder` grava WebM/VP9 no Chrome Android e MP4/H.264 no Safari iOS — negociar o mime-type suportado em runtime e **normalizar tudo para MP4/H.264 no worker** (o pipeline FFmpeg já roda de todo modo). Testar cedo em iOS **e** Android reais.
- **Limites do iOS em PWA** (gravação em background, cota de storage): o fluxo é desenhado para "gravar em primeiro plano → enviar", que cabe nesses limites; casos específicos são tratados pontualmente no próprio PWA.
- **Storage local do vídeo bruto**: usar IndexedDB para a fila de pendentes, com limpeza após upload confirmado.

---

## 3. Mapa de reaproveitamento (serviço existente → uso pelo OpenRate)

| Serviço em produção | DNS interno / endpoint | Como o OpenRate usa |
|---|---|---|
| **supabase_db** (Postgres 15.8) | `supabase_db:5432` | Schema dedicado `openrate`, role `openrate_app` (NOSUPERUSER, NOBYPASSRLS, sem grants em outros schemas). Conexão direta com `search_path=openrate` e `set_config('request.jwt.claims', ..., true)` por transação. Migrations com role própria. |
| **gotrue** (supabase_auth) | `supabase_auth` (interno) | Autenticação de todos os usuários. `org_id`/`store_id`/`role` em `app_metadata` via Admin API no provisionamento. API valida JWT localmente com `SUPABASE_JWT_SECRET`. |
| **MinIO** | `minio_minio:9000` interno; presign público `https://bucketss3.talkhub.me` | Bucket `openrate-media` (`raw/`, `final/`, `thumbs/`, `legal/`). Upload presigned multipart direto do app. Lifecycle: `raw/` expira em 30 dias. Também recebe dumps de backup (`openrate-backups`). |
| **Evolution API** | `evolution_evolution_api:8080` | Fila `notifications`: WhatsApp para atendentes (meta batida, vídeo aprovado, comissão creditada, link de assinatura do termo) e alertas operacionais. |
| **Browserless** | `browserless_browserless:3000` | Scraping best-effort de métricas de plataformas sem API pública (fila `metrics-sync`), via puppeteer/CDP. |
| **Docuseal** | stack `docuseal` | Termo de cessão de imagem e voz do atendente: template + submission via API, webhook de assinatura, gate de publicação. |
| **Chatwoot** | stack `chatwoot` | Widget de suporte embutido no painel `openrate.talkhub.me` (inbox dedicada para o produto). |
| **imgproxy** | `supabase_imgproxy:8080` | Resize/crop on-the-fly de imagens de produto e thumbnails servidos ao app/painel — sem pré-gerar variantes no MinIO. |
| **olist-mcp** | portas 3400/3401 (interno) | Referência de integração Olist já validada em produção (auth, rate limits, shape dos dados) para o conector de "produtos integrados" da Fase 3. Não é dependência de runtime do OpenRate. |
| **Traefik v3.4** | entrypoint `websecure` | Routers novos: `openrate.talkhub.me` (web), `openrate-api.talkhub.me` (API), `openrate-queues.talkhub.me` (Bull Board + middleware basicauth). Certresolver `letsencryptresolver`. Labels em `deploy.labels`, padrão Orion. |
| **Portainer** | UI existente | Deploy da stack `openrate` (padrão do servidor), inspeção de logs e restart de serviços. |

Serviços novos (únicos que a stack adiciona): `openrate_redis`, `openrate_api`, `openrate_worker`, `openrate_web`, `openrate_bullboard`. Produto 100% web: atendente (PWA) e painel são o mesmo `openrate_web` (ver 2.13).

---

## 4. Checklist anti-conflito com a produção

Antes do primeiro `docker stack deploy openrate`:

- [ ] **Nomes únicos**: stack `openrate`; serviços `openrate_redis`, `openrate_api`, `openrate_worker`, `openrate_web`, `openrate_bullboard`; nenhum colide com serviço existente (`docker service ls | grep -i openrate` deve retornar vazio antes do deploy).
- [ ] **Volume externo pré-criado**: `docker volume create openrate_redis_data` antes do deploy; declarado como `external: true` no YAML (padrão Orion).
- [ ] **Zero portas publicadas no host**: nenhum bloco `ports:` em nenhum serviço — só 80/443 do Traefik existem no host; todo tráfego entra por router Traefik e o interno via overlay `talkhub`.
- [ ] **Rede**: apenas `talkhub` (external) — não criar rede nova.
- [ ] **Subdomínios novos e flat**: `openrate.talkhub.me`, `openrate-api.talkhub.me`, `openrate-queues.talkhub.me` — conferir que não há router Traefik existente com esses hosts (`Host()` duplicado silenciosamente roteia errado). Nunca sub-subdomínio.
- [ ] **Redis próprio**: BullMQ aponta exclusivamente para `openrate_redis:6379` (`noeviction`, `appendonly yes`) — jamais para `redis_redis`.
- [ ] **Schema próprio no Postgres compartilhado**: tudo em `CREATE SCHEMA openrate`; migrations com `search_path=openrate`; nenhum objeto em `public`, `auth`, `storage` ou schemas de outros produtos.
- [ ] **Role sem privilégios laterais**: `openrate_app` com `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`; `GRANT USAGE ON SCHEMA openrate` + grants por tabela; `REVOKE ALL ON SCHEMA public FROM openrate_app`; validar com `\dn+` / tentativa de `SELECT` em schema alheio (deve falhar).
- [ ] **Limits de recursos em todos os serviços** (o nó é único e compartilhado): api 1 CPU/1G, worker 2 CPU/3G, web 0.5 CPU/512M, redis 0.5 CPU/512M, bullboard 0.25 CPU/256M. Soma dos limits do OpenRate ≤ folga real do nó (medir `docker stats` antes do deploy).
- [ ] **Concorrência do worker = 1** na fila `video-processing` no go-live; aumentar só com medição.
- [ ] **Healthcheck em todos os serviços**; `placement.constraints: node.role == manager` (nó único hoje), pronto para trocar por label quando houver nó worker.
- [ ] **Bull Board atrás de basicauth** (middleware Traefik) — nunca exposto aberto.
- [ ] **Bucket e credencial dedicados no MinIO**: bucket `openrate-media` + access key exclusiva do OpenRate com policy restrita ao bucket (não usar a root key `Admin`); lifecycle de `raw/` aplicada e verificada (`mc ilm rule ls`).
- [ ] **Nenhuma alteração em serviço existente**: não editar env/config de supabase, minio, traefik, evolution etc. — o OpenRate só *consome*. Única exceção controlada: criação de schema/role no Postgres e bucket/policy no MinIO (operações aditivas, documentadas em runbook).
- [ ] **TZ=America/Sao_Paulo** nos serviços com cron/agendamento (settlement e payout dependem de data local correta).

---

## 5. O arquivo `script` na raiz do repositório

O arquivo `/home/user/openrate.talkhub.me/script` é um **artefato de geração**: um script Python que apenas embute o conteúdo integral de `openrate-produto-e-stack.md` numa string e o regrava em `output/openrate-produto-e-stack.md` (sobrou do processo que gerou a spec). Problemas:

1. **Duplicação de fonte de verdade**: o mesmo markdown existe duas vezes (no `.md` e dentro da string do script). Qualquer edição na spec que não seja replicada no script cria divergência silenciosa.
2. **Ruído no repo**: não tem função em build, deploy ou runtime; sem extensão, sem shebang, fora de qualquer pipeline.
3. **Risco de regressão**: alguém que execute o script "para ver o que faz" gera um `output/` com uma versão desatualizada da spec.

**Ação: remover o arquivo** (`git rm script`) e manter `openrate-produto-e-stack.md` como única fonte da spec, versionada normalmente pelo git. Se houver interesse histórico, o próprio histórico do git preserva o conteúdo.
