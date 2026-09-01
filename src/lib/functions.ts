import { supabase } from "@/integrations/supabase/client";

type InvokeResult<T = any> = { data: T | null; error: Error | null };

const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const useAllLocalBackend = import.meta.env.VITE_USE_LOCAL_BACKEND === "true";
const configuredBase = (import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined)?.replace(/\/$/, "");
const localFunctions = new Set(
  (import.meta.env.VITE_LOCAL_FUNCTIONS as string | undefined)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? ["run-warehouse-sql", "test-warehouse-connectivity", "agent-orchestrate", "playwright-runtime"],
);

function shouldUseLocalBackend(name: string) {
  // Docker/full self-host: all functions hit the local gateway.
  if (useAllLocalBackend || configuredBase) return true;
  // Dev default: only warehouse/Snowflake functions use local backend + SSO sidecar.
  return localFunctions.has(name);
}

function functionsBaseUrl() {
  if (configuredBase) return configuredBase;
  return "";
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || publishableKey || "";
  return {
    "Content-Type": "application/json",
    ...(publishableKey ? { apikey: publishableKey } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function invokeFunction<T = any>(name: string, body: any): Promise<InvokeResult<T>> {
  if (!shouldUseLocalBackend(name)) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    return { data: (data as T) ?? null, error: error ? new Error(error.message) : null };
  }

  try {
    const path = `/functions/v1/${name}`;
    const response = await fetch(`${functionsBaseUrl()}${path}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body ?? {}),
    });
    const text = await response.text();
    let payload: any = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        const snippet = text.replace(/\s+/g, " ").slice(0, 180);
        return {
          data: null,
          error: new Error(
            response.ok
              ? `Expected JSON from ${name}, got: ${snippet}`
              : `Edge function returned ${response.status} (non-JSON): ${snippet}`,
          ),
        };
      }
    }
    if (!response.ok) {
      return {
        data: payload,
        error: new Error(`Edge function returned ${response.status}: ${response.statusText}, ${text}`),
      };
    }
    return { data: payload as T, error: null };
  } catch (error: any) {
    return { data: null, error: new Error(error?.message || String(error)) };
  }
}