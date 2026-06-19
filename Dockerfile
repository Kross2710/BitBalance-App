# syntax=docker/dockerfile:1
# BitBalance — one image that builds the Vue SPA and runs the Express server
# (Express serves /api + the built SPA + uploads on a single origin, :3000).
#
# Node is pinned to 20 for the BUILD because the project's Vite 5 silently breaks
# on very new Node (e.g. 26) — it drops @vitejs/plugin-vue and fails to parse
# .vue files. node:20-slim is Debian/glibc, so `sharp` pulls a prebuilt libvips
# binary (don't use bare alpine — it lacks libvips).

FROM node:20-slim AS build
WORKDIR /app

# Client: install deps, then build the SPA -> client/dist.
COPY client/package*.json client/
RUN cd client && npm ci
COPY client/ client/
RUN cd client && npm run build

# Server: production deps only, then source.
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY server/ server/

# ---- runtime image ----
FROM node:20-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
# The app writes uploads here (UPLOADS_ROOT = server/uploads); compose mounts a
# named volume over it so images survive image rebuilds.
RUN mkdir -p server/uploads
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/index.js"]
