FROM mcr.microsoft.com/playwright:v1.64.0-noble
USER root
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate && apt-get update && apt-get install -y --no-install-recommends nftables gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/scanner packages/scanner
COPY apps/runner apps/runner
RUN pnpm install --frozen-lockfile --filter @sonda/runner...
COPY infra/runner-firewall.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
