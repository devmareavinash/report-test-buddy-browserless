---
name: mstr-rtb-validate
description: >-
  Edit and debug the Report Test Buddy generate-time validation agent
  (post-Generate Browserless check + repair loop). Use when changing
  script-gen-validate-loop, script-validation, SCRIPT_VALIDATE_ON_GENERATE,
  SCRIPT_VALIDATE_MAX_ATTEMPTS, or the scripts repair agent. Do not use for
  Run headless, Latest result compare, or MSTR scrape templates.
---

# RTB generate-time validation skill

**Human doc:** `docs/VALIDATION_AGENT.md` — keep this skill aligned with that file and the TS sources.  
**Not this skill:** scrape templates / Generate assembly → `mstr-rtb-script-gen`.

## When to use

- Changing pass/fail checks, repair prompts, attempt caps, or skip reasons
- “Validation skipped”, “repair loop”, `skill:repair:N`, `SCRIPT_VALIDATE_*`
- Generate/Regenerate works but the script never gets a live Browserless smoke test

Do **not** mix this with Run-headless compare or Latest result mapping.

## Canonical flow

Runs only from `agent-scripts` after template assemble **or** LLM fallback. Not from the Run headless button or `agent-orchestrate`.

```
assemble / LLM
  → skip if SCRIPT_VALIDATE_ON_GENERATE=false or BROWSERLESS_TOKEN unset
  → buildExpectations (+ parseNavStepsFromScenario only if meta.nav_steps omitted; explicit [] = stay on page)
  → loop: playwright-runtime (first combo only) → analyzeScriptRun
  → pass: persist that code
  → fail Browserless 500 / Chromium launch crash: retry Browserless once (same code, no LLM); if still crash, persist assembled and stop
  → fail (script/nav/extract): repair LLM (240s fetch + 2 retries; not skipped for extract) → retry
  → repair throw (fetch failed / missing key / gateway after retries): stop loop, keep last code
  → always persist last code (even if still failing)
```

Repair uses `callAgent({ agentKey: "scripts" })` and **`SCRIPT_GEN_SKILL_LLM_BLOCK`** from `script-gen-skill.ts`, plus `formatValidationForAgent` (head+tail excerpt, not the full 60k script). JSON `{ "playwright_code": "..." }`. Successful repair tags `generated_by` as `skill:repair:<attempt>`. Assembled `skill:overview_kpi` / `chart_show_data` / grid templates still call repair on extract fail — do not add a keep-template skip.

## Env knobs

| Var | Behavior |
|-----|----------|
| `SCRIPT_VALIDATE_ON_GENERATE` | On unless value is exactly `false`. Unset = on. |
| `SCRIPT_VALIDATE_MAX_ATTEMPTS` | Clamped 1–10; code default **5** |
| `BROWSERLESS_TOKEN` | Unset → skip (script still saved) |
| `LOCAL_FUNCTIONS_URL` | POST target for `/playwright-runtime` |
| `ANTHROPIC_FETCH_TIMEOUT_MS` | Magentic/Anthropic fetch timeout. Default **240000**. Retries twice on timeout / fetch failed. |

`.env.example` ships `true` / `5`. Deno reads `.env` at start — **restart `scripts/dev-backend.ps1`** after changes.

## Pass / fail (do not invent new extract shapes)

| Kind | `extract` | Pass |
|------|-----------|------|
| overview / activity | `kpi` | ≥1 numeric / numeric-looking KPI |
| chart (`chart` in kind) | `chart_table` | ≥2 headers + ≥1 row (`tableData` / title / `Overall Performance`) |
| grid (`grid` in kind) | `grid` | ≥2 cols + ≥1 row; reject KPI chrome / Line-copy |

Also: runtime `ok`, each `NAV_STEPS` clicked, time grain if expected, each first-combo filter `ok` or `clicked`. Shape only — not main-vs-reference numbers.

`analyzeScriptRun` must keep the parent `{ navigation, results }` object. Unwrapping `results` first drops `navDebug` and falsely fails navigation (`navDebug=[]`) even when tabs were clicked. Combo extract/filters still come from the first `results` entry.

## App wiring

| File | Role |
|------|------|
| `supabase/functions/_shared/script-gen-validate-loop.ts` | Loop, execute, repair |
| `supabase/functions/_shared/script-validation.ts` | Checks + agent report |
| `supabase/functions/agent-scripts/index.ts` | Calls loop, then persist |
| `supabase/functions/_shared/llm.ts` | `callAgent` / `tryParseJson` |
| `supabase/functions/_shared/script-gen-skill.ts` | Repair skill block |
| `supabase/functions/playwright-runtime/index.ts` | Browserless run |
| `src/pages/ScenarioDetail.tsx` | Generate vs Run headless UI — do not treat Run as this loop |

When editing checks or repair, change the TS first, then this skill and `docs/VALIDATION_AGENT.md`.
