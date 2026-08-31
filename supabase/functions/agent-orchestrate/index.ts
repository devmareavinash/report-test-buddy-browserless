import { corsHeaders } from "../_shared/cors.ts";
import { getSupabaseForRequest, requireAuth } from "../_shared/auth.ts";
import { resolveFunctionAuth, resolveFunctionUrl } from "../_shared/internal-functions.ts";

// Orchestrator: scope_type ∈ {workstream, report}.
// For each non-deferred scenario:
//   1. Ensure a Playwright script exists (auto-generate via agent-scripts if missing/empty).
//   2. Run it once via playwright-runtime (the script iterates all filter combos internally
//      and returns { "<combo label>": { "<KPI label>": number, filters_applied: {...} } }).
//   3. For each combo, run the warehouse SQL template (script.sql_template_id || report.default)
//      with a WHERE clause derived from the combo's filters + scenario_filter_key_map (FE→BE).
//   4. Compare per-KPI scraped value vs SQL scalar (or reference) and write one test_result row
//      per combo, with expected/actual maps keyed by KPI label.

const PROJECT = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function makeCallFn(callerAuthorization: string) {
  return async (name: string, body: any) => {
    const r = await fetch(resolveFunctionUrl(name), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: resolveFunctionAuth(name, callerAuthorization),
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { raw: text, status: r.status }; }
  };
}

// Atomically merge a child report's contribution into the workstream parent run.
// Read-modify-write with retries; finalises the parent run when all children done.
async function finalizeChild(sb: any, runId: string, addPass: number, addFail: number, hadError: boolean, errMsg?: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: cur } = await sb.from("runs").select("summary, status").eq("id", runId).maybeSingle();
    if (!cur) return;
    const s: any = cur.summary || {};
    const childCount = Number(s.child_count || 0);
    const done = Number(s.done || 0) + 1;
    const merged: any = {
      pass: Number(s.pass || 0) + addPass,
      fail: Number(s.fail || 0) + addFail,
      total: Number(s.total || 0) + addPass + addFail,
      done,
      child_count: childCount,
    };
    if (hadError) merged.errors = [...(Array.isArray(s.errors) ? s.errors : []), errMsg || "child error"];
    const isLast = childCount > 0 && done >= childCount;
    const patch: any = { summary: merged };
    if (isLast) {
      patch.status = (merged.fail > 0 || hadError || (merged.errors && merged.errors.length)) ? "completed" : "completed";
      patch.finished_at = new Date().toISOString();
    }
    const { error } = await sb.from("runs").update(patch).eq("id", runId);
    if (!error) return;
    await new Promise((r) => setTimeout(r, 100 + attempt * 150));
  }
}



function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function evalAssertion(actual: number | null, expected: number | null, tol: number) {
  if (actual == null || expected == null) return { pass: false, diff: null as number | null };
  const diff = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  return { pass: diff <= tol, diff };
}

function computeCriticality(scenarioCrit: string, diffPct: number | null): string {
  const base = ["low", "medium", "high", "critical"].indexOf(scenarioCrit || "medium");
  let bump = 0;
  if (diffPct != null) {
    if (diffPct > 0.25) bump = 2;
    else if (diffPct > 0.1) bump = 1;
  }
  const idx = Math.min(3, Math.max(0, base + bump));
  return ["low", "medium", "high", "critical"][idx];
}

// Pull a combo's KPI map out of the script return payload. The script may return
// data nested under several shapes — be liberal.
function pickComboKpis(payload: any, comboLabel: string | null): Record<string, any> | null {
  const candidates = [
    payload?.extracted?.result,
    payload?.extracted?.extracted,
    payload?.result?.extracted,
    payload?.result,
    payload?.extracted,
  ];
  for (const root of candidates) {
    if (!root || typeof root !== "object") continue;
    // Single-combo (no matrix) shape: flat KPI map
    if (!comboLabel) {
      const flat: Record<string, any> = {};
      for (const [k, v] of Object.entries(root)) {
        if (["filters_applied", "screenshot", "ok", "error", "url", "title", "note", "result", "extracted"].includes(k)) continue;
        if (v && typeof v === "object") continue;
        flat[k] = v;
      }
      if (Object.keys(flat).length) return flat;
    } else {
      // Matrix shape: { "<comboLabel>": { "<KPI>": value, filters_applied: ... } }
      const node = (root as any)[comboLabel];
      if (node && typeof node === "object") {
        const flat: Record<string, any> = {};
        for (const [k, v] of Object.entries(node)) {
          if (k === "filters_applied") continue;
          if (v && typeof v === "object") continue;
          flat[k] = v;
        }
        return flat;
      }
    }
  }
  return null;
}

