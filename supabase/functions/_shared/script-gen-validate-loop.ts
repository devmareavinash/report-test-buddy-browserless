/**
 * Generate-time validation loop: run script on Browserless, check nav/filters/extract,
 * feed failures back to the scripts LLM for repair (max attempts).
 */

import { callAgent, tryParseJson } from "./llm.ts";
import {
  analyzeScriptRun,
  buildExpectations,
  formatValidationForAgent,
  type ScriptExpectations,
  type ValidationReport,
} from "./script-validation.ts";
import { SCRIPT_GEN_SKILL_LLM_BLOCK } from "./script-gen-skill.ts";
import type { ScriptAgentSessionLog } from "./script-agent-log.ts";

export const SCRIPT_VALIDATE_MAX_ATTEMPTS = 5;

function functionsBase(): string {
  return (Deno.env.get("LOCAL_FUNCTIONS_URL") || "http://127.0.0.1:8000/functions/v1").replace(/\/$/, "");
}

export async function executeScriptValidation(opts: {
  req: Request;
  scenarioId: string;
  code: string;
  target: "main" | "reference";
  filterCombinations?: { label?: string; filters?: Record<string, unknown> }[];
}): Promise<any> {
  const auth = opts.req.headers.get("Authorization") || "";
  const apikey = opts.req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const body: Record<string, unknown> = {
    mode: "headless",
    scenario_id: opts.scenarioId,
    code: opts.code,
    target: opts.target,
  };
  // Validate against a single combo to keep generate latency bounded.
  if (opts.filterCombinations?.length) {
    const c = opts.filterCombinations[0];
    body.filter_combinations = [{
      label: c.label || "combo_1",
      filters: c.filters || {},
    }];
  }
  const resp = await fetch(`${functionsBase()}/playwright-runtime`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
      ...(apikey ? { apikey } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    return {
      ok: false,
      error: "VALIDATION_RUN_PARSE_ERROR",
      message: `playwright-runtime returned non-JSON (${resp.status}): ${text.slice(0, 200)}`,
    };
  }
  if (!resp.ok && !payload) {
    return { ok: false, error: "VALIDATION_RUN_HTTP", message: `playwright-runtime ${resp.status}` };
  }
  return payload;
}

export async function repairScriptFromValidation(opts: {
  previousCode: string;
  report: ValidationReport;
  scenario: any;
  reportUrl: string;
  attempt: number;
}): Promise<string | null> {
  const title = opts.scenario?.title || "";
  const desc = opts.scenario?.description || "";
  const raw = await callAgent({
    agentKey: "scripts",
    json: true,
    messages: [
      {
        role: "system",
        content: `You are the RTB script REPAIR agent. A validation run failed after generate/regenerate.
${SCRIPT_GEN_SKILL_LLM_BLOCK}

Fix the Playwright script so navigation, filters, and extraction pass.
Return JSON only: { "playwright_code": "..." }
Attempt ${opts.attempt} of ${SCRIPT_VALIDATE_MAX_ATTEMPTS}.`,
      },
      {
        role: "user",
        content: [
          `Scenario: ${title}`,
          `Description: ${desc}`,
          `Report URL: ${opts.reportUrl}`,
          "",
          formatValidationForAgent(opts.report, opts.previousCode),
        ].join("\n"),
      },
    ],
  });
  const parsed = tryParseJson(raw) || {};
  let code = String(parsed.playwright_code || "").trim();
  if (!code) {
    // Recover fenced JS if model ignored JSON
    const fence = raw.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
    if (fence?.[1] && /export\s+default/.test(fence[1])) code = fence[1].trim();
  }
  if (!code || !/export\s+default/.test(code)) return null;
  return code;
}

export type ValidateLoopResult = {
  playwright_code: string;
  generatedBy: string;
  validation: {
    enabled: boolean;
    passed: boolean;
    attempts: number;
    max_attempts: number;
    reports: ValidationReport[];
    skipped_reason?: string;
  };
  meta?: Record<string, unknown>;
};

export async function runGenerateValidationLoop(opts: {
  req: Request;
  scenarioId: string;
  scenario: any;
  target: "main" | "reference";
  reportUrl: string;
  initialCode: string;
  generatedBy: string;
  meta?: Record<string, unknown>;
  filterCombos?: { label?: string; filters?: Record<string, unknown> }[];
  log?: ScriptAgentSessionLog;
}): Promise<ValidateLoopResult> {
  const log = opts.log;
  const enabled = Deno.env.get("SCRIPT_VALIDATE_ON_GENERATE") !== "false";
  const maxAttempts = Math.min(
    10,
    Math.max(1, Number(Deno.env.get("SCRIPT_VALIDATE_MAX_ATTEMPTS") || SCRIPT_VALIDATE_MAX_ATTEMPTS)),
  );

  if (!enabled) {
    await log?.log(
      "script-validate",
      "skip",
      "Validation skipped (SCRIPT_VALIDATE_ON_GENERATE=false)",
      { max_attempts: maxAttempts },
      "warn",
    );
    return {
      playwright_code: opts.initialCode,
      generatedBy: opts.generatedBy,
      meta: opts.meta,
      validation: {
        enabled: false,
        passed: false,
        attempts: 0,
        max_attempts: maxAttempts,
        reports: [],
        skipped_reason: "SCRIPT_VALIDATE_ON_GENERATE=false",
      },
    };
  }

  if (!Deno.env.get("BROWSERLESS_TOKEN")) {
    await log?.log(
      "script-validate",
      "skip",
      "Validation skipped (BROWSERLESS_TOKEN not set)",
      { max_attempts: maxAttempts },
      "warn",
    );
    return {
      playwright_code: opts.initialCode,
      generatedBy: opts.generatedBy,
      meta: opts.meta,
      validation: {
        enabled: false,
        passed: false,
        attempts: 0,
        max_attempts: maxAttempts,
        reports: [],
        skipped_reason: "BROWSERLESS_TOKEN not set — skipped validation run",
      },
    };
  }

  const firstFilters = opts.filterCombos?.[0]?.filters || {};
  const filterKeys = Object.keys(firstFilters);
  const expectations: ScriptExpectations = buildExpectations({
    scenario: opts.scenario,
    kind: opts.generatedBy,
    meta: {
      ...(opts.meta || {}),
      generated_by: opts.generatedBy,
    },
    filterKeys,
  });

  // If template meta omitted nav, parse from scenario description (never invent screens).
  if (!expectations.navSteps.length) {
    const { parseNavStepsFromScenario } = await import("./mstr-nav-parse.ts");
    expectations.navSteps = parseNavStepsFromScenario(opts.scenario, {
      allowGeography: expectations.extract === "grid",
    });
  }

  await log?.log("script-validate", "start", "Validation loop started", {
    scenario_id: opts.scenarioId,
    generated_by: opts.generatedBy,
    max_attempts: maxAttempts,
    expectations: {
      extract: expectations.extract,
      nav_steps: expectations.navSteps,
      time_grain: expectations.timeGrain || null,
      chart_title: expectations.chartTitle || null,
      grid_title: expectations.gridTitle || null,
      filter_keys: expectations.filterKeys || [],
    },
    code_bytes: opts.initialCode.length,
  });

  let code = opts.initialCode;
  let generatedBy = opts.generatedBy;
  const reports: ValidationReport[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await log?.log("script-validate", "attempt_start", `Attempt ${attempt}/${maxAttempts}`, {
      attempt,
      max_attempts: maxAttempts,
      code_bytes: code.length,
      generated_by: generatedBy,
    });

    let runPayload: any;
    const runStarted = Date.now();
    try {
      runPayload = await executeScriptValidation({
        req: opts.req,
        scenarioId: opts.scenarioId,
        code,
        target: opts.target,
        filterCombinations: opts.filterCombos,
      });
    } catch (e) {
      runPayload = {
        ok: false,
        error: "VALIDATION_RUN_EXCEPTION",
        message: String((e as Error)?.message || e),
      };
    }
    const runMs = Date.now() - runStarted;

    const report = analyzeScriptRun(runPayload, expectations);
    report.attempt = attempt;
    reports.push(report);

    await log?.log(
      "script-validate",
      "attempt_result",
      report.ok ? `Attempt ${attempt} PASS` : `Attempt ${attempt} FAIL`,
      {
        attempt,
        passed: report.ok,
        summary: report.summary,
        duration_ms: runMs,
        checks: report.checks.map((c) => ({ name: c.name, pass: c.pass, detail: c.detail })),
        runtime_ok: runPayload?.ok !== false,
        runtime_error: runPayload?.error || runPayload?.message || null,
      },
      report.ok ? "info" : "warn",
    );

    if (report.ok) {
      await log?.log("script-validate", "passed", `Validation passed on attempt ${attempt}`, {
        attempts: attempt,
        max_attempts: maxAttempts,
      });
      return {
        playwright_code: code,
        generatedBy,
        meta: opts.meta,
        validation: {
          enabled: true,
          passed: true,
          attempts: attempt,
          max_attempts: maxAttempts,
          reports,
        },
      };
    }

    if (attempt >= maxAttempts) break;

    await log?.log("script-validate", "repair_start", `Repairing script after attempt ${attempt}`, {
      attempt,
      next_attempt: attempt + 1,
    });
    try {
      const repaired = await repairScriptFromValidation({
        previousCode: code,
        report,
        scenario: opts.scenario,
        reportUrl: opts.reportUrl,
        attempt: attempt + 1,
      });
      if (repaired) {
        code = repaired;
        generatedBy = `skill:repair:${attempt}`;
        await log?.log("script-validate", "repair_ok", "Repair agent returned updated script", {
          attempt,
          generated_by: generatedBy,
          code_bytes: code.length,
        });
      } else {
        await log?.log(
          "script-validate",
          "repair_empty",
          "Repair returned empty code; keeping previous",
          { attempt },
          "warn",
        );
      }
    } catch (e) {
      await log?.log(
        "script-validate",
        "repair_failed",
        String((e as Error)?.message || e),
        { attempt },
        "error",
      );
    }
  }

  await log?.log(
    "script-validate",
    "failed",
    `Validation failed after ${reports.length} attempt(s)`,
    {
      attempts: reports.length,
      max_attempts: maxAttempts,
      last_summary: reports[reports.length - 1]?.summary || null,
    },
    "warn",
  );

  return {
    playwright_code: code,
    generatedBy,
    meta: opts.meta,
    validation: {
      enabled: true,
      passed: false,
      attempts: reports.length,
      max_attempts: maxAttempts,
      reports,
    },
  };
}
