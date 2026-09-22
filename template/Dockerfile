# syntax=docker/dockerfile:1

# Your books as a container: one process serving the web app and its API on
# one port, from this folder (`dbu6 start`). Build and run it from here:
#
#   docker build -t my-books .
#   docker run -d --name my-books -p 3000:3000 \
#     -e BETTER_AUTH_SECRET=<a long random string> \
#     -e SAPPORTA_PUBLIC_APP_URL=http://localhost:3000 \
#     -v my-books-data:/app/data \
#     my-books
#
# The image has no .env file (.dockerignore keeps it out), so the container's
# environment configures dbu6: the two variables above are required, and
# DEPLOYMENT.md in dbu6's repository lists the rest. data/ is not in the
# image either, and must be a volume, or the books vanish with the container.
# user-config/ is copied in from this folder, so an edit to a mapping rule or
# a preset is a rebuild; to edit it live, bind-mount the folder instead:
# `-v "$PWD/user-config":/app/user-config`.
#
# There is no coding agent in the image, so nothing is categorized
# automatically and the app can only copy the prompts it writes for one.

ARG NODE_VERSION=22-bookworm-slim

# Install the project's dependencies and build its web app. better-sqlite3 is
# a native module: npm takes a prebuilt binary when there is one for this
# platform and compiles it otherwise, which needs python3, make and g++.
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Builds dist/app when the project has reports or a frontend.tsx. A project
# without them is served the web app prebuilt in the dbu6 package, and this
# only says so.
RUN node node_modules/dbu6/bin/dbu6.mjs build

# The runtime image: Node, and what statement imports run on: uv and python3
# for the parsers, pdftotext (poppler) for PDF statements. No compiler.
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 poppler-utils \
  && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY --from=build --chown=node:node /app /app

# The database is data/sqlite.db under the project root, /app/data here. Mount
# it as a volume; if that is a bind mount, own the host directory as uid 1000
# (the `node` user), because a bind mount overrides the ownership set here.
# tmp/ holds statements the importer could not read, for an agent to look at.
RUN install -d -o node -g node /app/data /app/tmp
USER node
EXPOSE 3000
VOLUME ["/app/data"]

# Nothing listens until the database is migrated, auth is built and every
# route is mounted, so any HTTP reply proves the process booted. The check
# does not require 200: /health answers 401 under
# SAPPORTA_HEALTH_POLICY=authenticated and 404 under `disabled`, and both are
# healthy processes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SAPPORTA_API_PORT || process.env.PORT || 3000) + '/health').then(r => process.exit(r.status >= 500 ? 1 : 0)).catch(() => process.exit(1))"

# `start` migrates the database safely (on a verified copy) before it serves.
CMD ["node", "node_modules/dbu6/bin/dbu6.mjs", "start"]
