FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --build-from-source=sqlite3

COPY . .

ENV NODE_ENV=production

CMD ["npm", "start"]