-- ============================================================================
-- OpenRate — Migration 0003_seed_video_types
--
-- Tipos de vídeo GLOBAIS (organization_id NULL) usados pelo job
-- ai-script-generation. São lidos por qualquer org (policy platform_read).
--
-- ⚠️  APLICAR COMO postgres (superuser): inserir linhas org-null é bloqueado
--     pelo FORCE RLS para roles não-superuser (a policy exige org = claim).
-- ============================================================================

-- migrate:up
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

-- migrate:down
DELETE FROM openrate.video_types
 WHERE organization_id IS NULL
   AND slug IN ('unboxing','review','antes-depois','demonstracao','tutorial');
