# One container: the site, the API, the relayer and the Telegram bot.
# Secrets come from the host's secret store as environment variables (see .env.example).
# Mount a persistent volume at /data for the SQLite file.
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @alat/web build
ENV NODE_ENV=production PORT=8787 ALAT_DB_PATH=/data/alat.db NODE_NO_WARNINGS=1
EXPOSE 8787
CMD ["pnpm", "--filter", "@alat/server", "start"]
