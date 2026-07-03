# OpenRate

Plataforma SaaS multi-tenant que transforma atendentes de lojas físicas em creators de conteúdo (UGC): a IA gera roteiros de vídeo por produto, o atendente grava com overlay-guia, o vídeo bruto é editado automaticamente, publicado em múltiplas plataformas com link de afiliado rastreável, e as vendas confirmadas viram comissão rateada e paga via Pix.

> Domínio de produção: **openrate.talkhub.me** · Codinome anterior: "Loja Creator".

**Produto 100% web.** O atendente usa um **PWA** (a mesma aplicação Next.js do painel, aberta no navegador do celular e instalável via "Adicionar à tela inicial") — sem publicação em loja de aplicativos. Câmera e gravação via `getUserMedia`/`MediaRecorder`; upload resumível direto ao MinIO; fila offline e notificações via service worker.

---

## Como este repositório está organizado

Neste momento o repositório contém a **especificação, a análise crítica, a arquitetura, a modelagem de dados e o plano de execução** — a base para começar a implementação. Ainda não há código de aplicação (`apps/`), que será criado a partir da Sprint 0.

| Documento | O que contém |
|---|---|
| [`openrate-produto-e-stack.md`](openrate-produto-e-stack.md) | Especificação de produto v1.0 e stack tecnológica (fonte original). |
| [`docs/01-analise-critica.md`](docs/01-analise-critica.md) | Análise crítica da spec: o que manter, 13 lacunas/riscos com melhoria concreta, mapa de reaproveitamento da infra existente e checklist anti-conflito com a produção. |
| [`docs/02-arquitetura.md`](docs/02-arquitetura.md) | Arquitetura de microserviços: diagramas, catálogo dos serviços novos, contratos de uso dos serviços reaproveitados, fluxos críticos, rotas da API, monorepo e convenções transversais. |
| [`docs/03-banco-de-dados.md`](docs/03-banco-de-dados.md) | Modelagem do schema `openrate`: diagramas ER por domínio, motor de comissão, RLS de duas vias e regras de convivência no Postgres compartilhado. |
| [`docs/04-sprints.md`](docs/04-sprints.md) | Plano de desenvolvimento em sprints (Fundação → MVP → Dinheiro → Escala), com DoD, capacidade e riscos. |
| [`docs/05-deploy-e-validacao.md`](docs/05-deploy-e-validacao.md) | Como colocar na VPS, a partir do Git, o que existe hoje para validar (migration, bucket) e o que falta (Sprint 0) para a stack subir por completo. |
| [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql) | Migration inicial: schema `openrate` (27 tabelas, 13 enums, 64 policies de RLS com FORCE, view de metas). Validada de ponta a ponta em Postgres 16. |
| [`deploy/openrate.yaml`](deploy/openrate.yaml) | Stack Docker Swarm no padrão "Orion" do servidor, pronta para colar no Portainer. |
| [`deploy/.env.example`](deploy/.env.example) | Variáveis de ambiente da stack (placeholders — nunca valores reais). |
| [`deploy/runbook.md`](deploy/runbook.md) | Passo a passo de deploy: DNS, volume, role/schema/migrations, bucket MinIO, build, deploy, smoke tests, rollback e checklist anti-conflito. |

Sugestão de leitura: `01` (o porquê das decisões) → `02` (a arquitetura) → `03` (o banco) → `04` (o plano) → `deploy/` (como sobe).

---

## Arquitetura em uma frase

Uma stack Swarm nova (`openrate`) com **5 serviços** — `openrate_api` (NestJS), `openrate_worker` (BullMQ + FFmpeg + faster-whisper), `openrate_web` (Next.js: painel **e** PWA), `openrate_redis` (filas, dedicado com `noeviction`) e `openrate_bullboard` (observabilidade das filas) — que **reaproveita** o que já roda no servidor Talkhub: Postgres do Supabase (schema `openrate` isolado), gotrue (auth), MinIO (mídia), Evolution API (WhatsApp), Browserless (scraping), Docuseal (termo de cessão), Chatwoot (suporte) e imgproxy (imagens), tudo atrás do Traefik existente.

**Princípios de coexistência com a produção** (detalhados em `docs/01` §4 e `deploy/runbook.md` §10):

- Zero portas publicadas no host — todo tráfego entra pelo Traefik (80/443).
- Nomes de stack/serviço/volume/router únicos e prefixados `openrate_`.
- Redis próprio (o global compartilhado não tem `noeviction`, requisito do BullMQ).
- Schema `openrate` isolado no Postgres compartilhado; role de runtime `openrate_app` sem privilégios sobre outros schemas e sujeita a RLS (`FORCE ROW LEVEL SECURITY`).
- Limites de recursos em todos os serviços — o nó é único e compartilhado com ~20 stacks.

---

## Deploy

Fluxo a partir do Git, na VPS: ver [`docs/05-deploy-e-validacao.md`](docs/05-deploy-e-validacao.md) (o que dá para validar hoje × o que depende da Sprint 0) e [`deploy/runbook.md`](deploy/runbook.md) (procedimento detalhado).

Em duas etapas, porque ainda não há código de aplicação:

- **Etapa A (agora):** clonar o repo na VPS, criar DNS dos 3 hosts, criar o volume `openrate_redis_data`, provisionar role/schema no `supabase_db` e aplicar a migration (valida o banco em produção), criar o bucket `openrate-media` no MinIO. Nada da produção existente é alterado.
- **Etapa B (após Sprint 0):** buildar as imagens `talkhub/openrate-*` a partir dos esqueletos das apps e subir a stack `deploy/openrate.yaml` pelo **Portainer** (já configurado na VPS).
