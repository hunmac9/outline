ARG APP_PATH=/opt/outline

# --- Base Stage ---
# Pre-install dependencies based on yarn.lock
FROM node:22-slim AS base
ARG APP_PATH
WORKDIR $APP_PATH
COPY ./package.json ./yarn.lock ./
COPY ./patches ./patches
# Install dependencies needed for runtime and potentially some build steps
# Using --no-optional as in the original Dockerfile.base
RUN yarn install --no-optional --frozen-lockfile --network-timeout 1000000 && \
  yarn cache clean

# --- Builder Stage ---
# Use the base stage with pre-installed dependencies
FROM base AS builder

# Install git (needed for some build steps or versioning)
USER root
RUN apt-get update && apt-get install -y git --no-install-recommends && rm -rf /var/lib/apt/lists/*
USER node

ARG APP_PATH
WORKDIR $APP_PATH

# Copy pre-installed node_modules from the base stage
COPY --from=base $APP_PATH/node_modules ./node_modules

# Copy package files and patches FIRST to leverage caching
COPY ./package.json ./yarn.lock ./
COPY ./patches ./patches

# Run install - This layer is cached if package files/patches don't change
# Uses the node_modules copied from 'base' as a cache
RUN yarn install --frozen-lockfile

# NOW copy the rest of the application code
COPY . .

# Ensure the node user owns the directory before building
USER root
RUN chown -R node:node $APP_PATH
USER node

# Build the application using local source code - This layer invalidates on code changes
# Increase memory limit for Node.js during build
# Redirect output to a log file and print the log if the build fails
RUN NODE_OPTIONS="--max-old-space-size=4096" yarn build > /opt/outline/build.log 2>&1 || (cat /opt/outline/build.log && exit 1)

# --- Runner Stage ---
# Use a slim Node image for the final stage
FROM node:22-slim AS runner

LABEL org.opencontainers.image.source="https://github.com/hunmac9/outline"

ARG APP_PATH
WORKDIR $APP_PATH
ENV NODE_ENV=production

# Copy built artifacts and necessary files from the builder stage
COPY --from=builder $APP_PATH/build ./build
COPY --from=builder $APP_PATH/server ./server
COPY --from=builder $APP_PATH/public ./public
COPY --from=builder $APP_PATH/.sequelizerc ./.sequelizerc
COPY --from=builder $APP_PATH/node_modules ./node_modules
COPY --from=builder $APP_PATH/package.json ./package.json
# yarn.lock might not be strictly necessary for runtime only, but good practice
COPY --from=builder $APP_PATH/yarn.lock ./yarn.lock

# --- Runtime Setup (largely unchanged) ---

# Install wget to healthcheck the server
RUN  apt-get update \
  && apt-get install -y --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/*

# Create a non-root user compatible with Debian and BusyBox based images
RUN addgroup --gid 1001 nodejs && \
  adduser --uid 1001 --ingroup nodejs nodejs && \
  chown -R nodejs:nodejs $APP_PATH/build && \
  mkdir -p /var/lib/outline && \
	chown -R nodejs:nodejs /var/lib/outline

ENV FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data
RUN mkdir -p "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
  chown -R nodejs:nodejs "$FILE_STORAGE_LOCAL_ROOT_DIR" && \
  chmod 1777 "$FILE_STORAGE_LOCAL_ROOT_DIR"

VOLUME /var/lib/outline/data

USER nodejs

HEALTHCHECK --interval=1m CMD wget -qO- "http://localhost:${PORT:-3000}/_health" | grep -q "OK" || exit 1

EXPOSE 3000
CMD ["yarn", "start"]
