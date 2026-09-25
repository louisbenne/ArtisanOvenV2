FROM node:20-alpine
WORKDIR /app

# Install dependencies first (layer cached unless package.json changes)
COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Run migrations on startup, then start the server.
CMD ["sh", "-c", "node src/db/migrate.js && node server.js"]

EXPOSE 3000
