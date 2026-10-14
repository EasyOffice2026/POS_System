# syntax=docker/dockerfile:1
# The API, built from the repository root:
#   docker build -f apps/api/Dockerfile -t pos-api .
# Two images come out of it (docs/deployment.md):
#   --target tools  migrations and the first group admin (all tools installed)
#   (default)       the API itself, small, with only what it runs on

# ---- build: every package installed, the database client made, the API bundled
FROM node:24-bookworm-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci && npm run build -w @pos/api

# ---- tools: runs "prisma migrate deploy" by default, or "npm run admin:create -w @pos/api ..."
FROM build AS tools
ENV NODE_ENV=production
WORKDIR /repo/apps/api
CMD ["node", "/repo/node_modules/prisma/build/index.js", "migrate", "deploy"]

# ---- runtime: the bundle and the packages it needs, run as an unprivileged user
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The lock file names every workspace, so their package.json files come along.
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/web/package.json apps/web/
COPY --from=build /repo/apps/print-bridge/package.json apps/print-bridge/
COPY --from=build /repo/packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace @pos/api --include-workspace-root=false --ignore-scripts \
  && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
