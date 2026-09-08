---
name: mstr-rtb-script-gen
description: Generate accurate MicroStrategy Playwright scripts for Report Test Buddy using proven working templates (KPI tiles, chart Show Data, grid). Use when generating or regenerating RTB scenario scripts. User description picks KPI vs chart vs grid; only URL, page names, labels, and filter names from the UI are filled into a fixed template.
---

# RTB MSTR Script Generation Skill

**App wiring:** `supabase/functions/agent-scripts` + `_shared/script-gen-skill.ts` + `mstr-*-template.ts` + `mstr-nav-parse.ts`  
**Runtime:** Browserless `/function` — `export default async ({ page }) => { ... }`

## Core rule (read this first)

The user describes **what** they need. The generator picks the matching **template** and fills **only UI-specific names**.

| User asks for… | Template | Extract step |
|----------------|----------|--------------|
| **KPI** / pass values / tiles | `overview_kpi` or `activity_kpi` | `extractKPI` |
| **Chart** / graph / Show Data / Weekly·Monthly·Quarterly toggle | `chart_show_data` | Menu → **Show Data** → multi-column table |
| **Grid** / crosstab / Geography Details / Trend Grid | `geography_grid` | Menu → **Show Data** (on-page scroll fallback) |

### Always the same (do not rewrite)

1. Open report **URL**
2. **Login** (`__creds`) if login form
3. Wait for page load (`waitForLoadingToFinish`)
4. **Page navigation** mechanics (`clickByText` / `NAV_STEPS` loop)
5. **Filter application** mechanics (`selectByLabel`, geo order, waits)
6. Wait for data, then extract with the template’s helper

### Only these change (from scenario description / UI)

| Slot | Source |
|------|--------|
| Report URL | Screen report URL (main or reference) |
| Page / tab names (`NAV_STEPS`) | Description: “Navigate to the **Activity** Screen…”, “… **Performance Trend** sub tab” |
| KPI labels | UI / scenario KPIs |
| Chart title | Description: “capture the **Activity Trend** graph…” |
| Grid title (+ columns if listed) | Description: “**Performance Trends** Grid…” |
| Time grain | Description: “**Quarterly** toggle” / Monthly / Weekly |
| Filter **names** | Filter combo keys from UI (`Area`, `Region`, …) |
| Filter **values** | Runtime `__filterCombinations` — **never hardcode** |

Do **not** invent Performance vs Activity vs Trend. Different widgets live on different screens — only navigate where the user said.

## Canonical pipeline (every template)

```
1. Open URL (domcontentloaded)
2. Authenticate (__creds) if login form
3. Wait until page load          → waitForLoadingToFinish
4. Navigate pages/tabs named by user → clickByText / NAV_STEPS
5. Wait until filter bar / viz ready → waitForDashboard
6. Apply filters (standard selectByLabel)
7. Wait until data load
8. Extract by kind: KPI | Show Data chart | Show Data/on-page grid
```

## Filter gold standard

- Order: `GEO_ORDER = ['Area', 'Region', 'Territory']` then other keys  
  (Grids may also apply `Time Bucket` after geo — not Weekly/Monthly radios)
- Helper: `selectByLabel` with legacy `.mstrmojo-DocSelector` allowed
- After each successful pick: `waitForLoadingToFinish`
- One `waitForDashboard` after nav and again before scrape

## Template details

| Kind | When (from description) | Do **not** |
|------|-------------------------|------------|
| `overview_kpi` | Overview / default KPI tiles | Show Data / canvas |
| `activity_kpi` | Activity tab + KPI tiles (not a graph) | chart/grid scrapers |
| `chart_show_data` | graph / chart / Segment Summary / Overall Performance / Activity Trend | `extractKPI`, canvas/SVG, 1-col KPI scrapes |
| `geography_grid` | grid / Geography Details / Performance Trend Grid | KPI tile scrape |
| `llm` | Novel only (no detector match) | invent new extract shapes |

A chart result with **one header** and **one value** is a **failed KPI scrape**, not chart data. Reject it.

## What NOT to change when filling a template

- Auth preamble, viewport / zoom, wait helpers
- Geo filter cadence and `selectByLabel` body
- **`extractKPI` / `openShowData` / `extractShowDataTable` / `extractOnPageGrid` bodies**
- Mixing extractors across kinds

## Agent-scripts order

`grid → chart → overview_kpi → activity_kpi → LLM`

Mark `generated_by` as `skill:<kind>` when template-assembled.

## Local app wiring

Generate/Regenerate must hit the **local** Deno backend (`agent-scripts` in `VITE_LOCAL_FUNCTIONS` + Vite proxy).

## Post-generate validation agent

On **Generate / Regenerate only** (not manual Run headless):
1. Assemble or LLM-generate the script
2. Execute once via Browserless (first filter combo)
3. Check **navigation**, **filters**, and **extraction**
4. On failure → repair agent; retry up to **5** attempts (`SCRIPT_VALIDATE_MAX_ATTEMPTS`)

Disable with `SCRIPT_VALIDATE_ON_GENERATE=false`.
