# In-app Playwright runtime. Runs real Chromium so the playwright-runtime
# edge function can execute user-authored scripts inside the same Compose /
# ECS stack — no external browser service required.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Tiny dependency surface — just express for HTTP routing.
COPY runtime/package.json ./package.json
RUN npm install --omit=dev

COPY runtime/server.js ./server.js
COPY runtime/live.html ./live.html

ENV PORT=8001 \
    HEADED_VIA_SCREENCAST=1

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8001/healthz || exit 1

CMD ["node", "server.js"]
