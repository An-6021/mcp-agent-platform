FROM node:20-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY LICENSE README.md ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile

ARG PUBLIC_BASE_URL=https://mcp.a1yu.com
ENV MCP_CONTROL_PLANE_PUBLIC_BASE_URL=${PUBLIC_BASE_URL}

RUN pnpm build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100
ENV MCP_CONTROL_PLANE_DATA_DIR=/app/data

EXPOSE 3100

CMD ["node", "apps/control-plane-api/dist/cli.js", "--host", "0.0.0.0", "--port", "3100", "--data-dir", "/app/data"]
