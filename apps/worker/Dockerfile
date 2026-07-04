# Worker: Node + FFmpeg + whisper-ctranslate2 (transcrição em CPU).
# Contexto de build = raiz do monorepo (compartilha packages/shared).
#   docker build -t talkhub/openrate-worker:latest -f apps/worker/Dockerfile .
#
# Base glibc (bookworm-slim), NÃO alpine: os wheels de ctranslate2/onnxruntime
# (dependências do whisper-ctranslate2) só existem para manylinux/glibc. No musl
# do Alpine o pip não acha wheel, cai num build de fonte (cmake/C++17/BLAS) que
# não está presente, e o `docker build` do worker falha. Build e runtime usam a
# MESMA libc para não haver mismatch de binários nativos do node_modules.
FROM node:20-bookworm-slim AS build
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

FROM node:20-bookworm-slim AS runtime
# ffmpeg para edição; whisper-ctranslate2 fornece o CLI de transcrição em CPU
# (usa faster-whisper/CTranslate2 por baixo). É o binário chamado em
# src/lib/whisper.ts. Em glibc o pip instala wheels prontos — sem toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && pip3 install --no-cache-dir --break-system-packages whisper-ctranslate2 \
  && which whisper-ctranslate2 \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=America/Sao_Paulo
WORKDIR /app
COPY --from=build /app /app
# O modelo "small" é baixado no primeiro uso (ou pré-baixe aqui para acelerar).
CMD ["node", "dist/main.js"]
