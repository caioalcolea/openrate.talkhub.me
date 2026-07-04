-- ============================================================================
-- OpenRate — Migration 0002_affiliate_link_resolver
--
-- Resolver do redirect PÚBLICO de link de afiliado (/r/:code). O redirect não
-- tem claim de org (o link é público e cross-tenant), então o FORCE RLS de
-- affiliate_links bloquearia a leitura/contagem. Esta função SECURITY DEFINER,
-- de propriedade de um SUPERUSUÁRIO, contorna o RLS de forma CONTROLADA: expõe
-- apenas a resolução por código EXATO + incremento de cliques — nunca permite
-- enumerar links de outras orgs.
--
-- ⚠️  APLICAR COMO postgres (superuser). Se rodar como openrate_owner
--     (não-superuser), a função fica dona dele e NÃO contorna o FORCE RLS.
--     psql -U postgres -d postgres --single-transaction -v ON_ERROR_STOP=1 \
--       -f <(sed '/^-- migrate:down/,$d' 0002_affiliate_link_resolver.sql)
-- ============================================================================

-- migrate:up
SET search_path TO openrate, public;

CREATE OR REPLACE FUNCTION openrate.click_affiliate_link(p_code text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = openrate
AS $$
  UPDATE openrate.affiliate_links
     SET clicks_count = clicks_count + 1
   WHERE short_code = p_code AND active = true
  RETURNING destination_url;
$$;

-- Só a role de runtime pode executar; ninguém mais.
REVOKE ALL ON FUNCTION openrate.click_affiliate_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openrate.click_affiliate_link(text) TO openrate_app;

-- migrate:down
DROP FUNCTION IF EXISTS openrate.click_affiliate_link(text);
