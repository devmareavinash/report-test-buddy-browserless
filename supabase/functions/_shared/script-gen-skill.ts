/**
 * Canonical script-generation skill for RTB (local agent-scripts).
 * Mirrors `.cursor/skills/mstr-rtb-script-gen/SKILL.md`.
 *
 * Policy: user description picks KPI | chart | grid template.
 * Fill only URL + page names + labels + filter names from UI.
 * Login, navigation mechanics, and filter application stay fixed.
 * Call LLM only for novel cases.
 */

export const SCRIPT_GEN_SKILL_ID = "mstr-rtb-script-gen";
export const SCRIPT_GEN_SKILL_VERSION = "1.1.0";

export type ScriptGenKind =
  | "overview_kpi"
  | "activity_kpi"
  | "chart_show_data"
  | "geography_grid"
  | "llm";

/** Proven pipeline shared by all working scripts. */
export const CANONICAL_PIPELINE = [
  "open_url",
  "authenticate",
  "wait_page_load",
  "navigate_tab_if_needed",
  "wait_data_or_filter_bar",
  "apply_filters_kpi_style",
  "wait_data_after_filters",
  "extract_kpi_or_graph_or_grid",
] as const;

/**
 * Gold-standard filter cadence from the working KPI Overview script.
 * Geography may append Time Bucket after geo keys.
 */
export const KPI_GEO_ORDER = ["Area", "Region", "Territory"] as const;
export const GRID_GEO_ORDER = ["Area", "Region", "Territory", "Time Bucket"] as const;

/** Injected into Claude when falling back — keep aligned with SKILL.md. */
export const SCRIPT_GEN_SKILL_LLM_BLOCK = `
═══════════════════════════════════════════════════════
RTB SCRIPT-GEN SKILL (${SCRIPT_GEN_SKILL_ID} v${SCRIPT_GEN_SKILL_VERSION})
═══════════════════════════════════════════════════════
You are the NOVEL-CASE fallback after template detect (KPI | chart | grid).

USER DESCRIPTION PICKS THE KIND:
  - KPI / pass-value tiles     → extractKPI (largest font under label)
  - Chart / graph / toggle     → openShowData + multi-column Show Data table
  - Grid / crosstab            → grid Show Data or on-page scroll
Never mix extractors across kinds. Never invent screens the user did not name.

FIXED (copy from working templates — do not rewrite):
  1) Open URL (domcontentloaded)
  2) Authenticate with __creds if login form
  3) waitForLoadingToFinish
  4) Navigate NAV_STEPS via clickByText (pages/tabs the user named)
  5) waitForDashboard / filter bar on THAT page
  6) Apply filters: GEO_ORDER Area→Region→Territory then others;
     selectByLabel + legacy DocSelector; wait load after EACH pick
  7) Wait data load
  8) Extract by kind ONLY (see above)

FILL ONLY FROM USER / UI:
  - report URL
  - NAV_STEPS (page / tab / sub-tab names from description)
  - KPI_LABELS / CHART_TITLE / GRID_TITLE (+ columns if listed)
  - TIME_GRAIN if description says Weekly/Monthly/Quarterly toggle
  - filter names from UI; values from __filterCombinations (never hardcode)

Do NOT change wait helpers, geo cadence, or extract helper bodies.
Do NOT hardcode Performance vs Activity — only navigate where the description says.
`.trim();

export function skillGeneratedBy(kind: Exclude<ScriptGenKind, "llm">): string {
  return `skill:${kind}`;
}
