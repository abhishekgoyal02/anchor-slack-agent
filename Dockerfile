FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

ENV npm_config_build_from_source=sqlite3

RUN npm ci

COPY . .

ENV NODE_ENV=production

CMD ["npm", "start"]