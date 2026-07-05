-- migrate:up
-- ============================================================================
-- OpenRate — Migration 0007_goals_refactor
--
-- Metas genéricas: em vez de dois alvos fixos (target_videos + target_sales_amount),
-- a meta escolhe UMA métrica (metric) e um valor alvo (target_value). A view diária
-- passa a medir a métrica escolhida. Banco vazio → sem migração de dados.
--
-- Aditiva/idempotente (o first-up.sh reaplica). ⚠️ APLICAR COMO openrate_owner
-- CONECTANDO DIRETO (sem SET ROLE).
-- ============================================================================

SET search_path TO openrate, public;

-- Enum da métrica (guardado para reexecução)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_metric' AND typnamespace = 'openrate'::regnamespace) THEN
    CREATE TYPE openrate.goal_metric AS ENUM ('videos_recorded', 'videos_published', 'views', 'affiliate_revenue');
  END IF;
END $$;

-- A view depende de target_videos: dropar ANTES de alterar a coluna.
DROP VIEW IF EXISTS openrate.v_goal_progress_daily;

ALTER TABLE openrate.goals
  ADD COLUMN IF NOT EXISTS metric       openrate.goal_metric NOT NULL DEFAULT 'videos_recorded',
  ADD COLUMN IF NOT EXISTS target_value numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE openrate.goals
  DROP COLUMN IF EXISTS target_videos,
  DROP COLUMN IF EXISTS target_sales_amount;

-- ----------------------------------------------------------------------------
-- View: progresso diário por usuário, medindo a métrica da meta.
-- security_invoker: herda o RLS das tabelas base. Datas em America/Sao_Paulo.
-- current_value via subquery correlacionada por métrica (evita fan-out de JOINs).
-- ----------------------------------------------------------------------------
CREATE VIEW openrate.v_goal_progress_daily
WITH (security_invoker = true) AS
WITH ref AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS ref_date
),
goal_users AS (
  SELECT
    g.id              AS goal_id,
    g.organization_id,
    g.store_id,
    g.metric,
    g.target_value,
    u.id              AS user_id
  FROM openrate.goals g
  CROSS JOIN ref
  JOIN openrate.users u
    ON u.organization_id = g.organization_id
   AND u.active
   AND u.deleted_at IS NULL
   AND (
        (g.user_id IS NOT NULL AND u.id = g.user_id)
     OR (g.user_id IS NULL AND u.role = 'attendant')
   )
   AND (
        g.store_id IS NULL
     OR EXISTS (
          SELECT 1 FROM openrate.user_stores us
          WHERE us.user_id = u.id AND us.store_id = g.store_id
        )
   )
  WHERE g.period = 'daily'
    AND g.active
    AND (g.valid_from  IS NULL OR g.valid_from  <= ref.ref_date)
    AND (g.valid_until IS NULL OR g.valid_until >= ref.ref_date)
),
progress AS (
  SELECT
    gu.organization_id,
    gu.goal_id,
    gu.user_id,
    r.ref_date,
    gu.metric,
    gu.target_value,
    CASE gu.metric
      WHEN 'videos_recorded' THEN (
        SELECT count(*)::numeric FROM openrate.videos v
        WHERE v.user_id = gu.user_id
          AND (gu.store_id IS NULL OR v.store_id = gu.store_id)
          AND v.uploaded_at IS NOT NULL
          AND (v.uploaded_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
      WHEN 'videos_published' THEN (
        SELECT count(*)::numeric
        FROM openrate.video_publications p
        JOIN openrate.videos v ON v.id = p.video_id
        WHERE v.user_id = gu.user_id
          AND (gu.store_id IS NULL OR v.store_id = gu.store_id)
          AND p.published_at IS NOT NULL
          AND (p.published_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
      WHEN 'views' THEN (
        SELECT COALESCE(SUM(p.views_count), 0)::numeric
        FROM openrate.video_publications p
        JOIN openrate.videos v ON v.id = p.video_id
        WHERE v.user_id = gu.user_id
          AND (gu.store_id IS NULL OR v.store_id = gu.store_id)
          AND p.published_at IS NOT NULL
          AND (p.published_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
      WHEN 'affiliate_revenue' THEN (
        SELECT COALESCE(SUM(s.commissionable_amount), 0)::numeric
        FROM openrate.affiliate_sales s
        WHERE s.user_id = gu.user_id
          AND (gu.store_id IS NULL OR s.store_id = gu.store_id)
          AND s.status = 'confirmed'
          AND (s.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = r.ref_date
      )
    END AS current_value
  FROM goal_users gu
  CROSS JOIN ref r
)
SELECT
  organization_id,
  goal_id,
  user_id,
  ref_date,
  metric,
  target_value,
  current_value,
  (current_value >= target_value) AS goal_met,
  ROUND(LEAST(100.0 * current_value / NULLIF(target_value, 0), 100.0), 1) AS progress_pct
FROM progress;

COMMENT ON VIEW openrate.v_goal_progress_daily IS
  'Progresso da meta diária por usuário conforme a métrica (videos_recorded/videos_published/views/affiliate_revenue) vs target_value. security_invoker: herda o RLS das tabelas base.';

-- migrate:down
SET search_path TO openrate, public;

DROP VIEW IF EXISTS openrate.v_goal_progress_daily;

ALTER TABLE openrate.goals
  ADD COLUMN IF NOT EXISTS target_videos integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS target_sales_amount numeric(14,2);
ALTER TABLE openrate.goals
  DROP COLUMN IF EXISTS target_value,
  DROP COLUMN IF EXISTS metric;

DROP TYPE IF EXISTS openrate.goal_metric;

CREATE VIEW openrate.v_goal_progress_daily
WITH (security_invoker = true) AS
WITH ref AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS ref_date)
SELECT g.organization_id, g.id AS goal_id, g.user_id, r.ref_date, g.target_videos,
       0::bigint AS videos_submitted, 0::bigint AS videos_approved,
       false AS goal_met, 0.0 AS progress_pct
FROM openrate.goals g CROSS JOIN ref r WHERE g.period = 'daily' AND g.active;
