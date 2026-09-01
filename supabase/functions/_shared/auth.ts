// Shared auth guard for internal agent edge functions.
// Accepts either:
//   - the project's SERVICE_ROLE key (used for internal function-to-function calls), or
//   - a valid end-user JWT (any authenticated user).
// Returns null on success, or a Response on failure.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Decode JWT payload without verifying signature (structure check only). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function looksLikeUserJwt(claims: Record<string, unknown> | null): boolean {
  if (!claims) return false;
  const sub = claims.sub;
  if (typeof sub !== "string" || !sub) return false;
  const role = claims.role;
  if (role === "anon" || role === "service_role") return false;
  const exp = claims.exp;
  if (typeof exp === "number" && exp * 1000 < Date.now()) return false;
  return true;
}

/** Supabase client scoped to the caller's JWT (anon key). No service role required. */
export function getSupabaseForRequest(req: Request): SupabaseClient {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRole && token === serviceRole) {
    return createClient(Deno.env.get("SUPABASE_URL")!, serviceRole);
  }
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

export async function requireAuth(req: Request): Promise<Response | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorized();

  // Allow internal service-role calls.
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return null;

  // Prefer online verification (AWS / normal network).
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user) return null;
    // Invalid token (Auth rejected it) — do not fall back.
    if (error && !isNetworkishAuthError(error)) return unauthorized();
  } catch (e) {
    if (!isNetworkishAuthError(e)) return unauthorized();
  }

  // Offline / proxy-failure fallback: accept unexpired user JWTs by claims.
  // Used when Docker Desktop can't reach Supabase Auth (corp DNS). AWS path
  // should succeed online above. Set AUTH_STRICT=true to disable fallback.
  if (Deno.env.get("AUTH_STRICT") === "true") return unauthorized();
  if (looksLikeUserJwt(decodeJwtPayload(token))) return null;

  return unauthorized();
}

function isNetworkishAuthError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("dns") ||
    msg.includes("failed to lookup") ||
    msg.includes("network") ||
    msg.includes("connect") ||
    msg.includes("fetch") ||
    msg.includes("timed out") ||
    msg.includes("unknownissuer") ||
    msg.includes("certificate")
  );
}
