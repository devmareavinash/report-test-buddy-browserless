// Shared auth guard for internal agent edge functions.
// Accepts either:
//   - the project's SERVICE_ROLE key (used for internal function-to-function calls), or
//   - a valid end-user JWT (any authenticated user).
// Returns null on success, or a Response on failure.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

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
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Allow internal service-role calls.
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return null;

  // Otherwise verify as a user JWT.
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}
