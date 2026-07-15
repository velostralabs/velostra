FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S velostra && adduser -S -G velostra velostra
COPY --from=build --chown=velostra:velostra /app/package.json ./package.json
COPY --from=build --chown=velostra:velostra /app/node_modules ./node_modules
COPY --from=build --chown=velostra:velostra /app/dist ./dist
COPY --chown=velostra:velostra drizzle ./drizzle
USER velostra
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/index.js"]
