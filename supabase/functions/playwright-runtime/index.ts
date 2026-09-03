// Playwright runtime adapter — executes generated scripts via Browserless /function API.
// Configure with BROWSERLESS_TOKEN + BROWSERLESS_HOST (self-hosted OSS or Browserless cloud).

import { corsHeaders } from "../_shared/cors.ts";
import { getSupabase } from "../_shared/llm.ts";
import { getSupabaseForRequest, requireAuth } from "../_shared/auth.ts";

type Mode = "headed" | "headless";

const DEFAULT_OSS_HOST = "http://127.0.0.1:3000";
const DEFAULT_CLOUD_HOST = "production-sfo.browserless.io";

type BrowserlessRuntime = {
  provider: "browserless";
  token: string;
  baseUrl: string;
  functionPath: string;
  isOss: boolean;
};

function resolveBrowserlessConfig(token: string): BrowserlessRuntime {
  const rawHost = (Deno.env.get("BROWSERLESS_HOST") || "").trim();
  const explicitOss = Deno.env.get("BROWSERLESS_OSS");
  let baseUrl: string;
  let isOss: boolean;

  if (/^https?:\/\//i.test(rawHost)) {
    baseUrl = rawHost.replace(/\/$/, "");
    isOss = explicitOss === "true"
      ? true
      : explicitOss === "false"
        ? false
        : !baseUrl.includes("browserless.io");
  } else if (rawHost) {
    const host = rawHost.replace(/\/$/, "");
    isOss = explicitOss === "true"
      ? true
      : explicitOss === "false"
        ? false
        : !host.includes("browserless.io");
    const useHttps = isOss
      ? Deno.env.get("BROWSERLESS_USE_HTTPS") === "true"
      : Deno.env.get("BROWSERLESS_USE_HTTPS") !== "false";
    baseUrl = `${useHttps ? "https" : "http"}://${host}`;
  } else {
    // No host set: default to local OSS (self-hosted stack / dev).
    baseUrl = DEFAULT_OSS_HOST;
    isOss = explicitOss !== "false";
  }

  const functionPath = isOss ? "/chromium/function" : "/function";
  return { provider: "browserless", token, baseUrl, functionPath, isOss };
}

async function getRuntime(_sb: any): Promise<BrowserlessRuntime | null> {
  const browserlessToken = Deno.env.get("BROWSERLESS_TOKEN");
  if (!browserlessToken) return null;
  return resolveBrowserlessConfig(browserlessToken);
}

function buildBrowserlessFunctionUrl(rt: BrowserlessRuntime): string {
  const params = new URLSearchParams();
  params.set("token", rt.token);

  // Corp VDI Docker: Chromium cannot resolve Bayer intranet DNS (ERR_NAME_NOT_RESOLVED →
  // chrome-error://chromewebdata/). Pass --proxy-server on the Browserless URL so
  // navigations to mstr-*.bayer.com go through Skyhigh. AWS ECS: leave proxy unset.
  const chromiumProxy = (
    Deno.env.get("CHROMIUM_PROXY") ||
    Deno.env.get("HTTPS_PROXY") ||
    Deno.env.get("HTTP_PROXY") ||
    ""
  ).trim();
  if (chromiumProxy) {
    params.set("--proxy-server", chromiumProxy);
    params.set("--ignore-certificate-errors", "");
  }

  // Extra Chromium flags as comma-separated "--flag" or "--flag=value" entries.
  const extra = (Deno.env.get("BROWSERLESS_CHROMIUM_ARGS") || "").trim();
  if (extra) {
    for (const raw of extra.split(",")) {
      const flag = raw.trim();
      if (!flag) continue;
      const eq = flag.indexOf("=");
      if (eq > 0) params.set(flag.slice(0, eq), flag.slice(eq + 1));
      else params.set(flag, "");
    }
  }

  return `${rt.baseUrl}${rt.functionPath}?${params.toString()}`;
}

