# API de Pedilo (ADR 0024). Se construye desde la raíz del monorepo:
#   docker build -f services/api/Dockerfile .
# Corre el TypeScript con tsx, igual que `npm start`; empaquetar queda para cuando haga falta.
FROM node:22-bookworm-slim

WORKDIR /app

# Primero solo los manifiestos, para que la capa de dependencias se reuse entre deploys.
# El package.json y el lockfile de la raíz se recortan a los dos workspaces que usa la API,
# así npm no instala las apps (Expo, React Native, Next). Las versiones no cambian.
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/
COPY packages/domain/package.json packages/domain/
COPY services/api/scripts/prune-lockfile.mjs /tmp/
RUN node /tmp/prune-lockfile.mjs services/api packages/domain \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY packages/domain packages/domain
COPY services/api services/api

ENV NODE_ENV=production
WORKDIR /app/services/api
USER node
EXPOSE 4000

# node directo (sin npm) para que SIGTERM llegue al proceso y cierre ordenado.
CMD ["node", "--import", "tsx", "src/server.ts"]
