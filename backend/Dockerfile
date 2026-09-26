FROM node:20-alpine
WORKDIR /app

# Install backend dependencies (cached unless package.json changes)
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --omit=dev

# Copy source — backend needs ../frontend and ../admin at runtime
COPY backend ./backend
COPY frontend ./frontend
COPY admin ./admin

WORKDIR /app/backend

# Run migrations on startup, then start the server.
CMD ["sh", "-c", "node src/db/migrate.js && node server.js"]

EXPOSE 3000
