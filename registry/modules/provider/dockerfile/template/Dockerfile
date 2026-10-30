# One container: the Bun API serves the built SPA from a single origin.
#
# The bun tag must match the root package.json `packageManager`, which is the one source of
# truth for this repo's Bun version.
FROM oven/bun:1.4.2 AS bun

# React Router prerenders the SPA through Vite preview, which needs a real Node — Bun alone
# cannot run that step. Harvested from bonne-garde-keeper, where this was found the hard way.
FROM node:24-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV HUSKY=0
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter '{{SCOPE}}/spa' build

FROM oven/bun:1.4.2-slim
WORKDIR /app
ENV NODE_ENV=production PORT=5172 DATA_DIR=/data APP_URL=http://localhost:5172
# The runtime stage keeps the whole workspace so `docker exec <container> bun run <script>` works.
COPY --from=build --chown=bun:bun /app /app
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 5172
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:5172/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "apps/api/src/index.ts"]
