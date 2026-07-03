# Worker: Node + FFmpeg + faster-whisper (transcrição em CPU).
# Contexto de build = raiz do monorepo (compartilha packages/shared).
#   docker build -t talkhub/openrate-worker:latest -f apps/worker/Dockerfile .
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @openrate/worker...
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN pnpm --filter @openrate/shared build && pnpm --filter @openrate/worker build \
  && pnpm --filter @openrate/worker deploy --prod /app

FROM node:20-alpine AS runtime
# ffmpeg para edição; python3 + faster-whisper para transcrição em CPU.
RUN apk add --no-cache ffmpeg python3 py3-pip \
  && pip3 install --no-cache-dir --break-system-packages faster-whisper
ENV NODE_ENV=production TZ=America/Sao_Paulo
WORKDIR /app
COPY --from=build /app /app
# O modelo "small" é baixado no primeiro uso (ou pré-baixe aqui para acelerar).
CMD ["node", "dist/main.js"]
