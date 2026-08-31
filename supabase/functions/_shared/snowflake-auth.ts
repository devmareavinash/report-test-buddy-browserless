// Snowflake auth helpers — password, OAuth token, and SSO (external browser).

export function isSsoAuth(authenticator?: string | null): boolean {
  const a = (authenticator || "password").trim().toLowerCase();
  return a === "sso" || a === "externalbrowser" || a.startsWith("http");
}

export function normalizeSnowflakeAuth(input: {
  auth_method?: string | null;
  authenticator?: string | null;
  password_secret_ref?: string | null;
  token_secret_ref?: string | null;
}): {
  auth_method: string;
  authenticator: string;
  password_secret_ref: string | null;
  token_secret_ref: string | null;
} {
  const auth = (input.authenticator || input.auth_method || "password").trim();
  if (input.token_secret_ref?.trim()) {
    return {
      auth_method: "token",
      authenticator: "token",
      password_secret_ref: null,
      token_secret_ref: input.token_secret_ref.trim(),
    };
  }
  if (isSsoAuth(auth)) {
    const normalized = auth.toLowerCase().startsWith("http") ? auth : "sso";
    return {
      auth_method: "sso",
      authenticator: normalized,
      password_secret_ref: null,
      token_secret_ref: null,
    };
  }
  return {
    auth_method: "password",
    authenticator: "password",
    password_secret_ref: input.password_secret_ref?.trim() || null,
    token_secret_ref: null,
  };
}

export function connectorAuthenticator(connector: {
  auth_method?: string | null;
  extra?: Record<string, unknown> | null;
}): string {
  const extra = (connector.extra || {}) as Record<string, unknown>;
  const fromExtra = typeof extra.authenticator === "string" ? extra.authenticator : "";
  return fromExtra || connector.auth_method || "password";
}

export function snowflakeConfigured(connector: {
  account?: string | null;
  host?: string | null;
  warehouse?: string | null;
  role?: string | null;
  username?: string | null;
  password_secret_ref?: string | null;
  token_secret_ref?: string | null;
  auth_method?: string | null;
  extra?: Record<string, unknown> | null;
}): boolean {
  const account = (connector.account || connector.host || "").trim();
  const warehouse = (connector.warehouse || "").trim();
  const role = (connector.role || "").trim();
  if (!account || !warehouse || !role) return false;

  const auth = connectorAuthenticator(connector);
  if (connector.token_secret_ref?.trim()) return true;
  if (isSsoAuth(auth) || connector.auth_method === "sso") return true;
  return Boolean((connector.username || "").trim() && (connector.password_secret_ref || "").trim());
}

export function interpretSnowflakeError(raw: string, authMode: "sso" | "password" | "token"): string {
  const lower = raw.toLowerCase();
  if (authMode === "sso") {
    if (lower.includes("<!doctype html") || lower.includes("cannot connect") || lower.includes("mwg-internal")) {
      return (
        "Cannot reach the Snowflake SSO service on this machine. Your corporate proxy is blocking local " +
        "connections to the SSO sidecar. Set SNOWFLAKE_SSO_URL=http://127.0.0.1:8002 and " +
        "NO_PROXY=127.0.0.1,localhost on the Deno backend, then restart it."
      );
    }
    if (lower.includes("incorrect username or password") || lower.includes("250001")) {
      return (
        "Snowflake SSO login failed. The 'incorrect username or password' message is misleading for SSO — " +
        "complete the browser login on the machine running the Snowflake SSO service (your VDI/backend host), " +
        "confirm account/warehouse/role, and retry within the login timeout (~2 minutes)."
      );
    }
    if (lower.includes("login timeout") || lower.includes("timeout")) {
      return (
        "Snowflake SSO login timed out. A browser window should open on the backend host — sign in there and retry."
      );
    }
  }
  return raw;
}

/** Avoid corporate proxies intercepting localhost — use loopback IP instead. */
export function resolveSnowflakeSsoUrl(): string {
  const raw = (Deno.env.get("SNOWFLAKE_SSO_URL") || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/localhost/gi, "127.0.0.1");
  }
}

export async function callSnowflakeSso(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ssoUrl = resolveSnowflakeSsoUrl();
  if (!ssoUrl) {
    throw new Error(
      "Snowflake SSO is not configured. Set SNOWFLAKE_SSO_URL (e.g. http://127.0.0.1:8002) on the backend host.",
    );
  }
  const resp = await fetch(`${ssoUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `SSO service HTTP ${resp.status}`);
  }
  if (!resp.ok) {
    throw new Error(String(data.detail || data.error || text || `SSO service HTTP ${resp.status}`));
  }
  if (data.ok === false) {
    throw new Error(String(data.error || "Snowflake SSO request failed"));
  }
  return data;
}
