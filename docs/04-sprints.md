# 04 — Plano de Desenvolvimento em Sprints

> **⚠️ Estado atual:** documento histórico de projeto. A stack hoje usa **autenticação própria da API** (scrypt + JWT HS256 com `JWT_SECRET`, **sem gotrue**) e trata o Postgres como um **banco compartilhado comum** (container `supabase_db`), sem depender de features do Supabase. Referência atual: [`../README.md`](../README.md). Menções a "Supabase/gotrue" abaixo refletem o desenho original.

> Mapeia as 3 fases do roadmap da spec (`openrate-produto-e-stack.md`, seção 2.5) em sprints concretas de 2 semanas (exceto a Sprint 0, de 1 semana). Complementa `02-arquitetura.md` (topologia e contratos de reuso) e `deploy/runbook.md` (procedimentos operacionais). Premissa de time: **1-2 devs full-stack + IA de código** (ver seção de capacidade).

Correspondência fase → sprint:

| Fase da spec | Duração da spec | Sprints | Semanas |
|---|---|---|---|
| Fundação (pré-fase, não consta na spec) | — | Sprint 0 | Semana 1 |
| 1 — MVP | 4-6 semanas | Sprints 1-3 | Semanas 2-7 |
| 2 — Dinheiro | 4 semanas | Sprints 4-5 | Semanas 8-11 |
| 3 — Escala | Contínuo | Sprint 6+ (backlog priorizado) | Semana 12 em diante |

Convenções deste documento:

- **Entregável verificável** = algo que pode ser demonstrado ao vivo no ambiente de produção (`*.talkhub.me`) ou por comando reproduzível no runbook. Nada de "código pronto" sem demo.
- **DoD (Definition of Done)** = critérios binários; a sprint só fecha com todos verdes.
- Áreas: **backend** (`openrate_api`, NestJS), **worker** (`openrate_worker`, BullMQ/FFmpeg/faster-whisper), **web** (`openrate_web`, Next.js — painel **e** PWA do atendente no mesmo app), **infra** (stack Swarm, migrations, MinIO, Traefik, secrets). **Produto 100% web (sem loja de aplicativos)** — o atendente usa o PWA no navegador do celular (gravação via `getUserMedia`/`MediaRecorder`, instalável e com fila offline via service worker).

---

## Sprint 0 — Fundação (1 semana — semana 1)

**Objetivo:** colocar a stack `openrate` no ar em produção com serviços "hello world" saudáveis, banco/bucket/auth provisionados e os três esqueletos de aplicação compilando, para que toda sprint seguinte entregue em cima de infraestrutura real.

