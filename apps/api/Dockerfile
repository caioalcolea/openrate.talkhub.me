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
RUN pnpm --filter @openrate/shared build && pnpm --filter @openrate/api build \
  && pnpm --filter @openrate/api deploy --prod /app

FROM node:20-alpine AS runtime
ENV NODE_ENV=production TZ=America/Sao_Paulo PORT=3000
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "dist/main.js"]
