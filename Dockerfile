FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.app.json tsconfig.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src

ARG PUBLIC_API_URL
ARG PUBLIC_ESCROW_ADDRESS
ARG PUBLIC_SETTLEMENT_TOKEN_ADDRESS
RUN VITE_API_URL="${PUBLIC_API_URL}" \
    VITE_ESCROW_ADDRESS="${PUBLIC_ESCROW_ADDRESS}" \
    VITE_SETTLEMENT_TOKEN="${PUBLIC_SETTLEMENT_TOKEN_ADDRESS}" \
    npm run build

FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY deploy/staging/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
