-- migrate:up
-- ============================================================================
-- 0005 — remove o fallback para auth.jwt() em openrate.jwt_claims()
-- ----------------------------------------------------------------------------
-- A auth é 100% própria da API: os claims SEMPRE chegam via
-- set_config('request.jwt.claims', <json>, true) por transação. O fallback
-- para auth.jwt() (função de terceiros que pode nem existir) era código morto
-- protegido por EXCEPTION — aqui ele sai de vez. Sem dependência de schema/função
-- externa de auth.
--
-- Aplicar COMO openrate_owner (dono da função), conexão direta (sem SET ROLE).
-- ============================================================================

CREATE OR REPLACE FUNCTION openrate.jwt_claims()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
BEGIN
  BEGIN
    claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    claims := NULL;
  END;
  RETURN claims;
END;
$$;

COMMENT ON FUNCTION openrate.jwt_claims() IS
  'Claims do JWT lidos de request.jwt.claims (injetados pela API via set_config por transação).';

-- migrate:down
CREATE OR REPLACE FUNCTION openrate.jwt_claims()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
BEGIN
  BEGIN
    claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    claims := NULL;
  END;
  IF claims IS NOT NULL THEN
    RETURN claims;
  END IF;
  BEGIN
    claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    claims := NULL;
  END;
  RETURN claims;
END;
$$;
