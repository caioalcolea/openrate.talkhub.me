#!/usr/bin/env bash
# ============================================================================
# OpenRate — REDEPLOY completo e LIMPO (rebuild SEM cache). Rode na RAIZ do repo,
# no nó MANAGER do Swarm:
#
#   bash redeploy.sh                # preserva o volume das filas (openrate_redis_data)
#   bash redeploy.sh --wipe-redis   # zera também as filas do BullMQ
#
# O que faz:
#   1. Remove a stack "openrate" e ESPERA ela descer por completo.
#   2. (opcional) apaga o volume das filas.
#   3. Remove SÓ as imagens do OpenRate (talkhub/openrate-*).
#   4. Chama deploy/first-up.sh com NO_CACHE=1 → rebuild sem cache + migrations
#      idempotentes + bucket + redeploy + smoke.
#
# ⚠️  SERVIDOR COMPARTILHADO (~30 stacks). Este script mexe SOMENTE no OpenRate.
#     NUNCA faz `docker system/image/volume/builder prune` GLOBAL — isso apagaria
#     imagens, volumes e cache de OUTROS produtos e derrubaria a produção deles.
#
# PRESERVA (não apaga): o banco (schema openrate no supabase_db compartilhado), o
# bucket MinIO (openrate-media) e, por padrão, o volume openrate_redis_data.
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"
STACK="openrate"

c_g="\033[1;32m"; c_y="\033[1;33m"; c_r="\033[1;31m"; c_0="\033[0m"
log(){ printf "${c_g}▶ %s${c_0}\n" "$*"; }
warn(){ printf "${c_y}⚠ %s${c_0}\n" "$*"; }
die(){ printf "${c_r}✖ %s${c_0}\n" "$*" >&2; exit 1; }

WIPE_REDIS="no"
[ "${1:-}" = "--wipe-redis" ] && WIPE_REDIS="yes"

command -v docker >/dev/null || die "docker não encontrado."
docker node ls >/dev/null 2>&1 || die "este nó NÃO é manager do Swarm."
[ -f deploy/first-up.sh ] || die "deploy/first-up.sh não encontrado — rode na RAIZ do repo."
[ -f deploy/.env ]        || die "deploy/.env não encontrado — crie a partir de deploy/.env.example."

# -------------------------------------------------------------- 1. remove a stack
log "1/4 Removendo a stack '$STACK' (as demais stacks NÃO são tocadas)"
docker stack rm "$STACK" 2>/dev/null || true

# -------------------------------------------------------------- 2. espera descer
log "2/4 Aguardando a stack sair por completo (serviços + containers)…"
ok=""
for _ in $(seq 1 90); do
  svc="$(docker service ls --filter "name=${STACK}_" -q | wc -l | tr -d ' ')"
  ctr="$(docker ps -a --filter "name=^${STACK}_" -q | wc -l | tr -d ' ')"
  if [ "$svc" = "0" ] && [ "$ctr" = "0" ]; then ok="1"; printf "\r  stack removida                         \n"; break; fi
  printf "\r  aguardando… serviços=%s containers=%s" "$svc" "$ctr"
  sleep 2
done
[ -n "$ok" ] || die "a stack não terminou de sair (containers/serviços ainda presentes). Rode de novo em instantes."

if [ "$WIPE_REDIS" = "yes" ]; then
  warn "  --wipe-redis: apagando o volume openrate_redis_data (zera as filas do BullMQ)"
  docker volume rm openrate_redis_data 2>/dev/null || true
fi

# -------------------------------------------------------------- 3. remove imagens do OpenRate
log "3/4 Removendo SÓ as imagens talkhub/openrate-* (rebuild limpo)"
imgs="$(docker images --format '{{.Repository}}:{{.Tag}}' \
        | grep -E '^talkhub/openrate-(api|worker|web|bullboard):' || true)"
if [ -n "$imgs" ]; then
  echo "$imgs" | xargs -r docker rmi -f 2>/dev/null || true
  log "  imagens do OpenRate removidas"
else
  log "  nenhuma imagem do OpenRate para remover"
fi

# -------------------------------------------------------------- 4. redeploy (sem cache)
log "4/4 Rebuild SEM cache + redeploy via deploy/first-up.sh"
log "     (banco e bucket são preservados; first-up.sh é idempotente)"
NO_CACHE=1 bash deploy/first-up.sh

log "Redeploy concluído."