function formatFetchError(err: unknown, label: string): string {
  const e = err as { message?: string; cause?: { message?: string } };
  const cause = e?.cause?.message || e?.message || String(err);
  if (/unknownissuer|certificate|cert/i.test(cause)) {
    return (
      `${label} failed (TLS: ${cause}). ` +
      "On this VDI the corp proxy rewrites HTTPS certs. Restart the backend with scripts/dev-backend.ps1 " +
      "so Deno ignores Skyhigh MITM certificates."
    );
  }
  return `${label} failed: ${cause}`;
}

async function callBrowserlessFunction(rt: BrowserlessRuntime, jsCode: string) {
  const url = buildBrowserlessFunctionUrl(rt);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/javascript",
        Authorization: `Bearer ${rt.token}`,
      },
      body: jsCode,
    });
  } catch (e) {
    throw new Error(formatFetchError(e, `Browserless ${rt.baseUrl}${rt.functionPath}`));
  }
  const text = await resp.text();
  if (!resp.ok) {
    let detail = text;
    const looksLikeCodespace = /github\.dev|github\.com|codespace|forwarded port/i.test(rt.baseUrl + " " + text);
    if (resp.status === 401 && (!text || /github|codespace|forwarded port/i.test(text))) {
      detail =
        "401 from the Browserless URL (empty body usually means GitHub Codespaces, not Browserless). " +
        "In the Codespace Ports tab set 3000 to Public, then retry. " +
        `Host: ${rt.baseUrl}`;
    } else if (resp.status === 404 && looksLikeCodespace && !text.trim()) {
      detail =
        `404 from ${rt.baseUrl} (empty body). This VDI cannot reach the Codespace port-forward URL ` +
        "(GitHub returns 404 even when Ports shows 3000 Public). " +
        "Use Docker Desktop Browserless OSS on http://127.0.0.1:3000 instead " +
        "(scripts/dev-browserless.ps1 or docker compose). Restart the local backend after that.";
    } else if (resp.status === 404 && !text.trim()) {
      detail =
        `404 from ${rt.baseUrl}${rt.functionPath} with an empty body. ` +
        "The host is up but this path is missing — confirm BROWSERLESS_OSS=true (OSS uses /chromium/function) " +
        "and that Browserless is running.";
    }
    const err: any = new Error(`browserless ${resp.status}: ${detail}`);
    err.status = resp.status;
    err.body = text;
    throw err;
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function sanitizeBrowserlessCode(code: string) {
  return code
    // Remove markdown fences if a generated script was saved verbatim.
    .replace(/^\s*```(?:javascript|js)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    // Browserless /function rejects Playwright's networkidle lifecycle value.
    // Normalize legacy saved scripts without risking malformed option objects.
    .replace(/waitUntil\s*:\s*(["'])networkidle\1/g, 'waitUntil: "domcontentloaded"')
    .replace(/page\.waitForLoadState\(\s*(["'])networkidle\1\s*\)/g, 'page.waitForLoadState("domcontentloaded")')
    // Replace common LLM placeholders with runtime credentials so saved scripts
    // cannot leak or depend on literal report passwords.
    .replace(/(["'])YOUR_USERNAME_HERE\1/g, "__creds?.username || ''")
    .replace(/(["'])YOUR_PASSWORD_HERE\1/g, "__creds?.password || ''")
    // Neutralize legacy generated scripts that bail with AUTH_REQUIRED instead of
    // attempting login. When __creds is available the auto-injected preamble has
    // already handled auth, so we skip this early-return.
    .replace(
      /return\s*\{\s*ok:\s*false\s*,\s*error:\s*['"]AUTH_REQUIRED['"][^}]*\}\s*;?/g,
      "if (typeof __creds === 'undefined' || !__creds || !__creds.username) { return { ok: false, error: 'AUTH_REQUIRED', message: 'Login form detected but no credentials provided' }; }"
    );
}



function validateWrappedCodeSyntax(code: string) {
  const parseable = code.replace(/export\s+default\s+async\s*\(/, "const __browserlessEntrypoint = async (");
  try {
    new Function(parseable);
    return null;
  } catch (e: any) {
    return String(e?.message || e);
  }
}

function safeNavigationScript(creds: any, reportUrl?: string) {
  const urlLiteral = JSON.stringify(reportUrl || "about:blank");
  return `
const __creds = ${creds ? JSON.stringify(creds) : "null"};
export default async ({ page }) => {
  try { page.setDefaultTimeout(15000); } catch {}
  try { page.setDefaultNavigationTimeout(30000); } catch {}
  const reportUrl = ${urlLiteral};
  let ok = true, error = null;
  try {
    // 1) Session check — go straight to the report. If the report loads
    //    without a login form, the existing session is valid; skip login.
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded' });
    const hasLoginForm = await page.locator('input[type="password"], #loginsection, form[action*="login" i]').first().isVisible().catch(() => false);
    if (hasLoginForm && __creds && __creds.username) {
      if (__creds.loginUrl) await page.goto(__creds.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.fill('input[name="username" i], input[type="email"], #username, #loginUsername', __creds.username).catch(() => {});
      await page.fill('input[type="password"], #password, #loginPassword', __creds.password || '').catch(() => {});
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
        page.click('button[type="submit"], input[type="submit"], #loginButton').catch(() => {}),
      ]);
      // 2) Detect explicit "Login failure" / "Error in login" banner.
      const loginFailed = await page.locator('text=/login\\\\s*failure|error\\\\s*in\\\\s*login|invalid (user|credentials|password)/i').first().isVisible().catch(() => false);
      if (loginFailed) {
        ok = false; error = 'LOGIN_FAILED: credentials rejected by the report login page';
      } else {
        await page.goto(reportUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
  } catch (e) { ok = false; error = String(e && e.message || e); }
  let screenshot = null, currentUrl = null, title = null;
  try { currentUrl = page.url(); } catch {}
  try { title = await page.title(); } catch {}
  try { screenshot = await page.screenshot({ encoding: 'base64', fullPage: true }); } catch {}
  return { ok, error, result: { note: 'Original generated script had invalid JavaScript and was skipped. Regenerate the script to restore KPI extraction.', title }, url: currentUrl, screenshot };
};`;
}

async function resolveCreds(sb: any, scenarioId?: string, target: "main" | "reference" = "main") {
  if (!scenarioId) return null;
  // For target=reference: prefer script.reference_credential_profile_id, then
  // report.reference_credential_profile_id, then fall back to the main credentials.
  // For target=main: prefer script.credential_profile_id, then report.credential_profile_id.
  const { data: script } = await sb.from("scripts")
    .select("credential_profile_id, reference_credential_profile_id")
    .eq("scenario_id", scenarioId).maybeSingle();
  const { data: scenario } = await sb.from("scenarios")
    .select("reports(credential_profile_id, reference_credential_profile_id)")
    .eq("id", scenarioId).maybeSingle();
  const report: any = scenario?.reports || {};
  let credId: string | null = null;
  if (target === "reference") {
    credId = script?.reference_credential_profile_id
      || report.reference_credential_profile_id
      || script?.credential_profile_id
      || report.credential_profile_id
      || null;
  } else {
    credId = script?.credential_profile_id || report.credential_profile_id || null;
  }
  if (!credId) return null;
  const { data: cred } = await sb.from("credential_profiles").select("username,login_url,password_secret_ref").eq("id", credId).maybeSingle();
  if (!cred) return null;
  // password_secret_ref may be either the NAME of a secret/env var, OR the literal
  // password (Settings UI stores whatever the user typed). Resolve via env first;
  // if no such env var exists, fall back to the literal value.
  const ref = cred.password_secret_ref || "";
  const password = ref ? (Deno.env.get(ref) ?? ref) : "";
  return { username: cred.username || "", password, loginUrl: cred.login_url || "" };
}

async function resolveReportUrl(sb: any, scenarioId?: string, target: "main" | "reference" = "main") {
  if (!scenarioId) return "";
  const { data: scenario } = await sb.from("scenarios").select("reports(url, reference_url)").eq("id", scenarioId).maybeSingle();
  const r: any = scenario?.reports || {};
  if (target === "reference") return r.reference_url || r.url || "";
  // Main target may be configured (by agent-scripts) to scrape the reference URL
  // when the scenario description points the frontend source at the reference URL.
  const { data: script } = await sb.from("scripts")
    .select("assertion_spec").eq("scenario_id", scenarioId).maybeSingle();
  const spec: any = (script as any)?.assertion_spec || {};
  if (spec.__main_uses_reference_source) return r.reference_url || r.url || "";
  return r.url || "";
}

async function resolveFilterCombinations(sb: any, scenarioId?: string) {
  if (!scenarioId) return [];
  const { data } = await sb
    .from("scenario_filter_matrix")
    .select("label,filters")
    .eq("scenario_id", scenarioId)
    .order("created_at", { ascending: true });
  return (data || []).map((r: any, i: number) => ({
    label: r.label || `combo_${i + 1}`,
    filters: r.filters || {},
  }));
}

function headedModeError(rt: BrowserlessRuntime): string {
  if (rt.isOss) {
    return (
      "Headed (live browser) mode is not available in self-hosted Browserless OSS. " +
      "Live debugging and /live iframe streaming require Browserless Enterprise or Cloud. " +
      "Use headless mode — scripts still run via POST /chromium/function and return screenshots."
    );
  }
  return (
    "Headed (Live URL) mode requires a Browserless paid plan that includes Live URLs. " +
    "Your current token's plan does not support this feature. Use headless mode, or upgrade your Browserless plan."
  );
}

async function runOnBrowserless(rt: BrowserlessRuntime, mode: Mode, code: string, creds: any, reportUrl?: string, filterCombinations: any[] = []) {
  if (mode === "headed") {
    throw new Error(headedModeError(rt));
  }

  // Headless: /function executes JS Playwright only. Auto-wrap if needed.
  let jsCode = (code || "").trim();
  const looksPython = /^\s*(import|from |def |async def |class )/m.test(jsCode) || jsCode.includes("playwright.async_api");
  if (looksPython || !jsCode) {
    jsCode = `export default async ({ page }) => {
      await page.goto('about:blank');
      return { ok: true, note: 'Legacy/empty script — regenerate via agent-scripts for JS Playwright code.' };
    };`;
  } else if (!/export\s+default/.test(jsCode)) {
    jsCode = `export default async ({ page }) => {\n${jsCode}\n};`;
  }
  jsCode = sanitizeBrowserlessCode(jsCode);

  // Inject __creds and __filterCombinations globals so generated scripts can authenticate and iterate filters without hardcoding.
  const credsLiteral = `const __creds = ${creds ? JSON.stringify(creds) : "null"};`;
  const filtersLiteral = `const __filterCombinations = ${JSON.stringify(filterCombinations || [])};`;

  // Wrap user code so selector/timeout failures return structured data instead of 500.
  let wrapped = `
${credsLiteral}
${filtersLiteral}
${jsCode.replace(/export\s+default\s+/, "const __userFn = ")}
export default async (ctx) => {
  try { ctx.page.setDefaultTimeout(15000); } catch {}
  try { ctx.page.setDefaultNavigationTimeout(30000); } catch {}
  try { await ctx.page.setViewportSize({ width: 2560, height: 1440 }); } catch {}
  let result = null, ok = true, error = null;
  try { result = await __userFn(ctx); } catch (e) { ok = false; error = String(e && e.message || e); }
  let screenshot = null, url = null;
  try { url = ctx.page.url(); } catch {}
  // Measure actual content width and grow viewport to fit (capped) so fullPage captures everything horizontally.
  try {
    const dims = await ctx.page.evaluate(() => ({
      w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, document.documentElement.clientWidth),
      h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, document.documentElement.clientHeight),
    }));
    const targetW = Math.min(Math.max(dims.w || 1920, 1920), 3840);
    const targetH = Math.min(Math.max(dims.h || 1080, 1080), 8000);
    await ctx.page.setViewportSize({ width: targetW, height: targetH });
    await ctx.page.waitForTimeout(500);
  } catch {}
  try { await ctx.page.evaluate(() => window.scrollTo(0, 0)); } catch {}
  try { screenshot = await ctx.page.screenshot({ encoding: 'base64', fullPage: true }); } catch {}
  return { ok, error, result, url, screenshot };
};`;

  const syntaxError = validateWrappedCodeSyntax(wrapped);
  if (syntaxError) {
    wrapped = safeNavigationScript(creds, reportUrl);
  }

  const payload = await callBrowserlessFunction(rt, wrapped);
  const data = payload?.data ?? payload;
  const screenshot_b64 = data?.screenshot || null;
  if (data && typeof data === "object") delete (data as any).screenshot;
  return { extracted: data, screenshot_b64, provider: "browserless" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const unauthorized = await requireAuth(req);
  if (unauthorized) return unauthorized;
  try {
    const {
      mode = "headless",
      scenario_id,
      code = "",
      target = "main",
      filter_combinations: filterComboOverride,
    } = await req.json() as {
      mode: Mode;
      scenario_id?: string;
      code?: string;
      target?: "main" | "reference";
      filter_combinations?: { label?: string; filters?: Record<string, unknown> }[];
    };
    const sb = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim()
      ? getSupabase()
      : getSupabaseForRequest(req);
    const rt = await getRuntime(sb);

    const { data: job } = await sb.from("playwright_jobs").insert({
      scenario_id: scenario_id || null,
      mode, status: "running",
    }).select().single();

    if (!rt) {
      const message =
        "No browser runtime configured. Set BROWSERLESS_TOKEN and BROWSERLESS_HOST " +
        `(e.g. BROWSERLESS_HOST=${DEFAULT_OSS_HOST}, BROWSERLESS_TOKEN=local-dev-token). ` +
        `Cloud fallback host: ${DEFAULT_CLOUD_HOST}.`;
      await sb.from("playwright_jobs").update({
        status: "failed", finished_at: new Date().toISOString(), last_event: { error: message },
      }).eq("id", job.id);
      return new Response(JSON.stringify({ error: message, job_id: job.id }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tgt: "main" | "reference" = target === "reference" ? "reference" : "main";
    const creds = await resolveCreds(sb, scenario_id, tgt);
    const reportUrl = await resolveReportUrl(sb, scenario_id, tgt);
    const requestedCombos = (filterComboOverride || [])
      .filter((c) => c && typeof c === "object")
      .map((c, i) => ({
        label: String(c.label || `combo_${i + 1}`),
        filters: (c.filters || {}) as Record<string, unknown>,
      }));
    const filterCombinations = requestedCombos.length
      ? requestedCombos
      : await resolveFilterCombinations(sb, scenario_id);

    // Cloud plans without Live URLs: silently run headless instead of failing.
    let effectiveMode: Mode = mode;
    let fallbackReason: string | undefined;
    if (rt.provider === "browserless" && !rt.isOss && mode === "headed") {
      effectiveMode = "headless";
      fallbackReason = "Browserless Live URLs are not available on this plan, so the script ran headless instead.";
    }

    const result = await runOnBrowserless(rt, effectiveMode, code, creds, reportUrl, filterCombinations);
    if (fallbackReason) {
      result.mode = effectiveMode;
      result.requested_mode = mode;
      result.fallback_reason = fallbackReason;
    }

    await sb.from("playwright_jobs").update({
      status: "completed", finished_at: new Date().toISOString(),
      live_url: result.live_url || null, last_event: result,
    }).eq("id", job.id);

    return new Response(JSON.stringify({ job_id: job.id, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    // Browserless 408 = script exceeded the runtime budget. Return 200 with a
    // structured fallback so the UI shows a friendly message instead of blank screen.
    if (e?.status === 408 || /\b408\b|timed out/i.test(msg)) {
      return new Response(JSON.stringify({
        ok: false,
        error: "BROWSERLESS_TIMEOUT",
        message: "The browser script took too long. The report may be slow or a selector is waiting indefinitely — try simplifying or shortening waits.",
        fallback: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
