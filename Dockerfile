# One image runs both processes. compose.yaml picks the command.
#
# Build on the Mac or in CI, never on amaterasu. docs/runbooks/deploy.md has
# the --platform flag for the box.

FROM node:22.23-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# The lockfile and both manifests first, so a source change keeps this layer.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build --workspace sukkal-web \
 && npm prune --omit=dev

FROM node:22.23-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app ./
USER node
CMD ["node", "--env-file=/run/sukkal/env", "src/worker/index.ts"]
