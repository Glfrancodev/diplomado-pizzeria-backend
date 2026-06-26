# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json nest-cli.json ./
RUN npm ci

COPY apps ./apps
COPY libs ./libs

RUN npx nest build delivery

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# nest build (sin webpack) preserva el path relativo del monorepo:
# dist/apps/delivery/apps/delivery/src/main.js
COPY --from=builder /app/dist ./dist

# delivery es worker NATS puro: NO expone puerto.
CMD ["node", "dist/apps/delivery/apps/delivery/src/main.js"]
