# ---------- Build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps (use bun if lockfile present, else npm)
COPY package.json bun.lockb* package-lock.json* ./
RUN if [ -f bun.lockb ]; then \
      npm install -g bun && bun install --frozen-lockfile; \
    else \
      npm ci || npm install; \
    fi

# Build-time env (Vite inlines VITE_* vars at build time)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_USE_LOCAL_BACKEND=true
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    VITE_USE_LOCAL_BACKEND=$VITE_USE_LOCAL_BACKEND

COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
