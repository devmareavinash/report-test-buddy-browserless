# Deno-based backend container hosting all edge functions in one process.
FROM denoland/deno:alpine-1.46.3

WORKDIR /app

# Copy edge functions and the gateway server
COPY supabase/functions ./functions
COPY backend/server.ts  ./server.ts

# Pre-cache deps for faster cold start
RUN deno cache --no-check server.ts || true

EXPOSE 8000
ENV PORT=8000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8000/healthz || exit 1

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "server.ts"]
