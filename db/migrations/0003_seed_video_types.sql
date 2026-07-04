-- ============================================================================
-- OpenRate — Migration 0003_seed_video_types
--
-- Tipos de vídeo GLOBAIS (organization_id NULL) usados pelo job
-- ai-script-generation. São lidos por qualquer org (policy platform_read).
--
-- Inserir linhas org-null é bloqueado pelo FORCE RLS (a policy tenant_isolation
-- exige organization_id = claim, e sem claim current_org_id() é NULL). Como o
-- "postgres" do supabase_db não é superuser, aplicamos como o DONO
-- (openrate_owner) suspendendo o FORCE só durante o seed e restaurando em
-- seguida — ao final a tabela volta a FORÇAR RLS (invariante do 0001).
--
-- ⚠️  APLICAR COMO openrate_owner (o first-up.sh faz SET ROLE automaticamente).
--     A suspensão do FORCE ocorre dentro da mesma transação (--single-transaction).
-- ============================================================================

-- migrate:up
-- Suspende o FORCE só para o dono conseguir inserir as linhas globais…
ALTER TABLE openrate.video_types NO FORCE ROW LEVEL SECURITY;

INSERT INTO openrate.video_types (organization_id, name, slug, description, prompt_template, default_duration_seconds)
VALUES
  (NULL, 'Unboxing', 'unboxing', 'Abertura do produto com reações e destaques.',
   'Mostre a embalagem, abra na frente da câmera, destaque 3 diferenciais e feche com CTA.', 45),
  (NULL, 'Review', 'review', 'Avaliação honesta com prós e um contra.',
   'Apresente o produto, liste 3 prós e 1 ponto de atenção, dê uma nota e CTA.', 60),
  (NULL, 'Antes e Depois', 'antes-depois', 'Transformação/resultado do uso do produto.',
   'Mostre o antes, aplique/use o produto, revele o depois e CTA.', 30),
  (NULL, 'Demonstração', 'demonstracao', 'Produto em uso real, passo a passo.',
   'Explique para que serve, demonstre o uso em 3 passos e CTA.', 45),
  (NULL, 'Tutorial', 'tutorial', 'Ensina a usar/aplicar o produto.',
   'Liste o que é preciso, ensine em passos numerados e feche com dica extra + CTA.', 60)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- …e restaura o FORCE imediatamente (a tabela nunca fica sem FORCE em repouso).
ALTER TABLE openrate.video_types FORCE ROW LEVEL SECURITY;

-- migrate:down
DELETE FROM openrate.video_types
 WHERE organization_id IS NULL
   AND slug IN ('unboxing','review','antes-depois','demonstracao','tutorial');
