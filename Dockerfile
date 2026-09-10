FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 OTKLIK_DB_PATH=/app/data/otklik.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY server.js store.js ./
COPY scripts/backup.js ./scripts/backup.js

RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/readyz || exit 1
CMD ["npm", "start"]
