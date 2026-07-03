# OpenRate — Especificação de Produto e Stack Tecnológica (v1.0)

> Codinome anterior: "Loja Creator". Domínio de produção: **openrate.talkhub.me**

---

## 1. Descrição do Produto

**OpenRate** é uma plataforma SaaS multi-tenant que transforma atendentes de lojas físicas em creators de conteúdo (UGC), conectando a gravação de vídeos de produtos a publicação multi-plataforma, rastreamento de vendas por afiliado e rateio automático de comissão via Pix.

### 1.1 Problema que resolve
Lojas físicas (varejo, suplementos, pet shops, etc.) têm produtos e vendedores, mas não têm processo estruturado para gerar conteúdo de vídeo que venda nas redes sociais (TikTok, Shopee Video, Instagram Reels, Kwai, Mercado Livre Clips, YouTube Shorts). O OpenRate fornece o roteiro (via IA), o fluxo de gravação guiada, a edição do vídeo bruto e o rastreamento de receita gerada por cada vídeo/creator.

### 1.2 Fluxo principal (ponta a ponta)
1. IA gera **40 ideias de vídeo** por produto (hook, roteiro passo a passo, legenda, hashtags, duração alvo).
2. Atendente escolhe uma ideia no app mobile; tela de gravação exibe **overlay-guia** (teleprompter/checklist) baseado no roteiro.
3. Vídeo bruto é enviado (upload resumível) para processamento.
4. Microserviço de edição (fila assíncrona) corta, adiciona legendas automáticas, marca d'água e gera thumbnail — devolve vídeo final para download/publicação.
5. Vídeo é publicado (manual assistido ou via API) em uma ou mais plataformas; cada publicação gera um **link de afiliado rastreável**.
6. Vendas confirmadas nas plataformas de afiliados disparam o motor de **regras de comissão** (mais específica vence), gerando lançamentos para creator, loja e plataforma.
7. Fechamento periódico consolida lançamentos em **payouts via Pix**.
8. Metas diárias/semanais e gamificação mantêm o engajamento dos atendentes.

### 1.3 Papéis (roles)
| Role | Quem é | Principais ações |
|---|---|---|
| `super_admin` | Equipe OpenRate | Catálogo global, regras de comissão da plataforma, gestão de orgs |
| `owner` | Dono da rede de lojas | Visão de todas as lojas, metas, financeiro consolidado |
| `manager` | Gerente de loja | Aprova vídeos, cadastra produtos, define metas da loja |
| `attendant` | Vendedor/creator | Grava vídeos, acompanha comissões e ranking |

### 1.4 Diferenciais de arquitetura
- **Escopo de produto** (`store` / `organization` / `platform`) e **origem** (`integration` / `manual` / `platform`) permitem que um atendente monetize tanto produtos próprios quanto o catálogo global da plataforma.
- **Pipeline de vídeo híbrido**: parte do conteúdo é 100% gravado por humanos (câmera real, produto físico) e recebe pós-produção assistida por microserviço próprio — diferente de ferramentas de vídeo 100% sintético por IA.
- **Conectores de publicação plugáveis**: cada rede social é um adapter isolado, permitindo adicionar TikTok Shop, Instagram, Shopee Video etc. de forma incremental sem alterar o core.
- **Motor de comissão por prioridade**: regras podem ser globais, por organização, por loja, por produto ou por categoria; a mais específica sempre vence.

### 1.5 Nota sobre inspiração externa (MoneyPrinterV2)
Avaliamos o projeto open-source MoneyPrinterV2 como possível base de código. Ele foi **descartado como dependência direta** por dois motivos: (1) é um CLI Python de geração 100% sintética de vídeo (TTS + b-roll), sem overlay de gravação guiada nem edição de vídeo bruto real — não atende ao caso de uso; (2) é licenciado sob **AGPL-3.0**, incompatível com uso comercial em SaaS fechado sem obrigação de abrir o código-fonte. Aproveitamos apenas padrões conceituais (pipeline modular, scheduler, abstração de conectores por plataforma), implementados como código próprio.

---

## 2. Stack Tecnológica Detalhada

### 2.1 Visão geral por camada

