// Resolve edge-function URLs for server-to-server calls (e.g. agent-orchestrate → run-warehouse-sql).

const LOCAL_BACKEND_FUNCTIONS = new Set([
  "run-warehouse-sql",
  "test-warehouse-connectivity",
  "agent-orchestrate",
  "playwright-runtime",
]);

function cloudFunctionsBase(): string {
  const project = (Deno.env.get("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  return project ? `${project}/functions/v1` : "";
}

function localFunctionsBase(): string {
  return (Deno.env.get("LOCAL_FUNCTIONS_URL") || Deno.env.get("WAREHOUSE_FUNCTIONS_URL") || "")
    .trim()
    .replace(/\/$/, "");
}

export function resolveFunctionUrl(name: string): string {
  const localBase = localFunctionsBase();
  if (localBase && LOCAL_BACKEND_FUNCTIONS.has(name)) {
    return `${localBase}/${name}`;
  }
  return `${cloudFunctionsBase()}/${name}`;
}

export function shouldUseLocalFunctions(name: string): boolean {
  return Boolean(localFunctionsBase()) && LOCAL_BACKEND_FUNCTIONS.has(name);
}

export function resolveFunctionAuth(name: string, callerAuthorization?: string | null): string {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (shouldUseLocalFunctions(name)) {
    return callerAuthorization?.trim() || (serviceKey ? `Bearer ${serviceKey}` : "");
  }
  return serviceKey ? `Bearer ${serviceKey}` : (callerAuthorization?.trim() || "");
}
