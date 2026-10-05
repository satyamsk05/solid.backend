# Multi-stage Dockerfile for Solidgame Backend
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies needed for node-gyp / native modules if any
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/
RUN npm run build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma/
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 5001

# Run database migration push and start backend
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
