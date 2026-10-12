# Container for the "Describe your team" assistant (server/), deployed to
# Cloud Run. It lives at the repository root because the service reads
# data/assumptions.json, the same file the web page uses. The static site
# itself is hosted elsewhere; a copy is included only so a private preview
# deployment can serve it for testing.
FROM node:26-slim

ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev

COPY server/src server/src
COPY data/assumptions.json data/prices.json data/
# The page itself, served only in preview mode (PREVIEW=1) for testing.
COPY index.html favicon.svg ./
COPY css css
COPY js js

USER node
EXPOSE 8080
CMD ["node", "server/src/index.mjs"]
