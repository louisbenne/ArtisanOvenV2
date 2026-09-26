FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install backend dependencies (cached unless package.json changes)
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --omit=dev && npm cache clean --force

# Copy source — backend needs ../frontend and ../admin at runtime
COPY backend ./backend
COPY frontend ./frontend
COPY admin ./admin

WORKDIR /app/backend
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

# Run migrations on startup, then start the server.
# exec so node is PID 1 and receives SIGTERM on redeploy.
CMD ["sh", "-c", "node src/db/migrate.js && exec node server.js"]
