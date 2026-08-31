# Snowflake SSO sidecar — browser/external authenticator on the backend host.
# Requires a desktop/browser on the host (VDI). Not suitable for headless-only servers.
FROM python:3.12-slim

WORKDIR /app

# Corporate proxies: pass HTTP_PROXY/HTTPS_PROXY as build-args when needed.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG NO_PROXY=127.0.0.1,localhost
ARG no_proxy=127.0.0.1,localhost

# Use prebuilt wheels only — avoids apt-get (often blocked by corp DNS/proxy in Docker).
COPY backend/snowflake-sso/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/snowflake-sso/app.py .

EXPOSE 8002
ENV PORT=8002

HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/healthz')" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
