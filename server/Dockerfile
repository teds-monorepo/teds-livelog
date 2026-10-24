FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# package-lock.json is optional (it is only produced once you run npm install),
# so the glob keeps the build working either way.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Only what the server needs at runtime, rather than `COPY . .`: that would drag
# in a host `node_modules` and would rely on a .dockerignore to stop it, and a
# .dockerignore can't travel in the downloadable zip — the hub can't serve
# dotfiles out of public/.
COPY server.js ./
COPY lib ./lib

EXPOSE 8787
CMD ["node", "server.js"]