| Camada | Tecnologia | Justificativa |
|---|---|---|
| App do atendente | React Native + Expo | Base única Android/iOS, acesso à câmera, upload resumível |
| Painel admin/dono | Next.js + Tailwind + shadcn/ui | Dashboard web responsivo, rápido de construir |
| API principal | Node.js (NestJS ou Express) | Alinhado ao ecossistema Talkhub, integra fácil com BullMQ |
| Banco de dados | PostgreSQL (via Supabase self-hosted) | Multi-tenant com RLS nativo, já provisionado na infra Talkhub |
| Autenticação | Supabase Auth (gotrue) | JWT com `org_id`, já em produção na rede `talkhub` |
| Storage de mídia | MinIO (S3-compatible) | Já provisionado (`bucketss3.talkhub.me`), evita custo de storage externo |
| Fila / Jobs assíncronos | Redis dedicado + BullMQ | Substitui Supabase Cron/Edge Functions; retries, backoff e prioridade nativos |
| Monitoramento de filas | Bull Board | Visibilidade de jobs falhos/travados sem acesso direto ao Redis |
| IA de roteiros/ideias | API Claude (claude-sonnet-4-6) | Gera as 40 ideias e roteiro passo a passo por produto/tipo |
| Processamento/edição de vídeo | FFmpeg + microserviço próprio (worker) | Corte, legenda automática, thumbnail, validação de duração/áudio |
| Transcrição de áudio real | Whisper / AssemblyAI | Legendas automáticas para vídeo gravado por humanos (não sintético) |
| Pagamentos (comissões) | Asaas ou Stripe (Pix) | Payout automático para chave Pix do atendente |
| Integração ERP | API Olist/Tiny | Origem dos "produtos integrados" e estoque |
| Reverse proxy / TLS | Traefik v3.4 | Já em produção na rede `talkhub`, roteamento por Host header |
| Orquestração | Docker Swarm | Padrão já adotado na infraestrutura Talkhub |

### 2.2 Infraestrutura de produção (rede `talkhub`)

A stack é implantada como serviços adicionais na rede Docker overlay `talkhub` já existente, reaproveitando componentes já provisionados e evitando duplicação:

| Componente | Status | Decisão |
|---|---|---|
| Postgres (Supabase) | Já em produção | Reaproveitado; schema dedicado `openrate` |
| Auth (gotrue) | Já em produção | Reaproveitado |
| MinIO (S3) | Já em produção | Bucket dedicado `openrate-videos` |
| Redis (filas) | Novo | Instância isolada `openrate_redis`, `maxmemory-policy=noeviction` |
| API + Worker | Novo | Containers separados (`openrate_api`, `openrate_worker`) |
| Traefik | Já em produção | Novo router `openrate.talkhub.me` |

### 2.3 Filas BullMQ (substituindo Supabase Cron)

| Fila | Função | Trigger |
|---|---|---|
| `video-processing` | Compressão, corte, legenda, thumbnail via FFmpeg | Enfileirado no upload do app |
| `metrics-sync` | Sincroniza views/likes/comentários das plataformas | Repetível (ex.: a cada 15 min) |
| `commission-settlement` | Fecha período e consolida `commission_entries` | Repetível (cron mensal/quinzenal) |
| `ai-script-generation` | Chamada à API Claude para gerar ideias/roteiros | Enfileirado sob demanda |
| `payout-pix` | Dispara pagamento via Asaas/Stripe | Agendado após aprovação do fechamento |

### 2.4 Modelagem de dados (resumo)

| Domínio | Tabelas principais |
|---|---|
| Multi-tenancy | `organizations`, `stores`, `users`, `user_stores` |
| Catálogo | `products`, `product_images`, `product_variations`, `store_inventory`, `brands`, `categories` |
| Conteúdo | `video_types`, `video_ideas`, `videos`, `video_publications`, `affiliate_links` |
| Financeiro | `commission_rules`, `affiliate_sales`, `commission_entries`, `payouts` |
| Engajamento | `goals`, `v_goal_progress_daily`, `achievements`, `user_achievements` |
| CRM físico | `customers`, `store_sales` |
| Operação | `integrations`, `notifications`, `audit_log` |

### 2.5 Roadmap de implementação

| Fase | Duração | Entrega principal |
|---|---|---|
| 1 — MVP | 4-6 semanas | Login, produtos manuais, ideias via IA, gravação guiada, meta diária, publicação manual |
| 2 — Dinheiro | 4 semanas | Links de afiliado, importação de vendas, rateio de comissão, dashboard de receita |
| 3 — Escala | Contínuo | Integração Olist, catálogo de plataforma, payouts automáticos via Pix, métricas via API, gamificação, conectores adicionais (TikTok Shop, Instagram, Shopee) |

### 2.6 Segurança e multi-tenancy

Toda tabela com `organization_id` segue a policy padrão de RLS `organization_id = auth.jwt() ->> 'org_id'`, com exceção de `products WHERE scope='platform'` (leitura liberada a todos os autenticados). Credenciais de integrações externas (`integrations.credentials`) são armazenadas criptografadas via pgcrypto/vault.

---

*Documento gerado a partir da especificação técnica original ("Loja Creator" v1.0) e das decisões de arquitetura de infraestrutura definidas para produção na rede Talkhub.*
