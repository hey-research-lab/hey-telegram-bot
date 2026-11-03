# syntax=docker/dockerfile:1
# Build: docker build -t hey-telegram-bot:0.1.0 .
# No secret is read or baked in at build time; the token and webhook secret
# come from the environment when the container starts.
# The base image is pinned by digest (node:22-alpine as of 2026-11-03), so a rebuild uses the same
# bytes; Dependabot proposes a new digest when the tag moves.

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm build \
 && cat node_modules/zod/LICENSE node_modules/@hey-research-lab/sdk/LICENSE > THIRD_PARTY_LICENSES

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
ENV NODE_ENV=production
WORKDIR /app
# One self-contained file: no node_modules, no package manager at run time.
COPY --from=build /src/dist/main.js /app/main.js
COPY --from=build /src/THIRD_PARTY_LICENSES /app/THIRD_PARTY_LICENSES
COPY LICENSE /app/LICENSE
# The image's unprivileged user; the app writes nothing to disk.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/main.js", "healthcheck"]
ENTRYPOINT ["node", "/app/main.js"]
CMD ["webhook"]
