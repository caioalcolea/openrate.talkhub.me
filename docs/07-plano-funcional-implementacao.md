# 07 — Plano Funcional de Implementação (cadastros, IA/vídeo, downloads)

> Adaptação do documento `openratecadastrosefuncoes.md` ao estado **real** do sistema
> (schema `openrate`, API NestJS, worker BullMQ). **Foco em funções** — o layout/visual é
> responsabilidade do template já preparado; aqui tratamos schema, contratos, endpoints,
> validação e regras de negócio. Como **nenhum dado foi inserido**, a estrutura é reformada
> livremente (migration aditiva `0006`, sem migração de dados).

---

## 1. Reconciliação: desenho de campos ↔ schema atual

Legenda: **✓** já existe · **➕** adicionar coluna · **jsonb** cabe em coluna jsonb existente · **⚠️** decisão/observação.

### 1.1 Organização (`organizations`)
| Campo do desenho | Situação | Ação |
|---|---|---|
| Nome | ✓ `name` | — |
| Nome fantasia | ➕ | `trade_name text` |
| CNPJ | ✓ `document` | validar dígito na API |
| Plano (free/pro/rede) | ➕ | enum `org_plan` + `plan` (default `free`) |
| Status (active/suspended/churned) | ➕ | enum `org_status` + `status` (default `active`); manter `active` como legado/derivado |

### 1.2 Loja (`stores`)
| Campo | Situação | Ação |
|---|---|---|
| Nome, Slug, CNPJ (`document`), Fuso (`timezone`), Status (`active`) | ✓ | — |
| Telefone | ➕ | `phone text` |
| WhatsApp | ➕ | `whatsapp text` (alvo do convite via Evolution) |
| CEP/Rua/Número/Compl./Bairro/Cidade/UF | jsonb | padronizar shape de `address`: `{cep,street,number,complement,district,city,state}` (autocomplete de CEP é client-side) |

### 1.3 Usuário / Convite (`users` + `user_stores`)
| Campo | Situação | Ação |
|---|---|---|
| Nome (`full_name`), E-mail, Telefone (`phone`), CPF (`cpf`), Papel (`role`) | ✓ | — |
| Lojas vinculadas + "loja principal" | ✓ `user_stores.is_default` | invite passa a aceitar `storeIds[]` + `defaultStoreId` |
| Chave Pix / Tipo | ✓ `pix_key`/`pix_key_type` | tipos = `cpf,cnpj,email,phone,evp` (**doc dizia `random` → é `evp`**; corrigido) |
| Termo de cessão | ✓ `image_release_status` (+Docuseal) | gate de gravação na Fase D |
| Troca de senha no 1º login | ➕ | `must_change_password boolean default false` + `POST /v1/auth/change-password` |

### 1.4 Marca (`brands`) / Categoria (`categories`)
Todos os campos existem (`name`, `logo_key`, `parent_id`, `slug`). Falta **CRUD completo + upload de logo** (presign) e select em árvore.

### 1.5 Produto (`products` + `product_images`/`product_variations`/`store_inventory`)
| Aba / Campo | Situação | Ação |
|---|---|---|
| Nome, SKU, GTIN, Marca, Categoria, Escopo | ✓ | — |
| Modelo | ➕ | `model text` |
| Tipo (simple/kit/variation_parent) | ➕ | enum `product_type` + coluna (default `simple`) |
| Fiscal: NCM/CEST/Origem/Unidade | ➕ | `ncm text`, `cest text`, `fiscal_origin text`, enum `product_unit`+`unit` |
| Preço, Promo | ✓ `price`/`promo_price` | — |
| Preço de custo | ➕ | `cost_price numeric(14,2)` |
| Descrição curta / completa | ➕ | `short_description text` (usar `description` como HTML completo) |
| Tags | ➕ | `tags text[]` |
| SEO título/descrição | ➕ | `seo_title text`, `seo_description text` |
| Vídeo institucional (URL) | ➕ | `institutional_video_url text` |
| Logística: pesos/dimensões/itens por caixa | ➕ | `weight_gross_kg`, `weight_net_kg`, `height_cm`, `width_cm`, `length_cm` (numeric), `items_per_box int` |
| Imagens (upload múltiplo) | ✓ `product_images` | endpoint de presign + reordenação |
| Imagem principal | ➕ | `product_images.is_primary boolean` (ou menor `position`) |
| Variações | ✓ `product_variations` | CRUD |
| Estoque por loja | ✓ `store_inventory` | CRUD |

