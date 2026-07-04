-- ============================================================================
-- OpenRate — Migration 0002_affiliate_link_resolver
--
-- Resolver do redirect PÚBLICO de link de afiliado (/r/:code). O redirect não
-- tem claim de org (o link é público e cross-tenant), então o FORCE RLS de
-- affiliate_links bloquearia a leitura/contagem para o executor.
--
-- Como o "postgres" do supabase_db NÃO é superuser, não há um superusuário para
-- ser dono da função e contornar o FORCE RLS. A solução — equivalente e
-- controlada, SEM superuser e MANTENDO o FORCE RLS na tabela (invariante do
-- 0001) — é:
--   * uma policy que se aplica APENAS à role dona (openrate_owner);
--   * a função SECURITY DEFINER é dona de openrate_owner, então roda com a role
--     do dono e essa policy vale para ela → resolve o código EXATO cross-tenant.
--   A role de runtime openrate_app continua restrita à sua policy tenant_isolation
--   (a policy do owner NÃO se aplica a ela), sem enumeração de links de terceiros.
--
-- ⚠️  APLICAR COMO openrate_owner CONECTANDO DIRETO (não use SET ROLE: no supabase_db
--     o supautils encerra a conexão em SET ROLE). O first-up.sh conecta como owner via
--     TCP+senha. Manualmente:
--       sed '/^-- migrate:down/,$d' 0002_affiliate_link_resolver.sql \
--       | PGPASSWORD=<owner_pw> psql -h 127.0.0.1 -U openrate_owner -d postgres \
--           --single-transaction -v ON_ERROR_STOP=1 -f -
-- ============================================================================

-- migrate:up
SET search_path TO openrate, public;

-- Policy que dá acesso total à role DONA (openrate_owner) — e só a ela — em
-- affiliate_links, mantendo FORCE RLS ativo. É por ela que a função SECURITY
-- DEFINER abaixo resolve o link no redirect público cross-tenant.
DROP POLICY IF EXISTS resolver_owner_all ON openrate.affiliate_links;
CREATE POLICY resolver_owner_all ON openrate.affiliate_links
  FOR ALL TO openrate_owner
  USING (true) WITH CHECK (true);

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
DROP POLICY IF EXISTS resolver_owner_all ON openrate.affiliate_links;