// Extract filters_applied for a combo from the runtime payload (pickComboKpis strips it).
function pickComboFiltersApplied(payload: any, comboLabel: string | null): Record<string, any> | null {
  const candidates = [
    payload?.extracted?.result,
    payload?.extracted?.extracted,
    payload?.result?.extracted,
    payload?.result,
    payload?.extracted,
  ];
  for (const root of candidates) {
    if (!root || typeof root !== "object") continue;
    if (comboLabel) {
      const node = (root as any)[comboLabel];
      if (node && typeof node === "object" && node.filters_applied && typeof node.filters_applied === "object") {
        return node.filters_applied;
      }
    } else if ((root as any).filters_applied && typeof (root as any).filters_applied === "object") {
      return (root as any).filters_applied;
    }
  }
  return null;
}

function swapGotoUrl(src: string, newUrl: string, oldUrl?: string): string {
  if (!src || !newUrl) return src;
  let out = src;
  // Replace every literal occurrence of the primary report URL (the auto-injected
  // auth preamble references it in multiple places, not just the first page.goto).
  if (oldUrl && oldUrl !== newUrl) {
    const esc = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), newUrl);
  }
  const re = /(page\s*\.\s*goto\s*\(\s*)(['"`])([^'"`]*)\2/;
  if (re.test(out) && !out.includes(newUrl)) {
    out = out.replace(re, (_m, p1, q) => `${p1}${q}${newUrl}${q}`);
  }
  return out;
}

function buildWhere(filters: Record<string, any>, keyMap: any[]): { where: string; pairs: { be: string; value: string }[]; missing: string[] } {
  const map = new Map<string, string>((keyMap || []).map((k: any) => [k.fe_label, k.be_column]));
  const parts: string[] = [];
  const pairs: { be: string; value: string }[] = [];
  const missing: string[] = [];
  const esc = (s: string) => String(s).replace(/'/g, "''");
  for (const [fe, v] of Object.entries(filters || {})) {
    const val = String(v ?? "");
    // "Total" is a UI-only sentinel — applied on the page by Playwright, but skipped in SQL WHERE.
    if (val.trim().toLowerCase() === "total") continue;
    const be = map.get(fe);
    if (!be) { missing.push(fe); continue; }
    parts.push(`"${be}" = '${esc(val)}'`);
    pairs.push({ be, value: val });
  }
  return { where: parts.join(" AND "), pairs, missing };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const unauthorized = await requireAuth(req);
  if (unauthorized) return unauthorized;
  const callerAuthorization = req.headers.get("Authorization") || (SERVICE_KEY ? `Bearer ${SERVICE_KEY}` : "");
  const callFn = makeCallFn(callerAuthorization);
  const sb = getSupabaseForRequest(req);
  try {
    const body = await req.json();
    const { scope_type, scope_id, trigger_source = "manual", existing_run_id, single_report_id, schedule_id } = body;
    let comparator_override: string | null = body.comparator_override || null;
    if (!comparator_override && schedule_id) {
      const { data: sch } = await sb.from("schedules").select("comparator").eq("id", schedule_id).maybeSingle();
      if (sch?.comparator) comparator_override = sch.comparator;
    }
    if (comparator_override && !["gte","lte","eq","gt","lt"].includes(comparator_override)) comparator_override = null;

    // Resolve report ids in scope
    let reportIds: string[] = [];
    if (existing_run_id && single_report_id) {
      reportIds = [single_report_id];
    } else if (scope_type === "report") {
      reportIds = [scope_id];
    } else if (scope_type === "workstream") {
      const { data } = await sb.from("reports").select("id").eq("workstream_id", scope_id);
      reportIds = (data || []).map((r) => r.id);
    } else {
      throw new Error(`unsupported scope_type ${scope_type}`);
    }

    // Reuse existing run when invoked by a workstream coordinator; otherwise create one.
    let run: any;
    if (existing_run_id) {
      const { data } = await sb.from("runs").select("*").eq("id", existing_run_id).maybeSingle();
      run = data;
      if (!run) throw new Error(`run ${existing_run_id} not found`);
    } else {
      const { data } = await sb.from("runs").insert({
        scope_type, scope_id, trigger_source, status: "running",
        summary: scope_type === "workstream" ? { pass: 0, fail: 0, total: 0, done: 0, child_count: reportIds.length } : {},
      }).select().single();
      run = data;
    }

    // Workstream coordinator: dispatch one child invocation per report (background),
    // each child processes its report and atomically finalises the parent run when last.
    if (!existing_run_id && scope_type === "workstream") {
      const dispatch = async () => {
        await Promise.all(reportIds.map((rid) =>
          callFn("agent-orchestrate", {
            scope_type: "report",
            scope_id: rid,
            trigger_source,
            existing_run_id: run.id,
            single_report_id: rid,
            comparator_override,
          }).catch((e) => console.error("child dispatch failed", rid, e))
        ));
      };
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(dispatch());
      } else {
        dispatch().catch(() => {});
      }
      if (reportIds.length === 0) {
        await sb.from("runs").update({
          status: "completed", finished_at: new Date().toISOString(),
          summary: { pass: 0, fail: 0, total: 0, done: 0, child_count: 0 },
        }).eq("id", run.id);
      }
      return new Response(JSON.stringify({ run_id: run.id, status: "running" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Heavy work runs in the background so we don't hit the 150s edge timeout.
    // Client polls runs/test_results to observe progress.
    const work = async () => {
      let pass = 0, fail = 0;
      try {
        for (const reportId of reportIds) {
          const { data: report } = await sb.from("reports").select("*").eq("id", reportId).maybeSingle();
          if (!report) continue;

          const kpiLabels: string[] = Array.isArray(report.kpi_config)
            ? report.kpi_config.filter((x: any) => typeof x === "string")
            : (report.kpi_config && typeof report.kpi_config === "object"
                ? Object.keys(report.kpi_config) : []);

          const { data: keyMap } = await sb.from("scenario_filter_key_map")
            .select("fe_label, be_column").eq("report_id", reportId);

          const { data: scenarios } = await sb.from("scenarios")
            .select("id, title, type, criticality, deferred")
            .eq("report_id", reportId)
            .eq("deferred", false);

          for (const s of scenarios || []) {
            let { data: script } = await sb.from("scripts")
              .select("id, playwright_code, sql_template_id, updated_at")
              .eq("scenario_id", s.id)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (!script || !script.playwright_code || !script.playwright_code.trim()) {
              const gen = await callFn("agent-scripts", { scenario_id: s.id });
              if (gen?.script?.playwright_code) {
                script = gen.script;
              } else {
                await sb.from("test_results").insert({
                  run_id: run.id, scenario_id: s.id, status: "fail",
                  expected: { error: "script_generation_failed" },
                  actual: { error: gen?.message || gen?.error || "agent-scripts returned no code" },
                  diff: null, criticality: s.criticality || "medium", severity: s.criticality || "medium",
                });
                fail++;
                continue;
              }
            }

            const runResp = await callFn("playwright-runtime", {
              mode: "headless", scenario_id: s.id, code: script.playwright_code,
            });
            if (runResp?.error || runResp?.ok === false) {
              await sb.from("test_results").insert({
                run_id: run.id, scenario_id: s.id, status: "fail",
                expected: { source: "scrape" },
                actual: { error: runResp?.error || runResp?.message || "scrape failed" },
                diff: null, criticality: s.criticality || "medium", severity: s.criticality || "medium",
                screenshot_url: runResp?.screenshot_url || null,
              });
              fail++;
              continue;
            }

            const { data: matrix } = await sb.from("scenario_filter_matrix")
              .select("id, label, filters").eq("scenario_id", s.id)
              .order("created_at", { ascending: true });
            const hasCombos = !!(matrix && matrix.length > 0);
            const combos = hasCombos
              ? matrix!.map((m: any, i: number) => ({ id: m.id, label: m.label || `combo_${i + 1}`, filters: m.filters || {} }))
              : [{ id: null, label: null as string | null, filters: {} as Record<string, any> }];

            const isRef = s.type === "reference_match";
            let sqlTplId = isRef ? null : ((script as any)?.sql_template_id || (report as any)?.default_sql_template_id || null);

            // Reference-match: ensure reference script exists and run it once.
            let refResp: any = null;
            let refError: string | null = null;
            if (isRef) {
              const refUrl: string = (report as any)?.reference_url || "";
              const primaryUrl: string = (report as any)?.url || "";
              // Refetch assertion_spec so we pick up any freshly-generated ref code.
              const { data: freshScript } = await sb.from("scripts")
                .select("id, assertion_spec")
                .eq("id", (script as any)?.id).maybeSingle();
              const aspec: any = (freshScript as any)?.assertion_spec
                || (script as any)?.assertion_spec || {};
              let refCode: string = aspec.__reference_playwright_code || "";
              if (!refCode || !refCode.trim()) {
                // Strategy: if reference_url is set AND differs from primary
                // URL, this is the "same screen, different env" case — swap
                // URLs in the main script. Otherwise it's the "two-screen,
                // same URL" case — ask agent-scripts to generate a dedicated
                // reference script from the description.
                const isEnvSwap = !!refUrl && !!primaryUrl && refUrl !== primaryUrl;
                if (isEnvSwap) {
                  refCode = swapGotoUrl(script.playwright_code || "", refUrl, primaryUrl);
                  if (refCode && (script as any)?.id) {
                    await sb.from("scripts").update({
                      assertion_spec: { ...aspec, __reference_playwright_code: refCode, __reference_generated_by: "url_swap" },
                    }).eq("id", (script as any).id);
                  }
                } else {
                  const gen = await callFn("agent-scripts", { scenario_id: s.id, target: "reference" });
                  const genSpec: any = gen?.script?.assertion_spec || {};
                  refCode = genSpec.__reference_playwright_code || "";
                  if (!refCode || !refCode.trim()) {
                    refError = gen?.error || gen?.message || "reference_script_generation_failed";
                  }
                }
              }
              if (!refError) {
                refResp = await callFn("playwright-runtime", {
                  mode: "headless", scenario_id: s.id, code: refCode, target: "reference",
                });
                if (refResp?.error || refResp?.ok === false) {
                  refError = refResp?.error || refResp?.message || "reference scrape failed";
                }
              }
            }

            for (const combo of combos) {
              const scraped = pickComboKpis(runResp, combo.label) || {};

              let expectedMap: Record<string, number | null> = {};
              let sqlMeta: any = { source: isRef ? "reference_script" : (sqlTplId ? "warehouse" : "none") };
              let sqlRow: Record<string, any> | null = null;

              if (isRef) {
                const refScraped = refError ? {} : (pickComboKpis(refResp, combo.label) || {});
                sqlMeta = {
                  source: "reference_script",
                  reference_url: (report as any)?.reference_url || null,
                  ok: !refError,
                  error: refError,
                  ran_without_filters: !hasCombos,
                };
                sqlRow = refError ? null : refScraped;
                for (const lbl of kpiLabels.length ? kpiLabels : Object.keys(scraped)) {
                  expectedMap[lbl] = toNum((refScraped as any)[lbl]);
                }
              } else if (sqlTplId) {
                const { where, pairs, missing } = hasCombos
                  ? buildWhere(combo.filters || {}, keyMap || [])
                  : { where: "", pairs: [] as { be: string; value: string }[], missing: [] as string[] };
                const sqlResp = await callFn("run-warehouse-sql", {
                  sql_template_id: sqlTplId,
                  scenario_id: s.id,
                  where_clause: where || undefined,
                  filter_pairs: pairs,
                  limit: 5,
                });
                sqlMeta = {
                  source: "warehouse",
                  connector: sqlResp?.connector,
                  where_clause: where || null,
                  missing_keys: missing,
                  ok: sqlResp?.ok,
                  error: sqlResp?.error,
                  row_count: sqlResp?.row_count ?? (sqlResp?.rows?.length ?? 0),
                  ran_without_filters: !hasCombos,
                };
                const rows = sqlResp?.rows || [];
                const cols: string[] = sqlResp?.columns || [];
                sqlRow = rows[0] || null;
                const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                const colNorms = cols.map((c) => ({ c, n: norm(c) }));
                const findCol = (lbl: string): string | null => {
                  const n = norm(lbl);
                  if (!n) return null;
                  const exact = colNorms.find((x) => x.n === n);
                  if (exact) return exact.c;
                  const prefix = colNorms.find((x) => x.n.startsWith(n) || n.startsWith(x.n));
                  return prefix ? prefix.c : null;
                };
                for (const lbl of kpiLabels.length ? kpiLabels : Object.keys(scraped)) {
                  const col = findCol(lbl);
                  if (col && rows[0]) expectedMap[lbl] = toNum(rows[0][col]);
                  else if (sqlResp?.scalar != null) expectedMap[lbl] = toNum(sqlResp.scalar);
                  else expectedMap[lbl] = null;
                }
              }

              const actualMap: Record<string, number | null> = {};
              const diffMap: Record<string, any> = {};
              let comboPass = true;
              const labels = (kpiLabels.length ? kpiLabels : Object.keys(scraped));
              const kpiTol: Record<string, any> = ((script as any)?.assertion_spec || {}).kpi_tolerances || {};
              
              for (const lbl of labels) {
                const a = toNum((scraped as any)[lbl]);
                actualMap[lbl] = a;
                const e = expectedMap[lbl] ?? null;
                if (s.type === "range_check") {
                  const ok = a != null && a >= 0 && a <= 1e12;
                  diffMap[lbl] = { value: a };
                  if (!ok) comboPass = false;
                } else if (s.type === "trend" || (!sqlTplId && !isRef)) {
                  if (a == null) { comboPass = false; diffMap[lbl] = { error: "no_value" }; }
                  else diffMap[lbl] = { value: a };
                } else {
                  // Tolerance-aware evaluation, matching the UI logic in RunScenarioCard
                  const tEntry: any = kpiTol[lbl];
                  const tVal = tEntry && typeof tEntry === "object" ? Number(tEntry.value) : Number(tEntry);
                  const tUnit = (tEntry && typeof tEntry === "object" && tEntry.unit) || "pct";
                  let tOp = (tEntry && typeof tEntry === "object" && tEntry.op) || "eq";
                  // Schedule-level comparator override (reference_match only)
                  if (isRef && comparator_override) tOp = comparator_override;
                  let pass = false;
                  let pct: number | null = null;
                  if (a == null || e == null) {
                    pass = false;
                  } else {
                    const d = a - e;
                    pct = e !== 0 ? Math.abs(d) / Math.abs(e) : (d === 0 ? 0 : 1);
                    const allowed = Number.isFinite(tVal)
                      ? (tUnit === "abs" ? Math.abs(tVal) : (Math.abs(tVal) / 100) * Math.abs(e))
                      : 0;
                    if (tOp === "lte") pass = (d - allowed) <= 0;
                    else if (tOp === "gte") pass = (-d - allowed) <= 0;
                    else if (tOp === "gt") pass = (d - allowed) > 0;
                    else if (tOp === "lt") pass = (-d - allowed) > 0;
                    else pass = Math.abs(d) <= allowed;
                  }
                  diffMap[lbl] = {
                    pct, expected: e, actual: a,
                    tolerance: Number.isFinite(tVal) ? { value: tVal, unit: tUnit, op: tOp } : null,
                  };
                  if (!pass) comboPass = false;
                }
              }

              // Guard against false positives: if no KPI labels were evaluated,
              // or every actual value is missing/null, treat the combo as failed
              // rather than letting an empty loop default to pass.
              const actualVals = Object.values(actualMap);
              const allActualsNull = actualVals.length === 0 || actualVals.every((v) => v == null);
              if (labels.length === 0 || allActualsNull) {
                comboPass = false;
                if (labels.length === 0) {
                  diffMap["__no_kpi__"] = { error: "no_kpi_values_returned" };
                } else {
                  for (const lbl of labels) {
                    if (actualMap[lbl] == null) {
                      diffMap[lbl] = { ...(diffMap[lbl] || {}), error: "no_value" };
                    }
                  }
                }
              }

              const status = comboPass ? "pass" : "fail";
              if (comboPass) pass++; else fail++;
              const worstDiff = Object.values(diffMap)
                .map((d: any) => (typeof d?.pct === "number" ? d.pct : null))
                .filter((x): x is number => x != null)
                .reduce((m, v) => Math.max(m, v), 0);
              const crit = comboPass ? null : computeCriticality((s as any).criticality || "medium", worstDiff || null);

              // Snapshot tolerances that were in effect at run time so future
              // edits in ScenarioDetail do NOT mutate this historical run's pass/fail.
              const tolerancesSnapshot: Record<string, any> = {};
              const VALID_OPS = new Set(["lte","gte","eq","gt","lt"]);
              const overrideOp = (isRef && comparator_override && VALID_OPS.has(comparator_override)) ? comparator_override : null;
              for (const lbl of labels) {
                const tEntry: any = kpiTol[lbl];
                if (tEntry && typeof tEntry === "object") {
                  const baseOp = VALID_OPS.has(tEntry.op) ? tEntry.op : "eq";
                  tolerancesSnapshot[lbl] = { value: Number(tEntry.value) || 0, unit: tEntry.unit === "abs" ? "abs" : "pct", op: overrideOp || baseOp };
                } else if (Number.isFinite(Number(tEntry))) {
                  tolerancesSnapshot[lbl] = { value: Number(tEntry), unit: "pct", op: overrideOp || "eq" };
                } else if (overrideOp) {
                  tolerancesSnapshot[lbl] = { value: 0, unit: "pct", op: overrideOp };
                }
              }
              const { data: tr } = await sb.from("test_results").insert({
                run_id: run.id, scenario_id: s.id, status,
                expected: { source: sqlMeta.source, filter: combo.label, where_clause: sqlMeta.where_clause, values: expectedMap, row: sqlRow, sql: sqlMeta },
                actual: { filter: combo.label, values: actualMap, filters_applied: pickComboFiltersApplied(runResp, combo.label) || combo.filters || null, tolerances_snapshot: tolerancesSnapshot },
                diff: diffMap,
                criticality: crit,
                severity: crit,
                rank_score: comboPass ? 0 : (["low", "medium", "high", "critical"].indexOf(crit || "medium") + 1),
                screenshot_url: runResp?.screenshot_url || null,
              }).select().single();

              if (!comboPass && tr?.id) {
                callFn("agent-analyze", { test_result_id: tr.id }).catch(() => {});
              }
            }
          }
        }

        if (existing_run_id) {
          await finalizeChild(sb, run.id, pass, fail, false);
        } else {
          await sb.from("runs").update({
            status: "completed", finished_at: new Date().toISOString(),
            summary: { pass, fail, total: pass + fail },
          }).eq("id", run.id);
        }
      } catch (e) {
        if (existing_run_id) {
          await finalizeChild(sb, run.id, pass, fail, true, String(e));
        } else {
          await sb.from("runs").update({
            status: "failed", finished_at: new Date().toISOString(),
            summary: { pass, fail, total: pass + fail, error: String(e) },
          }).eq("id", run.id);
        }
      }
    };

    // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work());
    } else {
      work().catch(() => {});
    }

    return new Response(JSON.stringify({ run_id: run.id, status: "running" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
