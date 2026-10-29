FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm ci --omit=dev

FROM node:22-slim
RUN groupadd -r app && useradd -r -g app -m -d /home/app -s /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
RUN mkdir -p /app/data && chown -R app:app /app
VOLUME ["/app/data"]
USER app
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/index.js"]
