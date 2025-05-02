FROM node:20 AS builder
ARG APP_PATH=/opt/outline
WORKDIR $APP_PATH

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production=false

COPY . .

RUN NODE_OPTIONS=--max-old-space-size=4096 yarn build


FROM node:20-slim AS runner
LABEL org.opencontainers.image.source="https://github.com/hunmac9/outline"
ARG APP_PATH=/opt/outline
WORKDIR $APP_PATH

ENV NODE_ENV=production

COPY --from=builder $APP_PATH/build ./build
COPY --from=builder $APP_PATH/server ./server
COPY --from=builder $APP_PATH/public ./public
COPY --from=builder $APP_PATH/.sequelizerc ./.sequelizerc
COPY --from=builder $APP_PATH/node_modules ./node_modules
COPY --from=builder $APP_PATH/package.json ./package.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --gid 1001 nodejs && \
  adduser --uid 1001 --ingroup nodejs nodejs && \
  chown -R nodejs:nodejs $APP_PATH && \
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
