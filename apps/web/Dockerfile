# syntax=docker/dockerfile:1
# The web app, built from the repository root:
#   docker build -f apps/web/Dockerfile -t pos-web .
# nginx serves the built files and passes /api on to the API at API_URL (http://api:3000 unless
# set), with the security headers of docs/security-review.md. See docs/deployment.md.

FROM node:24-bookworm-slim AS build
WORKDIR /repo
COPY . .
# The web app needs no database client, so the install scripts are skipped.
RUN npm ci --ignore-scripts && npm run build -w @pos/web

FROM nginx:1.28-alpine
ENV API_URL=http://api:3000
COPY apps/web/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
