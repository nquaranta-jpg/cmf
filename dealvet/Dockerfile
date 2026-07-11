# DealVet — single container: Express API + built frontend + headless Chrome.
# Uses Debian's chromium package (works on both amd64 and arm64) instead of
# puppeteer's downloaded Chrome (x86-only on Linux). Works on Render, Railway,
# and Fly.io as-is.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
EXPOSE 3001

CMD ["npm", "start"]
