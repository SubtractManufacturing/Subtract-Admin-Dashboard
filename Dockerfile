# Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci && \
    npm cache clean --force

# Copy application code
COPY . .

# Create symbolic links for TypeScript files to resolve .js imports
RUN find app -name "*.ts" -not -name "*.d.ts" | while read tsfile; do \
    jsfile="${tsfile%.ts}.js"; \
    ln -sf "$(basename "$tsfile")" "$jsfile"; \
    done

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/build ./build
COPY --from=builder --chown=nodejs:nodejs /app/public ./public

# Copy database schema and config files from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/app/lib/db ./app/lib/db
COPY --from=builder --chown=nodejs:nodejs /app/drizzle.config.ts ./drizzle.config.ts

# Switch to non-root user
USER nodejs

# Expose port (can be overridden with PORT env variable)
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# Start the application with signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]