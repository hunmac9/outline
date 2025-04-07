ARG APP_PATH=/opt/outline

# --- Builder Stage ---
# Build the base image locally using Dockerfile.base
# We name it outline-base:local to avoid conflicts and indicate it's local
FROM outline-base:local AS builder

# Install git
USER root
RUN apt-get update && apt-get install -y git --no-install-recommends && rm -rf /var/lib/apt/lists/*
USER node

ARG APP_PATH
WORKDIR $APP_PATH

# Ensure the node user owns the directory before installing dependencies
USER root
RUN chown -R node:node $APP_PATH
USER node

# Install all dependencies (including devDependencies needed for build)
# Using --frozen-lockfile ensures we use exact versions from the cloned yarn.lock
RUN yarn install --frozen-lockfile

# Build the application using local source code
# Ensure the build script is defined in package.json
RUN yarn build

# --- Runner Stage ---
# Use a slim Node image for the final stage
FROM node:20-slim AS runner

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
