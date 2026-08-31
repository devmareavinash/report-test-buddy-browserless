# Snowflake SSO sidecar — browser/external authenticator on the backend host.
# Requires a desktop/browser on the host (VDI). Not suitable for headless-only servers.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/snowflake-sso/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/snowflake-sso/app.py .

EXPOSE 8002
ENV PORT=8002

HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8002/healthz')" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
