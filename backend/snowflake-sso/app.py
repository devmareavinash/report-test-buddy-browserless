"""
Snowflake SSO connector — external browser auth on the backend host.

SSO login opens in a browser on the machine running this service (VDI/desktop),
not in the end-user's React tab. Connections are cached per connector_id.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

import snowflake.connector
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("snowflake-sso")

app = FastAPI(title="Snowflake SSO", version="1.0.0")

_connections: dict[str, Any] = {}
_lock = threading.Lock()
DEFAULT_LOGIN_TIMEOUT = 120


def is_sso_auth(authenticator: str | None) -> bool:
    a = (authenticator or "password").strip().lower()
    return a in ("sso", "externalbrowser") or a.startswith("http")


def normalize_account(account: str | None, host: str | None) -> str:
    raw = (account or host or "").strip()
    raw = raw.replace("https://", "").replace("http://", "")
    raw = raw.rstrip("/")
    if raw.endswith(".snowflakecomputing.com"):
        raw = raw[: -len(".snowflakecomputing.com")]
    return raw


def connect_params(connector: dict[str, Any]) -> dict[str, Any]:
    account = normalize_account(connector.get("account"), connector.get("host"))
    if not account:
        raise ValueError("Snowflake connector is missing 'account'")

    warehouse = (connector.get("warehouse") or "").strip()
    role = (connector.get("role") or "").strip()
    if not warehouse or not role:
        raise ValueError("Snowflake connector requires warehouse and role")

    auth = (connector.get("authenticator") or connector.get("auth_method") or "sso").strip()
    params: dict[str, Any] = {
        "account": account,
        "warehouse": warehouse,
        "role": role,
    }

    database = (connector.get("database") or "").strip()
    schema = (connector.get("schema") or "").strip()
    if database:
        params["database"] = database
    if schema:
        params["schema"] = schema

    auth_lower = auth.lower()
    if auth_lower in ("sso", "externalbrowser"):
        params["authenticator"] = "externalbrowser"
        params["login_timeout"] = DEFAULT_LOGIN_TIMEOUT
    elif auth_lower.startswith("http"):
        params["authenticator"] = auth
        params["login_timeout"] = DEFAULT_LOGIN_TIMEOUT
    else:
        raise ValueError("connect_params expects SSO authenticator")

    user = (connector.get("username") or connector.get("user") or "").strip()
    if user:
        params["user"] = user

    return params


def get_connection(connector_id: str, connector: dict[str, Any]):
    with _lock:
        conn = _connections.get(connector_id)
        if conn is not None:
            try:
                cur = conn.cursor()
                cur.execute("SELECT 1")
                cur.close()
                return conn
            except Exception:
                logger.info("Dropping stale Snowflake connection for %s", connector_id)
                try:
                    conn.close()
                except Exception:
                    pass
                _connections.pop(connector_id, None)

        logger.info("Opening Snowflake SSO connection for %s (browser login may appear)", connector_id)
        params = connect_params(connector)
        conn = snowflake.connector.connect(**params)
        _connections[connector_id] = conn
        return conn


def run_query(connector_id: str, connector: dict[str, Any], sql: str, limit: int) -> dict[str, Any]:
    conn = get_connection(connector_id, connector)
    cur = conn.cursor()
    try:
        cur.execute(sql)
        cols = [d[0] for d in (cur.description or [])]
        rows_raw = cur.fetchmany(limit + 1)
        row_count = len(rows_raw)
        rows_raw = rows_raw[:limit]
        rows = []
        for arr in rows_raw:
            row: dict[str, Any] = {}
            for i, name in enumerate(cols):
                val = arr[i]
                if hasattr(val, "isoformat"):
                    val = val.isoformat()
                row[name] = val
            rows.append(row)
        scalar = None
        if len(rows) == 1 and len(cols) == 1:
            scalar = rows[0][cols[0]]
        return {
            "ok": True,
            "columns": cols,
            "row_count": row_count,
            "rows": rows,
            "scalar": scalar,
            "auth_mode": "sso",
        }
    finally:
        cur.close()


class ConnectorPayload(BaseModel):
    id: str | None = None
    account: str | None = None
    host: str | None = None
    database: str | None = None
    schema: str | None = None
    warehouse: str | None = None
    role: str | None = None
    username: str | None = None
    authenticator: str | None = "sso"
    auth_method: str | None = None


class QueryRequest(BaseModel):
    connector_id: str
    connector: ConnectorPayload
    sql: str
    limit: int = Field(default=5, ge=1, le=100)


class TestRequest(BaseModel):
    connector_id: str
    connector: ConnectorPayload


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/v1/test")
def test_connection(req: TestRequest) -> dict[str, Any]:
    connector = req.connector.model_dump()
    auth = connector.get("authenticator") or connector.get("auth_method") or "sso"
    if not is_sso_auth(str(auth)):
        raise HTTPException(status_code=400, detail="SSO service only handles SSO authenticator")

    try:
        result = run_query(req.connector_id, connector, "SELECT CURRENT_VERSION()", 1)
        version = result.get("scalar") or (result["rows"][0] if result["rows"] else None)
        return {
            "ok": True,
            "auth_mode": "sso",
            "version": version,
            "message": "Snowflake SSO connection successful",
        }
    except Exception as exc:
        logger.exception("SSO test failed for %s", req.connector_id)
        return {"ok": False, "auth_mode": "sso", "error": str(exc)}


@app.post("/v1/query")
def query(req: QueryRequest) -> dict[str, Any]:
    connector = req.connector.model_dump()
    auth = connector.get("authenticator") or connector.get("auth_method") or "sso"
    if not is_sso_auth(str(auth)):
        raise HTTPException(status_code=400, detail="SSO service only handles SSO authenticator")

    try:
        return run_query(req.connector_id, connector, req.sql, req.limit)
    except Exception as exc:
        logger.exception("SSO query failed for %s", req.connector_id)
        return {"ok": False, "auth_mode": "sso", "error": str(exc)}


@app.delete("/v1/connections/{connector_id}")
def drop_connection(connector_id: str) -> dict[str, bool]:
    with _lock:
        conn = _connections.pop(connector_id, None)
    if conn:
        try:
            conn.close()
        except Exception:
            pass
    return {"ok": True}
