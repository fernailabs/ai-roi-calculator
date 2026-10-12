# Container for the "Describe your team" assistant (server/), deployed to
# Cloud Run. It lives at the repository root because the service reads
# data/assumptions.json, the same file the web page uses. The static site
# itself needs no build and is not part of this image.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev

COPY server/src server/src
COPY data/assumptions.json data/assumptions.json

USER node
EXPOSE 8080
CMD ["node", "server/src/index.mjs"]
