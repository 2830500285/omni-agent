FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps ./apps
COPY deploy/env.example ./deploy/env.example
EXPOSE 4040
CMD ["node", "dist/omni-agent.js", "serve", "--cwd", "/workspace", "--storage-root", "/data", "--host", "0.0.0.0", "--port", "4040"]
