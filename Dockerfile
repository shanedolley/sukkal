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

# The Claude Code CLI, at one exact version, for the subscription path in
# src/memory/inference-live.ts (ADR-0027). The root filesystem is read only at
# run time, so the CLI keeps its config on the /tmp tmpfs, and its updater is off
# because the version is part of the release.
RUN npm install -g @anthropic-ai/claude-code@2.1.303 && npm cache clean --force
ENV CLAUDE_CONFIG_DIR=/tmp/claude DISABLE_AUTOUPDATER=1

COPY --from=build --chown=node:node /app ./
USER node
CMD ["node", "--env-file=/run/sukkal/env", "src/worker/index.ts"]
