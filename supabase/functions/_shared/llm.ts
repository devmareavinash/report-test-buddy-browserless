// Anthropic-only LLM dispatch. All agent calls go through the Anthropic
// Messages API using ANTHROPIC_API_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Msg = { role: "system" | "user" | "assistant"; content: string };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";

function resolveModel(configured?: string | null): string {
  if (configured && /^claude/i.test(configured)) return configured;
  return DEFAULT_MODEL;
}

export async function callAgent(opts: {
  agentKey: string;
  messages: Msg[];
  json?: boolean;
}): Promise<string> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: cfg } = await supabase
    .from("agent_model_config")
    .select("model, temperature, system_instruction")
    .eq("agent_key", opts.agentKey)
    .maybeSingle();

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const model = resolveModel((cfg as any)?.model);
  const temperature = (cfg as any)?.temperature ?? 0.2;
  const sysOverride = (cfg as any)?.system_instruction as string | undefined;

  // Anthropic requires `system` at top-level and only user/assistant in messages.
  const systemParts: string[] = [];
  if (sysOverride) systemParts.push(sysOverride);
  const chat: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of opts.messages) {
    if (m.role === "system") systemParts.push(m.content);
    else chat.push({ role: m.role, content: m.content });
  }

  let system = systemParts.filter(Boolean).join("\n\n");
  if (opts.json) {
    system = `${system}\n\nRespond with a single valid JSON object only. Do not include any prose or markdown fences.`.trim();
  }

  // Scripts agent emits long Playwright code; give it plenty of headroom so the
  // JSON response is never truncated mid-string. Other agents stay lean.
  const maxTokens = opts.agentKey === "scripts" ? 32000 : 8192;
  const body: any = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: chat,
  };
  if (system) body.system = system;

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return (data.content || []).map((c: any) => c?.text || "").join("") || "";
}

export function getSupabase() {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    ""
  ).trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required");
  }
  return createClient(url, key);
}

export function tryParseJson(s: string): any {
  try { return JSON.parse(s); } catch { /* */ }
  const m = s.match(/```json\s*([\s\S]*?)```/) || s.match(/```\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1]); } catch { /* */ } }
  const start = s.indexOf("{");
  const arr = s.indexOf("[");
  const i = start === -1 ? arr : (arr === -1 ? start : Math.min(start, arr));
  if (i >= 0) {
    try { return JSON.parse(s.slice(i)); } catch { /* */ }
  }
  return null;
}
