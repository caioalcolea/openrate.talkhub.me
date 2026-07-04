# Bull Board — UI de observabilidade das filas.
# Contexto de build = raiz do monorepo (compartilha packages/shared).
#   docker build -t talkhub/openrate-bullboard:latest -f apps/bullboard/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/bullboard/package.json apps/bullboard/
RUN pnpm install --frozen-lockfile --filter @openrate/bullboard...
COPY packages/shared packages/shared
COPY apps/bullboard apps/bullboard
RUN pnpm --filter @openrate/shared build && pnpm --filter @openrate/bullboard build \
  && pnpm --filter @openrate/bullboard deploy --prod /app

FROM node:20-alpine AS runtime
ENV NODE_ENV=production TZ=America/Sao_Paulo PORT=3000
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "dist/index.js"]
