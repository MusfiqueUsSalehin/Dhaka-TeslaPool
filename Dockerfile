# One image that serves both the API and the built React app (same origin => simple,
# secure cookies and a single free-tier service to deploy).

# ---- 1. Build the React client -------------------------------------------------
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---- 2. Install production server dependencies ---------------------------------
FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- 3. Runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    CLIENT_DIST_DIR=/app/client/dist
WORKDIR /app/server

COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY server/seeds ./seeds
COPY server/docker-entrypoint.sh ./
COPY --from=client-build /app/client/dist /app/client/dist

# Don't run as root inside the container.
USER node
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["sh", "./docker-entrypoint.sh"]
