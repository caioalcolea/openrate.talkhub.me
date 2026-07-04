-- ============================================================================
-- OpenRate — Migration 0004_own_auth
--
-- Autenticação PRÓPRIA da API (o gotrue compartilhado do Supabase tem o login por
-- e-mail/senha desabilitado — GOTRUE_EXTERNAL_EMAIL_ENABLED=false — e não podemos
-- mexer nele por ser infra compartilhada). A API passa a:
--   * guardar o hash da senha em openrate.users.password_hash (scrypt, feito no Node);
--   * emitir o próprio JWT HS256 (assinado com SUPABASE_JWT_SECRET) no mesmo shape
--     que o gotrue emitia — o guard/RLS não mudam.
--
-- login e bootstrap acontecem SEM claim de tenant (pré-autenticação), então o
-- FORCE RLS de users bloquearia. Resolvemos com uma policy só-para-o-owner + duas
-- funções SECURITY DEFINER (donas de openrate_owner) que expõem só o necessário.
--
-- ⚠️  APLICAR COMO openrate_owner CONECTANDO DIRETO (sem SET ROLE; o supautils do
--     supabase_db encerra a conexão em SET ROLE). O first-up.sh conecta via TCP+senha.
-- ============================================================================

-- migrate:up
SET search_path TO openrate, public;

-- id auto-gerado (antes vinha do auth.users do gotrue; agora é nosso) + coluna do hash.
ALTER TABLE openrate.users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE openrate.users ADD COLUMN IF NOT EXISTS password_hash text;

-- e-mail único (case-insensitive) entre usuários ativos — chave de login.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci
  ON openrate.users (lower(email)) WHERE deleted_at IS NULL;

-- Policy só-para-o-owner: as funções SECURITY DEFINER abaixo rodam como openrate_owner
-- e precisam ler/gravar usuários cross-tenant no login/bootstrap (sem claim). A role
-- de runtime openrate_app continua restrita às policies de tenant.
DROP POLICY IF EXISTS auth_owner_all ON openrate.users;
CREATE POLICY auth_owner_all ON openrate.users
  FOR ALL TO openrate_owner
  USING (true) WITH CHECK (true);

-- Lookup de login: retorna o hash + o contexto do tenant p/ a API validar a senha
-- (scrypt, no Node) e emitir o JWT. Só resolve por e-mail EXATO (case-insensitive).
CREATE OR REPLACE FUNCTION openrate.auth_find_user(p_email text)
RETURNS TABLE(
  id uuid, email text, password_hash text,
  organization_id uuid, store_id uuid, role openrate.user_role,
  full_name text, active boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = openrate AS $$
  SELECT u.id, u.email, u.password_hash, u.organization_id,
         -- users não tem store_id; a loja do usuário vem de user_stores (junção).
         (SELECT us.store_id FROM openrate.user_stores us WHERE us.user_id = u.id LIMIT 1) AS store_id,
         u.role, u.full_name, u.active
  FROM openrate.users u
  WHERE lower(u.email) = lower(p_email) AND u.deleted_at IS NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION openrate.auth_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openrate.auth_find_user(text) TO openrate_app;

-- Bootstrap do PRIMEIRO super_admin (organization_id NULL). AUTO-DESABILITA: só cria
-- se ainda não houver nenhum super_admin — seguro para expor num endpoint público de
-- primeiro acesso (POST /v1/auth/bootstrap). Depois disso sempre falha (23505).
CREATE OR REPLACE FUNCTION openrate.bootstrap_super_admin(
  p_email text, p_full_name text, p_password_hash text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = openrate AS $$
DECLARE new_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM openrate.users WHERE role = 'super_admin') THEN
    RAISE EXCEPTION 'super_admin ja existe' USING errcode = 'unique_violation';
  END IF;
  INSERT INTO openrate.users (organization_id, role, email, full_name, password_hash)
  VALUES (NULL, 'super_admin', p_email, p_full_name, p_password_hash)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION openrate.bootstrap_super_admin(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION openrate.bootstrap_super_admin(text, text, text) TO openrate_app;

-- migrate:down
DROP FUNCTION IF EXISTS openrate.bootstrap_super_admin(text, text, text);
DROP FUNCTION IF EXISTS openrate.auth_find_user(text);
DROP POLICY IF EXISTS auth_owner_all ON openrate.users;
DROP INDEX IF EXISTS openrate.uq_users_email_ci;
ALTER TABLE openrate.users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE openrate.users ALTER COLUMN id DROP DEFAULT;
