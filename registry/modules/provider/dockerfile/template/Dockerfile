# One container: the API, on Node, serves the built SPA from a single origin.
#
# The project installs with the package manager its package.json pins (`packageManager`, written by its
# `pm` module): npm installs that exact version first, so this file names none and never drifts from it.
FROM node:24-slim AS build
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
# The root build script builds whichever apps the project has, so a project with no SPA still builds.
RUN pinned="$(node -p 'require("./package.json").packageManager')" \
  && npm install --global "$pinned" \
  && "${pinned%@*}" install --frozen-lockfile \
  && "${pinned%@*}" run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=5172 DATA_DIR=/data APP_URL=http://localhost:5172
# The runtime stage keeps the whole workspace, so `docker exec <container> node_modules/.bin/vp run
# <script>` runs a script of the project.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 5172
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# tsx loaded into Node itself, not as a parent process, so Node is PID 1 and gets `docker stop`'s signal.
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
