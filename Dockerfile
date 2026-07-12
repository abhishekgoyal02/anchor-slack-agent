FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Force Docker to invalidate the cache
ARG CACHEBUST=1

RUN rm -rf node_modules package-lock.json \
 && npm install

COPY . .

ENV NODE_ENV=production

CMD ["npm", "start"]