### 1.6 Tipo de vídeo (`video_types`)
| Campo | Situação | Ação |
|---|---|---|
| Código (`slug`), Nome (`name`) | ✓ | — |
| Ícone | ➕ | `icon text` |
| Roteiro padrão (passos) | ➕ | `script_skeleton jsonb` (lista ordenável); mantém `prompt_template` p/ a IA |

### 1.7 Meta (`goals`) — **refatoração**
| Campo | Situação | Ação |
|---|---|---|
| Nome | ✓ (**bug do doc já corrigido**) | — |
| Escopo (org/store/user) | ✓ derivado de `store_id`/`user_id` NULL | form seta os ids conforme o escopo |
| Métrica (videos_recorded/videos_published/views/affiliate_revenue) | ➕ | enum `goal_metric` + `metric` |
| Valor alvo | ➕ | `target_value numeric(14,2)` (substitui o par `target_videos`/`target_sales_amount`) |
| Período, datas, ativa | ✓ | — |
> Refatorar `v_goal_progress_daily` para medir progresso conforme `metric`/`target_value`.

### 1.8 Regra de comissão (`commission_rules`)
| Campo | Situação | Ação |
|---|---|---|
| Escopo/entidade | ✓ (ids + `priority` GENERATED) | — |
| % Creator/Loja/Plataforma + soma ≤100 | ✓ (CHECK) | validação em tempo real é componente de form |
| Válida de/até, Ativa, Prioridade (badge), Simular | ✓ | — |
| Base do cálculo (affiliate_payout/sale_value) | ➕ | enum `commission_base` + `calc_base` (default `affiliate_payout`); motor passa a respeitar a base |
| Plataforma (shopee/mercado_livre/loja_propria/any) | ⚠️ | hoje `platform` = `publication_platform` (rede social), e é isso que casa com `affiliate_sales.platform`. "loja_propria/any" é outra taxonomia → **manter publication_platform** por ora; canal de venda próprio fica como decisão futura |

### 1.9 Cliente (`customers`) — **sem módulo hoje**
| Campo | Situação | Ação |
|---|---|---|
| Nome, CPF (`cpf`), E-mail, Telefone (`phone`), Nascimento (`birthdate`), Tags, Obs (`notes`) | ✓ | — |
| CNPJ | ➕/jsonb | permitir doc PJ (usar `cpf` como documento genérico ou `document`) |
| WhatsApp, Gênero, Endereço, Origem, Consentimento LGPD | ➕ | `whatsapp text`, `gender text`, `address jsonb`, `origin text`, `lgpd_consent boolean` |
> **Falta o módulo inteiro de CRUD** (customers e store_sales não têm endpoints).

---

## 2. Correções de imprecisões do documento
- `payouts.receipt_url` **não existe** → adicionar `receipt_key` e gerar recibo (PDF).
- `videos.file_url`/`thumbnail_url` **não existem**: são `final_key`/`thumb_key`, presignados pela API.
- `videos.quality_check` **não existe** → adicionar `quality_check jsonb` (resultado do ffprobe).
- `goals.name` — **já implementado** (não é mais bug).
- Eliminação de `prompt()`/`alert()`/`confirm()` e o design system — **já feitos** (Fase A).
- Watermark fixa "OpenRate" — **ainda pendente** (Fase C, por loja).
- `video_ideas`: "manual" = `source='manual'`; favoritar/arquivar = `archived` (opcional `favorite boolean`).

---

## 3. Decisões de adequação (delegadas a mim em "adeque ao nosso sistema")
1. **Migration aditiva `0006`** (DB vazio) — sem migração de dados; mantém 0001 validado.
2. **Produto**: campos fiscais/logísticos como **colunas reais** (não jsonb) — melhor para futuras integrações ERP/marketplace e filtros. Estrutura "completa".
3. **Metas**: modelo genérico `metric` + `target_value` (substitui os dois alvos fixos); view reescrita.
4. **Comissão**: mantém `platform = publication_platform`; adiciona `calc_base`. Canal "loja própria" fica como evolução.
5. **Enums novos** (consistência com o schema): `org_plan`, `org_status`, `product_type`, `product_unit`, `goal_metric`, `commission_base`.

---

## 4. Plano de implementação (por camada — funções primeiro)

