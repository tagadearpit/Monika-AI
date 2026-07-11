FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY backend/ ./
COPY public/ ../public/

USER node
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-10000}/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
