# syntax=docker/dockerfile:1
#
# Yakka: one image for Postgres or SQLite (picked at runtime from
# DATABASE_URL). See docs/DEPLOYMENT.md.
#
#   docker build -t yakka .
#   docker run -p 3000:3000 -v yakka-data:/data yakka            # SQLite in /data
#   docker run -p 3000:3000 -e DATABASE_URL=postgresql://... yakka
#
# Debian slim rather than Alpine: Prisma's schema engine and better-sqlite3's
# prebuilt binaries target glibc.

# Node 24 (npm 11): the lockfile is written by npm 11, which npm 10 rejects.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# --- Dependencies (+ both generated Prisma clients via postinstall) ----------
FROM base AS deps
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# --- Build: service worker bundle + Next standalone output --------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/src/generated ./src/generated
ENV NEXT_OUTPUT=standalone
RUN npm run build

# --- Prisma CLI for `migrate deploy` at start-up ------------------------------
# The standalone output doesn't include the CLI, so install exactly the
# locked versions into their own directory.
FROM base AS migrator
WORKDIR /migrator
COPY package-lock.json /tmp/package-lock.json
RUN set -eu; \
  v() { node -p "require('/tmp/package-lock.json').packages['node_modules/$1'].version"; }; \
  echo '{"name":"yakka-migrator","private":true}' > package.json; \
  npm install --no-audit --no-fund --omit=dev "prisma@$(v prisma)" "dotenv@$(v dotenv)"; \
  rm /tmp/package-lock.json

# --- Runtime ------------------------------------------------------------------
FROM base AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 yakka \
  && useradd --system --uid 1001 --gid yakka --home /app yakka \
  && mkdir -p /data \
  && chown yakka:yakka /data

ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  ENABLE_INTERNAL_CRON=true

COPY --from=builder --chown=yakka:yakka /app/.next/standalone ./
COPY --from=builder --chown=yakka:yakka /app/.next/static ./.next/static
COPY --from=builder --chown=yakka:yakka /app/public ./public
COPY --from=migrator /migrator/node_modules ./migrator/node_modules
COPY prisma.config.ts ./migrator/prisma.config.ts
COPY prisma ./migrator/prisma
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/yakka-entrypoint

USER yakka
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/liveness').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "yakka-entrypoint"]
CMD ["node", "server.js"]
