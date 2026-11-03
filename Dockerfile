# ProtoLab — single-container build: API (Hono on Node) serving the built web app.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/schema/package.json packages/schema/
COPY packages/parts/package.json packages/parts/
COPY packages/simulator/package.json packages/simulator/
COPY packages/agent/package.json packages/agent/
RUN npm ci
COPY . .
RUN npm run build -w apps/web

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 8787
CMD ["npx", "tsx", "apps/api/src/server.ts"]
