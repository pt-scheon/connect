# Build
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# An invented database for test copies (scripts/start.js). Made here from the scripts, never copied from a real one.
RUN DATABASE_PATH=/app/fake-db/connect.db node scripts/setup.js --db-only \
 && node -e "const d=new (require('better-sqlite3'))('/app/fake-db/connect.db');d.pragma('wal_checkpoint(TRUNCATE)');d.pragma('journal_mode=DELETE')"

# Run
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/connect.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/fake-db ./fake-db
COPY --from=build /app/scripts/start.js ./start.js
# Run by hand once after deploying: takes names out of lines stored earlier. It backs up first (see the top of the file).
COPY --from=build /app/scripts/backfill-names.js ./backfill-names.js
# The database and uploads live in /data. Mount a persistent volume there (on Railway: a service volume at
# /data), or everything is lost on every deploy. No VOLUME line: Railway refuses Dockerfiles that have one.
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start.js"]
