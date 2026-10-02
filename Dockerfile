# syntax=docker/dockerfile:1
# Build: docker build -t hey-telegram-bot:0.1.0 .
# No secret is read or baked in at build time; the token and webhook secret
# come from the environment when the container starts.

FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm build \
 && cat node_modules/zod/LICENSE node_modules/@hey-research-lab/sdk/LICENSE > THIRD_PARTY_LICENSES

FROM node:22-alpine
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