Ordem: **schema → contratos (shared) → API → worker → funções de mídia/IA/gravação → onboarding → hardening**. UI = "ligar endpoints ao template já preparado" (sem trabalho de layout).

### Fase 0 — Fundação de schema
- **T1** Migration `0006_full_structure.sql`: colunas/enums das seções 1.1–1.6, 1.8–1.9 + `videos.quality_check` + `payouts.receipt_key` + `product_images.is_primary`. Aplicar como `openrate_owner` (entrar no `first-up.sh`).
- **T2** Refatorar **metas**: schema (`metric`/`target_value`) + reescrever `v_goal_progress_daily` + `createGoalSchema` + `goals.ts` + tela.

### Fase A' — Contratos e componentes funcionais
- **T3** `@openrate/shared`: novos enums + DTOs Zod de todos os cadastros; helpers puros de validação/máscara (CPF/CNPJ/CEP/telefone, dígito verificador).
- **T4** Componentes de form (lógica, não visual): `MaskedInput`, `CurrencyInput`, `TagInput`, `RichTextEditor`, `AddressAutocomplete` (CEP), `PercentageSplitInput` (soma ≤100%).

### Fase B — Cadastros 100% pela UI (endpoints + validação)
- **T5** Orgs: create/update com `trade_name`/`plan`/`status` + transições de status (super_admin).
- **T6** Lojas: create/update com `phone`/`whatsapp`/`address` estruturado.
- **T7** Usuários: CRUD + invite com `storeIds[]`/`defaultStoreId`; `must_change_password` + `POST /v1/auth/change-password`; reset de senha (admin); enviar senha temporária via WhatsApp (enfileira notificação).
- **T8** Catálogo: CRUD de **brands** (+ upload de logo) e **categories** (árvore); CRUD de **video-types** (`icon`, `script_skeleton`).
- **T9** Produtos: CRUD completo (todas as abas); upload múltiplo de imagens (presign) + imagem principal + reordenar; CRUD de **variações** e de **estoque por loja**.
- **T10** Comissão: `calc_base` no schema/DTO/motor; manter simulador.
- **T11** **Customers** (novo módulo): CRUD + filtros (CRM da loja).
- **T12** **Store sales** (novo módulo): lançamento manual + listagem (performance offline).
- **T13** Wizard de onboarding (org→loja→convite→produto→ideias) + checklist "primeiros passos" no dashboard (usa endpoints existentes).

### Fase C — Conteúdo: IA, vídeo, download
- **T14** Ideias de IA: criar ideia manual (`source='manual'`), "gerar mais deste tipo" (por `video_type_id`), duplicar/adaptar, favoritar/arquivar.
- **T15** Gravação guiada `/app/record/:ideaId`: teleprompter (auto-scroll por `target_duration`) e checklist de passos a partir de `video_ideas.script`, com cronômetro (lógica; visual pelo template).
- **T16** Worker `video-processing`: gravar `quality_check` (ffprobe) e **watermark por loja** (logo de `stores`/`brands` no MinIO em vez de "OpenRate" fixo).
- **T17** Notificações órfãs: enfileirar `video_approved`/`video_rejected` (em `videos.ts`), `goal_reached` e `commission_credited` (na ingestão/settlement), `image_release`.
- **T18** Status do pipeline in-app (badges) + central de notificações (`GET /v1/notifications`) — tira o Bull Board da UX do usuário.
- **T19** Downloads: presigned GET (vídeo final + thumbnail); recibo de payout (gera PDF → `receipt_key` → download); export CSV de comissões/vendas/payouts. (Zip em lote: opcional, depois.)
- **T20** Publicações/afiliado: lista com cliques + copiar link (toast); paginação/busca/filtro nas listas.

### Fase D — Hardening (paralelo)
- **T21** `audit_log` como interceptor (tabela existe, ninguém grava).
- **T22** Gate de cessão de imagem (Docuseal) antes de liberar gravação.
- **T23** Testes: isolamento RLS, idempotência de settlement, reconciliação de dashboard.
- **T24** Escala (stubs): payout Asaas real (atenção: sem retry), metrics-sync (Browserless), conectores Olist/marketplaces.

---

## 5. Ordem recomendada
T1 → T2 → T3/T4 → (Fase B: T5…T13) → (Fase C: T14…T20) → Fase D em paralelo a partir de T1.
Parte 1 (correção) e Fase A (design system) já estão concluídas e no ar.
