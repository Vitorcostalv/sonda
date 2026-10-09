FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json turbo.json ./
RUN pnpm install --frozen-lockfile && pnpm db:generate
FROM base AS web
RUN pnpm --filter @sonda/web build
USER node
CMD ["pnpm","--filter","@sonda/web","start"]
FROM base AS api
RUN mkdir /app/storage && chown node:node /app/storage
USER node
CMD ["pnpm","--filter","@sonda/api","start"]
FROM base AS worker
RUN mkdir /app/storage && chown node:node /app/storage
USER node
CMD ["pnpm","--filter","@sonda/worker","start"]
FROM base AS migrate
USER node
CMD ["pnpm","db:migrate"]
FROM base AS egress
USER root
RUN apt-get update && apt-get install -y --no-install-recommends nftables gosu && rm -rf /var/lib/apt/lists/*
COPY infra/egress-firewall.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
