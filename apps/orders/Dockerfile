# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json nest-cli.json ./
RUN npm ci

COPY apps ./apps
COPY libs ./libs

RUN npx nest build orders

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# nest build (sin webpack) preserva el path relativo del monorepo:
# dist/apps/orders/apps/orders/src/main.js
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/apps/orders/apps/orders/src/main.js"]
