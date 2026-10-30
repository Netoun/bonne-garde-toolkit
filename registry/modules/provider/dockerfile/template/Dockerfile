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
# Debian resolves `localhost` to ::1 first, so the prerender's Vite preview server listens on ::1
# while React Router fetches it on 127.0.0.1 and gets ECONNREFUSED. IPv4 first makes both agree.
ENV HUSKY=0 NODE_OPTIONS=--dns-result-order=ipv4first
# Vite bakes `VITE_API_URL` into the SPA bundle when it builds, and the SPA throws at load without a
# valid one. It has to be the origin the browser reaches the container on — the same as `APP_URL`
# at run time — so a different origin means a rebuild: `--build-arg VITE_API_URL=https://...`.
ARG VITE_API_URL=http://localhost:5172
ENV VITE_API_URL=$VITE_API_URL
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
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "apps/api/src/index.ts"]
