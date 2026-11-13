# Servidor web (Next.js). El worker de IA se construye aparte (worker/Dockerfile).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next importa la configuración de la base al compilar, pero no se conecta aquí.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src/db ./src/db
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN mkdir -p /data/storage && chmod +x docker-entrypoint.sh
ENV STORAGE_DIR=/data/storage
VOLUME ["/data/storage"]
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["sh", "-c", "exec npm run start -- -H 0.0.0.0 -p ${PORT:-3000}"]
