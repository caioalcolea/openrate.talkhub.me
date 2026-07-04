# Web (Next.js standalone): painel + PWA do atendente.
# Contexto de build = raiz do monorepo. NEXT_PUBLIC_API_URL é build-time.
#   docker build -t talkhub/openrate-web:latest \
#     --build-arg NEXT_PUBLIC_API_URL=https://openrate-api.talkhub.me -f apps/web/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
ARG NEXT_PUBLIC_API_URL=https://openrate-api.talkhub.me
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @openrate/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @openrate/shared build && pnpm --filter @openrate/web build

FROM node:20-alpine AS runtime
# HOSTNAME=0.0.0.0 é OBRIGATÓRIO: o server.js do Next standalone faz
# listen(PORT, process.env.HOSTNAME||'0.0.0.0'); o Swarm injeta HOSTNAME=<id-do-container>,
# que resolve só para o IP de overlay do container — o Node passaria a escutar
# apenas nesse IP e o healthcheck em 127.0.0.1:3000 daria ECONNREFUSED, deixando o
# serviço eternamente unhealthy (restart-loop + Traefik tira do LB → site fora).
ENV NODE_ENV=production TZ=America/Sao_Paulo PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Next standalone: inclui só o necessário para rodar.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