### Entregáveis verificáveis
1. `https://openrate-api.talkhub.me/health` responde `200` com JSON de status (via Traefik, TLS Let's Encrypt válido).
2. `https://openrate.talkhub.me` serve página placeholder do Next.js; `https://openrate-queues.talkhub.me` abre o Bull Board atrás do basicauth do Traefik.
3. `docker service ls | grep openrate` mostra os 5 serviços (`redis`, `api`, `worker`, `web`, `bullboard`) com `1/1` réplicas e healthcheck passando.
4. Migration `0001_init.sql` aplicada no `supabase_db`: schema `openrate` existe, role `openrate_app` (NOSUPERUSER) conecta com `search_path=openrate` e **não** lê outros schemas (teste negativo documentado).
5. Bucket `openrate-media` criado no MinIO com prefixos `raw/`, `final/`, `thumbs/` e lifecycle rule expirando `raw/` em 30 dias (`mc ilm ls` como evidência).
6. Usuário de teste criado via Admin API do gotrue com `app_metadata` contendo `org_id`, `store_id` e `role`; JWT decodificado mostra os claims.
7. Monorepo no Git com CI local (lint + typecheck + testes + build das 4 imagens `talkhub/openrate-*:latest` — api, worker, web, bullboard) rodando em um comando.

### Tarefas por área
- **infra**
  - Criar volumes externos (`openrate_redis_data`) e secrets/envs conforme `deploy/.env.example`.
  - Deploy da stack `deploy/openrate.yaml` via Portainer (padrão Orion: rede `talkhub` externa, labels Traefik em `deploy.labels`, sem `ports:`, resources limits em todos os serviços, `TZ=America/Sao_Paulo`).
  - Middleware basicauth do Traefik para o Bull Board.
  - Aplicar `0001_init.sql` (role de migração + schema `openrate` + role `openrate_app`) conforme runbook; configurar dbmate para as próximas migrations.
  - Criar bucket, prefixos e lifecycle no MinIO com `mc` (usuário de serviço dedicado, não o root Admin).
- **backend**: esqueleto NestJS com módulo `health` (checa Postgres, Redis e MinIO), Dockerfile multi-stage, config por env vars.
- **worker**: esqueleto Node + BullMQ conectado ao `openrate_redis` com uma fila `noop` de smoke test; imagem já inclui FFmpeg e faster-whisper (modelo `small` baixado no build) para validar tamanho/tempo de build cedo.
- **web**: esqueleto Next.js com página placeholder e rota `/api/health`; base do PWA já configurada (manifest, ícones, service worker mínimo registrado) e verificação de suporte a `getUserMedia`/`MediaRecorder` no navegador do celular-alvo.

### Dependências
- Acessos: Portainer, MinIO root (para criar usuário de serviço), `SUPABASE_JWT_SECRET` e service key do gotrue, senha do postgres para criar roles. Sem esses acessos a sprint não começa.

### DoD
- [ ] Todos os 7 entregáveis demonstrados.
- [ ] `docker service update --force openrate_api` (redeploy) não derruba o `/health` por mais de 30 s.
- [ ] Nenhuma porta publicada no host além das do Traefik (verificado com `docker service inspect`).
- [ ] Runbook atualizado com qualquer desvio encontrado no deploy real.

### Riscos da sprint
- **Imagem do worker pesada** (FFmpeg + faster-whisper + modelo): build lento no nó único. Mitigação: multi-stage, cache de layers, modelo baixado em layer separada.
- **Colisão com stacks existentes** no `supabase_db` (roles/extensões). Mitigação: migration idempotente, testada com `ON_ERROR_STOP=1`, sem `CREATE EXTENSION` fora do schema próprio.
- **Certificado Let's Encrypt**: rate limit se houver erro de DNS/label. Mitigação: conferir DNS dos 3 hosts antes do primeiro deploy.

---

## Fase MVP — Sprints 1-3 (semanas 2-7)

## Sprint 1 — Auth, multi-tenancy e CRUDs (semanas 2-3)

**Objetivo:** owner e manager conseguem logar no painel web e cadastrar toda a base operacional (organização, lojas, usuários, produtos manuais) com isolamento multi-tenant garantido em duas camadas (API + RLS).

### Entregáveis verificáveis
1. Login no painel via gotrue; sessão com refresh token; logout.
2. CRUD completo no painel: organizações (super_admin), lojas, usuários (convite via Admin API do gotrue, com `app_metadata` correto), produtos manuais com imagens (upload presigned para o MinIO, exibição via imgproxy).
3. Teste de isolamento: usuário da org A não lê nem escreve dados da org B — demonstrado tanto pela API (403) quanto por query direta com a role `openrate_app` + claims da org A (RLS bloqueia).
4. `audit_log` registrando criação/edição/remoção com actor, org e timestamp.

### Tarefas por área
- **backend**
  - Guard JWT validando assinatura com `SUPABASE_JWT_SECRET` e extraindo `org_id`/`store_id`/`role` do `app_metadata`.
  - Interceptor de transação: toda request autenticada abre transação e executa `set_config('request.jwt.claims', <claims>, true)` antes das queries (defesa em profundidade — as policies RLS funcionam mesmo em conexão direta).
  - Módulos CRUD: `organizations`, `stores`, `users`/`user_stores`, `products` (scope `store`/`organization`, origem `manual`), `product_images`, `brands`, `categories`.
  - Endpoint de convite: cria usuário no gotrue via Admin API com `app_metadata`, envia credencial inicial.
  - Presigned PUT para imagens de produto (prefixo `thumbs/` não; usar prefixo próprio `products/` — migration 0002 se necessário) e URL de exibição via `supabase_imgproxy`.
  - `audit_log` como interceptor global de mutações.
- **web**
  - Fluxo de login/logout/recuperação com gotrue; guarda de rotas por role.
  - Layout do painel (shadcn/ui): navegação por role (owner vê todas as lojas, manager vê a sua).
  - Telas CRUD dos módulos acima, com upload de imagem.
- **infra**: migrations 0002+ (tabelas de catálogo e policies RLS) via dbmate; usuário de serviço MinIO com policy restrita ao bucket `openrate-media`.
- **worker**: sem trabalho novo (fila noop permanece como smoke test).

### Dependências
- Sprint 0 completa (stack no ar, schema base, gotrue emitindo claims).

### DoD
- [ ] Teste automatizado de isolamento multi-tenant (API e RLS) passando no CI.
- [ ] Convite de usuário funciona ponta a ponta em produção (e-mail/credencial entregue, primeiro login força troca de senha).
- [ ] Todas as policies RLS têm teste SQL correspondente (positivo e negativo).
- [ ] Nenhuma rota da API sem guard (verificação por teste e2e que percorre o roteamento).

### Riscos da sprint
- **RLS + conexão direta é o ponto mais sutil da arquitetura**: erro no `set_config` (fora de transação, claim mal serializado) anula a defesa. Mitigação: teste e2e dedicado que conecta como `openrate_app` sem claims e prova que nada é retornado.
- **Escopo de CRUD engorda** (variações de produto, inventário). Mitigação: nesta sprint só `products` + imagens; `product_variations`/`store_inventory` entram quando a integração Olist exigir (Sprint 6+).

---

## Sprint 2 — IA de roteiros e gravação guiada (semanas 4-5)

**Objetivo:** atendente abre o PWA no navegador do celular, escolhe um produto, recebe as 40 ideias de vídeo geradas pela IA e grava com overlay-guia (teleprompter/checklist) — o coração do produto funcionando de ponta a ponta, ainda sem upload.

### Entregáveis verificáveis
1. Manager dispara "gerar ideias" para um produto no painel; job aparece no Bull Board; em até ~2 min as 40 ideias estão persistidas e visíveis (painel e PWA).
2. Cada ideia tem hook, roteiro passo a passo, legenda sugerida, hashtags e duração alvo, vinculada a um `video_type`.
3. No PWA: lista de ideias por produto, detalhe do roteiro e tela de gravação com câmera (`getUserMedia`/`MediaRecorder`) + overlay-guia (passos do roteiro navegáveis durante a gravação), vídeo salvo localmente (IndexedDB) com metadados (ideia, produto, duração).
4. Falha da API Claude é visível no Bull Board com retry/backoff; fallback para `claude-haiku-4-5` demonstrado (forçando erro no modelo primário).

### Tarefas por área
- **backend**
  - Migrations: `video_types` (seed com tipos padrão: unboxing, review, demonstração etc.), `video_ideas`, `videos` (estados iniciais).
  - Endpoint `POST /products/:id/ideas:generate` → enfileira `ai-script-generation` com idempotência (um job ativo por produto/tipo; regerar exige flag explícita).
  - CRUD `video_types` (por org, com defaults da plataforma).
  - Contabilização de custo de IA por org (tokens usados por job, para futura cobrança/limite).
- **worker**
  - Consumer `ai-script-generation`: monta prompt com dados do produto + `video_type`, chama `claude-sonnet-5`, valida o JSON de saída (schema estrito, re-prompt em caso de saída inválida), fallback `claude-haiku-4-5` após N falhas, persiste as 40 ideias em lote.
  - Retry/backoff exponencial, rate limit de chamadas concorrentes à API Claude (limiter do BullMQ).
- **web (painel)**: tela de disparo/acompanhamento de geração; listagem/curadoria de ideias (manager pode arquivar ideias ruins); CRUD `video_types`.
- **web (PWA atendente)**
  - Lista de produtos da loja → lista de ideias → detalhe do roteiro.
  - Tela de gravação (`getUserMedia` + `MediaRecorder`): overlay semitransparente com o passo atual do roteiro, navegação entre passos, timer com duração alvo, regravação.
  - Persistência local do vídeo bruto + metadados em IndexedDB (fila local de "pendentes de envio" — o upload é a Sprint 3).
- **infra**: secret `ANTHROPIC_API_KEY` na stack; Bull Board exibindo a fila real; alerta simples (log estruturado) para jobs em `failed`.

### Dependências
- Sprint 1 (produtos cadastrados, auth no PWA).
- Chave da API Anthropic com limite de billing configurado.

### DoD
- [ ] Geração das 40 ideias em produção para 3 produtos reais de teste, custo por geração medido e registrado.
- [ ] Saída da IA validada por schema em 100% dos jobs (job falha explicitamente em vez de persistir lixo).
- [ ] Gravação com overlay testada em pelo menos 2 celulares reais de gama média (Chrome Android e Safari iOS).
- [ ] Job de IA reprocessável pelo Bull Board (retry manual) sem duplicar ideias.

### Riscos da sprint
- **Qualidade do roteiro** é subjetiva e pode exigir várias iterações de prompt. Mitigação: prompt versionado no repo, avaliação com produtos reais do primeiro cliente, curadoria manual do manager como válvula.
- **Custo de IA**: 40 ideias × produtos × orgs escala rápido. Mitigação: contabilização por org desde já; cache por produto (regerar é ação explícita); haiku como fallback econômico.
- **Gravação no navegador**: `MediaRecorder` varia de codec entre navegadores (VP8/VP9/WebM no Chrome Android, H.264/MP4 no Safari iOS) e o iOS historicamente restringe gravação em PWA instalado. Mitigação: negociar o mime-type suportado em runtime, normalizar tudo para MP4/H.264 no worker (Sprint 3), e testar cedo em Chrome Android **e** Safari iOS reais (aparelhos-alvo das lojas).

---

## Sprint 3 — Upload, pipeline de vídeo e aprovação (semanas 6-7) — fecha o MVP

**Objetivo:** o vídeo gravado no PWA chega ao MinIO por upload multipart direto, é editado automaticamente pelo worker (corte, legendas, marca d'água, thumbnail), passa pela aprovação do manager e conta para a meta diária do atendente, com notificação por WhatsApp — MVP utilizável de ponta a ponta.

### Entregáveis verificáveis
1. Upload de vídeo real (100-300 MB) do PWA (navegador) direto para `bucketss3.talkhub.me` via presigned multipart, com retomada após queda de rede — **sem passar pela API** (verificável nos logs: API só recebe metadados).
2. Pipeline v1 no worker: vídeo em `raw/` → validação (duração, áudio presente) → **normalização de container para MP4/H.264** (o navegador pode ter gravado WebM/VP9 ou MP4) → corte de silêncio inicial/final → legendas burned-in geradas por faster-whisper (modelo small, CPU) → marca d'água da loja → thumbnail → resultado em `final/` e `thumbs/`; status do vídeo atualizado a cada etapa.
3. Painel do manager: fila de vídeos `pending_approval` com player (URL presigned de leitura), aprovar/rejeitar com motivo; rejeição notifica o atendente.
4. Metas diárias: manager define meta (ex.: 2 vídeos/dia); PWA mostra progresso do dia (`v_goal_progress_daily`); vídeo aprovado incrementa o progresso.
5. Notificações WhatsApp via Evolution API: "vídeo aprovado", "vídeo rejeitado (motivo)", "meta do dia batida" — recebidas em número real de teste.
6. Vídeo final baixável pelo PWA/painel para publicação manual nas plataformas (fluxo "publicação manual assistida" do MVP).

### Tarefas por área
- **backend**
  - Endpoints presigned multipart: `create` (chaves em `raw/{org}/{store}/{video_id}/`), `complete` (valida partes, enfileira `video-processing`), `abort`.
  - Máquina de estados de `videos`: `recording → uploading → uploaded → processing → pending_approval → approved | rejected | failed` (transições só via API/worker; auditadas).
  - Módulo `goals` + view `v_goal_progress_daily`; endpoints de progresso.
  - Módulo `notifications`: persiste notificação e enfileira `notifications` (envio é do worker).
  - Endpoints de aprovação/rejeição (role manager, com motivo obrigatório na rejeição).
- **worker**
  - Consumer `video-processing` com `concurrency=1` (nó único, ver riscos): download de `raw/`, `ffprobe` para validação, pipeline FFmpeg (corte, filtro de legenda a partir do SRT do faster-whisper, overlay de watermark, thumbnail em segundo representativo), upload de `final/` e `thumbs/`, atualização de status, limpeza de temporários.
  - Consumer `notifications`: template de mensagem → Evolution API (`evolution_evolution_api:8080`), com retry e registro de entrega.
  - Timeout e heartbeat de job (vídeo travado marca `failed` com erro legível, não fica eterno em `processing`).
- **web (painel)**: fila de aprovação com player; tela de configuração de metas; listagem de vídeos por loja/atendente com status e download do final.
- **web (PWA atendente)**: upload multipart resumível (partes reenviadas isoladamente) com barra de progresso e fila offline no service worker; tela "meus vídeos" (status em tempo quase real via polling); tela de meta diária com progresso; recebimento do motivo de rejeição.
- **infra**: conferir CORS do MinIO para a origem do PWA (`https://openrate.talkhub.me`, ver runbook passo 4.7); teste de carga do lifecycle `raw/`; ajuste fino dos limits do worker (2 cpu / 3 GB) com vídeo real.

### Dependências
- Sprint 2 (vídeo gravado localmente com metadados).
- Instância Evolution API com número de WhatsApp ativo para o OpenRate (criar instância dedicada, não reusar as de outros produtos).

### DoD
- [ ] Fluxo completo demonstrado ao vivo: gravar no PWA → upload → processamento → aprovação no painel → WhatsApp recebido → meta incrementada → download do vídeo final.
- [ ] Vídeo de 3 min processa em tempo aceitável no nó único (medido; alvo < 10 min fila+processamento) sem derrubar outros serviços (monitorar CPU durante o teste).
- [ ] Upload retomável comprovado: derrubar a rede no meio e concluir depois.
- [ ] Legendas com qualidade aceitável em português (validação humana em 5 vídeos reais).
- [ ] Nenhum vídeo órfão: job falho deixa status `failed` com motivo e raw preservado para reprocesso via Bull Board.

### Riscos da sprint
- **CPU do nó único**: FFmpeg + faster-whisper competem com todas as outras stacks do servidor. Mitigação: `concurrency=1`, `nice`/limits de CPU, medir e documentar; se saturar, reduzir preset do FFmpeg antes de pensar em segundo nó.
- **Qualidade da transcrição** (modelo small, áudio de loja com ruído): legendas ruins queimadas no vídeo são irreversíveis. Mitigação: etapa de aprovação do manager já cobre; AssemblyAI fica como alternativa gerenciada se o small decepcionar.
- **Sprint mais carregada do plano** (é o milestone do MVP). Mitigação: metas diárias e notificações são os primeiros cortes se necessário (deslizam 1 semana sem quebrar o fluxo principal).

**Fim da Sprint 3 = MVP utilizável** (fase 1 da spec entregue: login, produtos manuais, ideias via IA, gravação guiada, edição automática, aprovação, meta diária, publicação manual).

---

## Fase Dinheiro — Sprints 4-5 (semanas 8-11)

## Sprint 4 — Afiliados, vendas e motor de comissão (semanas 8-9)

**Objetivo:** cada publicação de vídeo gera um link de afiliado rastreável e vendas importadas (manual/CSV) são transformadas em lançamentos de comissão pelo motor de regras por prioridade.

### Entregáveis verificáveis
1. `video_publications`: registro manual de "publiquei este vídeo na plataforma X" com URL; geração de `affiliate_links` (código curto rastreável por publicação; redirect com contagem de cliques).
2. Importação de vendas: formulário manual + upload de CSV (template documentado) criando `affiliate_sales` com validação, deduplicação por chave externa e relatório de erros linha a linha.
3. Motor de comissão: `commission_rules` com escopo global / organização / loja / categoria / produto — **a mais específica vence**; venda importada gera `commission_entries` para creator, loja e plataforma, com trilha de qual regra foi aplicada.
4. Simulador no painel: dado um produto e um valor de venda, mostra qual regra vence e o rateio resultante (ferramenta de conferência do manager).

### Tarefas por área
- **backend**
  - Migrations: `video_publications`, `affiliate_links`, `affiliate_sales`, `commission_rules`, `commission_entries`.
  - Serviço de resolução de regra (prioridade por especificidade, desempate determinístico documentado) — puro e coberto por testes de tabela-verdade.
  - Endpoint de redirect do link de afiliado (rota pública na API, contagem de clique, redirect para a URL de destino).
  - Import CSV: parsing em stream, validação, idempotência (re-upload do mesmo arquivo não duplica), relatório de rejeições.
  - Lançamentos em `commission_entries` como evento imutável (correção = lançamento de estorno, nunca update).
- **web (painel)**: telas de publicações e links (copiar link), importação de vendas com preview e relatório de erros, CRUD de regras de comissão com o simulador, extrato de lançamentos por atendente/loja.
- **web (PWA atendente)**: tela "minhas comissões" (extrato de `commission_entries` do atendente); registrar publicação a partir do vídeo aprovado (colar URL) e obter o link de afiliado.
- **worker**: job síncrono de importação grande de CSV (enfileirado se > N linhas) para não travar a API.
- **infra**: migrations; nada estrutural novo.

### Dependências
- Sprint 3 (vídeos aprovados existem para vincular publicações).
- Definição de negócio: percentuais padrão de rateio creator/loja/plataforma (decisão do produto, não técnica — travar antes do meio da sprint).

### DoD
- [ ] Suíte de testes do motor de regras cobrindo todos os níveis de especificidade e empates.
- [ ] Import de CSV com 1.000 linhas (incluindo linhas inválidas) processa com relatório correto e sem duplicação em re-upload.
- [ ] `commission_entries` é imutável (sem UPDATE/DELETE pela role da aplicação — enforced por grant/policy, não por convenção).
- [ ] Extrato do atendente no PWA bate com o extrato do painel para os mesmos dados.

### Riscos da sprint
- **Regra de negócio de comissão mal definida** trava o motor. Mitigação: simulador entregue cedo na sprint para o dono do produto validar cenários; regras seed conservadoras.
- **CSV das plataformas varia de formato**. Mitigação: MVP aceita apenas o template próprio documentado; adaptadores por plataforma ficam para a fase Escala.

## Sprint 5 — Dashboards, fechamento e payout manual (semanas 10-11)

**Objetivo:** cada papel enxerga sua receita em dashboard próprio e o ciclo financeiro fecha: período consolidado, payouts calculados e registrados manualmente (Pix feito fora do sistema, registrado dentro) — fase Dinheiro completa.

### Entregáveis verificáveis
1. Dashboard **owner**: receita consolidada por loja/período, top vídeos, top creators. Dashboard **manager**: receita da loja, desempenho por atendente, funil vídeo→publicação→venda. Dashboard **attendant** (PWA): ganhos do período, ranking na loja, histórico.
2. Fechamento de período: job `commission-settlement` (cron quinzenal/mensal configurável por org) congela `commission_entries` do período e gera `payouts` por beneficiário em estado `pending_approval`.
3. Aprovação do fechamento pelo owner; payout marcado como `paid` manualmente com comprovante (registro do Pix feito fora do sistema); extrato do atendente reflete `paid`.
4. Notificação WhatsApp "sua comissão de R$ X foi paga" via fila `notifications`.

### Tarefas por área
- **backend**
  - Migrations: `payouts`; estados `open → closed → approved → paid` do período; chave Pix no cadastro do usuário (dado sensível: colunas restritas + auditoria de leitura).
  - Endpoints de fechamento (disparo manual + agendado), aprovação e registro de pagamento com comprovante.
  - Endpoints agregados dos dashboards (queries materializáveis; medir antes de otimizar).
- **worker**: consumer `commission-settlement` (job repetível BullMQ com cron por org): idempotente — reexecução do mesmo período não duplica payouts.
- **web (painel)**: dashboards owner/manager (gráficos), tela de fechamento (conferência → aprovar → registrar pagamentos em lote), gestão de chave Pix dos usuários.
- **web (PWA atendente)**: dashboard do atendente (ganhos, ranking), cadastro/edição da própria chave Pix, notificação de pagamento.
- **infra**: backup lógico do schema `openrate` agendado antes do primeiro fechamento real (dados financeiros — pré-requisito de go-live da fase Dinheiro).

### Dependências
- Sprint 4 (lançamentos existem).
- Decisão de negócio: periodicidade de fechamento e valor mínimo de payout.

### DoD
- [ ] Fechamento reexecutado 2x para o mesmo período produz resultado idêntico (idempotência comprovada).
- [ ] Soma dos `payouts` do período == soma dos `commission_entries` congelados (invariante testada automaticamente).
- [ ] Dashboards dos 3 papéis conferem com queries SQL manuais nos mesmos dados.
- [ ] Backup do schema `openrate` agendado e restauração testada uma vez.

### Riscos da sprint
- **Erro financeiro destrói confiança** no produto. Mitigação: invariantes testadas, entries imutáveis, fechamento com etapa humana de conferência antes de aprovar.
- **Fuso e corte de período** (America/Sao_Paulo vs UTC no banco): clássico gerador de divergência de centavos/dias. Mitigação: todas as agregações por período definem o corte em `America/Sao_Paulo` explicitamente e há teste cobrindo a virada de mês.

**Fim da Sprint 5 = fase Dinheiro entregue** (links de afiliado, importação de vendas, rateio, dashboards, fechamento e payout registrado).

---

## Sprint 6+ — Fase Escala (backlog priorizado, não datado)

A partir da semana 12, o trabalho vira fluxo contínuo puxado por prioridade. Ordem sugerida (re-priorizar com dados de uso reais a cada ciclo):

| # | Item | Escopo resumido | Por que nesta posição |
|---|---|---|---|
| 1 | **Integração Olist** | Fila de sync de catálogo/estoque (`integrations` + produtos origem `integration`), aproveitando o aprendizado do `olist-mcp` já em produção no servidor (auth, rate limits, formatos) | Elimina cadastro manual de produto — maior atrito operacional do MVP |
| 2 | **Payout automático Asaas** | Consumer `payout-pix` chama a transfer API do Asaas para a chave Pix; webhook de confirmação; conciliação com o payout registrado; fallback para o fluxo manual da Sprint 5 | Fecha o ciclo financeiro sem operação manual; o fluxo manual já validou o modelo |
| 3 | **metrics-sync** | Fila repetível (15 min): APIs oficiais das plataformas onde existirem; **Browserless** (`browserless_browserless:3000`) como fallback de scraping para plataformas sem API pública; views/likes/comments em `video_publications` | Alimenta ranking, gamificação e prova de valor para o lojista |
| 4 | **Catálogo platform** | `products` com `scope='platform'` e origem `platform`; RLS de leitura liberada a autenticados; curadoria do super_admin; comissão via regra global | Atendente monetiza além do estoque da própria loja — diferencial da spec |
| 5 | **Gamificação** | `achievements`, `user_achievements`, ranking entre lojas, streaks de meta; notificações WhatsApp de conquista | Retenção do atendente; depende de metrics-sync para métricas de engajamento |
| 6 | **Conector de publicação — TikTok Shop primeiro** | Adapter isolado (padrão de conectores plugáveis da spec): OAuth do creator, publicação direta do vídeo final, captura do ID da publicação para metrics-sync | Primeiro conector com API de afiliado + conteúdo integrada; os demais (Instagram, Shopee) seguem o mesmo contrato de adapter |
| 7 | **Termo de cessão de imagem via Docuseal** | Template no Docuseal existente; envio no onboarding do atendente; webhook de assinatura bloqueia/libera publicação | Requisito jurídico antes de escalar volume de creators |
| 8 | **Hardening do PWA** | Web Push (VAPID) como canal **secundário** (o WhatsApp segue sendo o principal; no iOS o Web Push exige PWA instalado, iOS 16.4+, entrega não garantida); robustez da fila offline (o *background sync* real é Chromium-only — no iOS a fila persiste em IndexedDB e drena ao reabrir o PWA); cache de assets/versionamento do service worker; banner de instalação; teste cross-browser (Chrome Android, Safari iOS) | Melhora a experiência do atendente mantendo o produto 100% web |

Cada item vira uma sprint (ou meia) com o mesmo formato das anteriores quando puxado. Itens 1, 2 e 3 têm dependência apenas do que já existe; 5 depende de 3; 6 depende de contas/aprovação de developer nas plataformas (iniciar os cadastros já na Sprint 4-5, o lead time é de semanas).

---

## Capacidade e paralelização

Premissa: **1-2 devs full-stack + IA de código** (geração de CRUD, testes, migrations e telas acelerada; revisão humana obrigatória em código financeiro e de segurança).

**Com 1 dev**, o plano acima é viável, mas as sprints 2 e 3 tendem a virar 2,5-3 semanas cada (PWA de gravação + worker na mesma pessoa). O cronograma total desliza ~2 semanas; a ordem não muda.

**Com 2 devs**, a divisão natural é:

- **Dev A (produto/servidor):** backend + painel web + migrations. Sequência crítica: auth/RLS (S1) → filas e endpoints (S2-S3) → motor de comissão e fechamento (S4-S5).
- **Dev B (mídia/front):** PWA do atendente + worker. Sequência crítica: gravação com overlay no navegador (S2) → upload + pipeline FFmpeg (S3) → dashboards do atendente e consumers financeiros (S4-S5).

O que **paraleliza** bem:
- S1: CRUDs do painel (A) ⇄ esqueleto de gravação no PWA adiantado (B).
- S2: prompt/consumer de IA (A ou B) ⇄ tela de gravação no navegador (B) — contrato = schema do JSON de ideias, travado no dia 1 da sprint.
- S3: endpoints presigned + aprovação (A) ⇄ pipeline FFmpeg (B) — contrato = máquina de estados de `videos`, travada no dia 1.
- Fase Escala: quase tudo paraleliza (conectores, gamificação e Olist são independentes entre si).

O que é **sequencial** (não adianta jogar gente):
- Sprint 0 inteira (fundação única).
- Auth/RLS antes de qualquer CRUD (S1 bloqueia tudo).
- Motor de comissão (S4) antes do fechamento (S5).
- Fluxo de payout manual (S5) antes do automático via Asaas (S6+).

Papel da IA de código: gera a maior parte de CRUDs, DTOs, telas shadcn, testes de policy e migrations; ganho estimado de 30-40% nas sprints 1, 4 e 5 (muito boilerplate) e menor nas 2-3 (a captura via `MediaRecorder` no navegador e o tuning de FFmpeg exigem iteração manual em celular/servidor reais).

---

## Riscos do plano (transversais às sprints)

1. **Produto 100% web — risco de capacidade do navegador.** Como o atendente usa o PWA, não há dependência de revisão de loja de aplicativos. O risco que resta é de capacidade do navegador: `MediaRecorder`/`getUserMedia` variam entre Chrome Android e Safari iOS, e o iOS impõe limites a um PWA instalado (ex.: gravação em background, cotas de storage). Mitigação: negociar o mime-type suportado em runtime e normalizar tudo no worker; desenhar a gravação para o fluxo "gravar em primeiro plano → enviar"; testar cedo em iOS **e** Android reais e ajustar o comportamento do PWA a cada caso.
2. **APIs de plataformas de afiliados instáveis/inexistentes.** TikTok, Shopee, ML mudam contratos, exigem aprovação de developer e algumas não têm API pública. Mitigação: fase Dinheiro roda 100% com importação manual/CSV (não depende de nenhuma API externa); metrics-sync nasce com fallback Browserless; conectores são adapters isolados — a falha de um não contamina o core. Iniciar cadastros de developer cedo (lead time longo).
3. **Processamento de vídeo no nó único.** FFmpeg + faster-whisper disputam CPU com ~20 stacks em produção no mesmo host. Mitigação: `concurrency=1` na fila `video-processing`, limits de CPU/memória rígidos (2 cpu/3 GB), medição desde a Sprint 3 e presets de FFmpeg ajustáveis. Gatilho de escala definido: se o p95 de fila+processamento passar de 15 min com uso real, adicionar um nó worker ao Swarm (constraint dedicada) antes de otimizar código.
4. **Banco compartilhado (supabase_db).** Migração errada ou query pesada do OpenRate afeta outros produtos do servidor. Mitigação: role `openrate_app` sem acesso a outros schemas, migrations revisadas por humano, agregações de dashboard medidas antes de otimizar, backup lógico próprio a partir da Sprint 5.
5. **Dependência de decisões de negócio** (percentuais de comissão, periodicidade de fechamento, valor mínimo de payout). São bloqueios das sprints 4-5 que não se resolvem com código. Mitigação: lista de decisões pendentes mantida no repo e cobrada com 1 sprint de antecedência.

---

## Tabela-resumo

| Sprint | Semanas | Entrega principal | Milestone de negócio |
|---|---|---|---|
| 0 — Fundação | 1 | Stack `openrate` no ar (5 serviços saudáveis), schema 0001, bucket, JWT com claims, esqueletos NestJS/Next(PWA), CI | Infraestrutura de produção pronta; `/health` verde |
| 1 — Auth e CRUDs | 2-3 | Login, multi-tenancy com RLS testado, CRUD orgs/lojas/usuários/produtos manuais no painel | Loja consegue se cadastrar e montar seu catálogo |
| 2 — IA e gravação | 4-5 | Fila `ai-script-generation` + Claude, 40 ideias por produto, gravação no PWA (navegador) com overlay-guia | Atendente grava o primeiro vídeo guiado por roteiro de IA |
| 3 — Pipeline e aprovação | 6-7 | Upload multipart direto ao MinIO, pipeline FFmpeg v1 (corte/legenda/watermark/thumb), aprovação do manager, metas, WhatsApp | **MVP utilizável** — fase 1 da spec entregue |
| 4 — Comissão | 8-9 | Links de afiliado, importação manual/CSV de vendas, motor de regras, `commission_entries` | Cada venda vira comissão rastreada até o creator |
| 5 — Fechamento | 10-11 | Dashboards por papel, fechamento de período, payouts manuais registrados, aviso de pagamento | **Fase Dinheiro entregue** — ciclo financeiro fecha ponta a ponta |
| 6+ — Escala | 12+ (contínuo) | Backlog priorizado: Olist → Asaas automático → metrics-sync → catálogo platform → gamificação → TikTok Shop → Docuseal → hardening do PWA | Operação escala sem trabalho manual; novos canais de receita |
