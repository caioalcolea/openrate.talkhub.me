# API NestJS. Contexto de build = raiz do monorepo (compartilha packages/shared).
#   docker build -t talkhub/openrate-api:latest -f apps/api/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @openrate/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
# --legacy: no pnpm v10 o `deploy` recusa workspaces não-injetados por padrão
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE). --legacy restaura o comportamento que
# empacota @openrate/shared no /app. (packageManager fixa pnpm@10 via corepack.)
RUN pnpm --filter @openrate/shared build && pnpm --filter @openrate/api build \
  && pnpm --filter @openrate/api deploy --prod --legacy /app

FROM node:20-alpine AS runtime
ENV NODE_ENV=production TZ=America/Sao_Paulo PORT=3000
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "dist/main.js"]
