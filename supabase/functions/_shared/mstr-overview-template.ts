/** Deterministic KPI Playwright script (Overview, Activity, or any numeric tiles). Only URL, KPI labels, and NAV_STEPS vary. */

import { parseNavStepsFromScenario, scenarioTextBlob } from "./mstr-nav-parse.ts";

export const DEFAULT_OVERVIEW_KPIS = [
  "NBRx Total",
  "TRx Total",
  "BlinkRx TRx",
  "BlinkRx NBRx",
  "New Writers",
  "Total Writers",
  "Target Writers (%)",
  "Paid Insured Rate",
  "Total HCP Calls",
  "Reach %",
  "My Plan Reach (%)",
  "Calls to Target (%)",
  "Frequency",
  "BAP to PICR %",
  "Calls/Day (HCP)",
  "PA/ME Submission Rate",
  "PA/ME Initiated Volume",
  "Approval Rate",
  "Samples Dropped",
];

export function normalizeReportUrl(raw: string): string {
  const url = String(raw || "").trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    u.searchParams.delete("continue");
    let out = u.toString();
    if (out.endsWith("?") || out.endsWith("&")) out = out.slice(0, -1);
    return out;
  } catch {
    return url.replace(/[?&]continue(?:=[^&]*)?/i, "").replace(/[?&]$/, "");
  }
}

function looksLikeDateKpiNoise(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  const t = s.toLowerCase();
  if (/\brefresh\s*date\b/.test(t)) return true;
  if (/^(claims me|call activity we)$/i.test(s)) return true;
  if (/\b(as\s*of|data\s*as\s*of)\b/.test(t)) return true;
  if (/^sales\s*\(/i.test(s) && /\b(nbrx|nrx|trx)\b/i.test(s)) return true;
  return false;
}

function looksLikeUserKpiLabel(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s || s.length > 80) return false;
  if (looksLikeDateKpiNoise(s)) return false;
  if (/^(overview|activity|performance|geography|filters?|navigation|summary)$/i.test(s)) return false;
  if (/\b(screen|tab|page|report|dashboard|graph|chart|grid|toggle)\b/i.test(s)) return false;
  return /\b(nbrx|nrx|trx|writers|reach|frequency|blink|calls|rate|volume|approval|target|hcp|bap|paid insured|kpi|samples?|dropped)\b/i.test(s);
}

export function looksLikeOverviewKpis(scenario: any, existingScript?: any): boolean {
  const labels = parseKpiLabels(scenario, existingScript, false);
  if (!labels.length) return false;
  const blob = labels.join(" ").toLowerCase();
  return /\b(nbrx|nrx|trx|writers|reach|frequency|blink|calls to target|my plan)\b/i.test(blob);
}

/**
 * Leftover numeric KPI tiles (Overview, Activity, or any KPI page).
 * Grid / chart / date use dedicated templates — never steal those.
 */
export function isKpiScenario(
  scenario: any,
  existingScript?: any,
  _isReferenceTarget = false,
): boolean {
  if (String(scenario?.type || "").toLowerCase() === "trend") return false;
  const blob = scenarioTextBlob(scenario).toLowerCase();

  // Refresh / as-of dates use date_refresh — never extractKPI.
  if (/\brefresh\s*dates?\b/.test(blob) || /\b(claims\s*me|call activity we)\b/.test(blob)) return false;
  if (/\b(as[\s-]?of\s*date|date\s*validat|date\s*labels?|data\s*as\s*of)\b/.test(blob)) return false;

  // Graphs / grids use Show Data — never KPI tile extract.
  if (/\bactivity\s*trend\b/.test(blob)) return false;
  if (/\b(show\s*data|chart\s*data|geography details|grid data|crosstab|graph|chart|plot)\b/.test(blob)) {
    return false;
  }
  if (/\bgrid\b/.test(blob) && !/\b(overview|kpi|tile|pass\s*value)/.test(blob)) return false;
  if (/\bperformance\s*trend\b/.test(blob) && !/\bkpi\b/.test(blob)) return false;

  const configured = parseKpiLabels(scenario, existingScript, false);
  if (configured.length) return true;

  if (/\boverview\b/.test(blob)) return true;
  if (/\b(kpi|pass\s*values?|kpi\s*tiles?|numeric\s*tiles?)\b/.test(blob)) return true;
  if (/\bactivity\b/.test(blob) && (looksLikeOverviewKpis(scenario, existingScript) || /\bkpi\b/.test(blob))) {
    return true;
  }
  return looksLikeOverviewKpis(scenario, existingScript);
}

/** @deprecated Use isKpiScenario — Overview and Activity share the KPI template. */
export function isOverviewScenario(
  scenario: any,
  existingScript?: any,
  isReferenceTarget = false,
): boolean {
  return isKpiScenario(scenario, existingScript, isReferenceTarget);
}

/** @deprecated Use isKpiScenario — Overview and Activity share the KPI template. */
export function isActivityKpiScenario(scenario: any, existingScript?: any): boolean {
  return isKpiScenario(scenario, existingScript);
}

export const isActivityScenario = isActivityKpiScenario;

/** Footer / left-nav steps only — never Weekly/Monthly/Quarterly (chart radios). */
export function parseKpiNavSteps(scenario: any, fallback: string[] = []): string[] {
  // Overview is the dossier landing page — do not click it as a tab.
  // Only real footer tabs. Comparison titles ("Overview vs Performance…", "Main Report") are not tabs.
  const steps = parseNavStepsFromScenario(scenario, { allowGeography: false })
    .map((s) => {
      const tab = String(s || "").match(/\b(activity|performance|geography)\b/i);
      if (tab && /navigat|after|before|vs\b/i.test(s)) return tab[1];
      return s;
    })
    .filter((s) => {
      if (/^load\b/i.test(s)) return false;
      if (/^(overview|summary|main)$/i.test(s)) return false;
      if (/^vs\b|\bafter\b|\bbefore\b|\bnavigat/i.test(s)) return false;
      if (/\boverview\b/i.test(s) && !/\b(activity|performance|geography|hcp)\b/i.test(s)) return false;
      return /^(activity|performance|geography)$/i.test(s);
    });
  if (steps.length) {
    __dbgKpiNav(scenario, steps);
    return steps;
  }
  __dbgKpiNav(scenario, fallback);
  return [...fallback];
}

// #region agent log
function __dbgKpiNav(scenario: any, steps: string[]) {
  fetch("http://127.0.0.1:7671/ingest/98652cf2-faf9-416e-8061-9c498534608d", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "427fbc" }, body: JSON.stringify({ sessionId: "427fbc", runId: "kpi-fail", hypothesisId: "A", location: "mstr-overview-template.ts:parseKpiNavSteps", message: "parsed KPI nav steps", data: { title: String(scenario?.title || "").slice(0, 160), reportName: String(scenario?.reports?.name || "").slice(0, 160), descHead: String(scenario?.description || "").slice(0, 240), steps }, timestamp: Date.now() }) }).catch(() => {});
}
// #endregion

function labelsFromScenarioText(scenario: any): string[] {
  const title = String(scenario?.title || "");
  const desc = String(scenario?.description || "");
  const blob = `${title}\n${desc}`;
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const s = String(raw || "").trim();
    if (!s || seen.has(s.toLowerCase()) || looksLikeDateKpiNoise(s)) return;
    seen.add(s.toLowerCase());
    out.push(s);
  };
  // 1. Exact match against default KPI labels
  for (const def of DEFAULT_OVERVIEW_KPIS) {
    const re = new RegExp(def.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(blob)) add(def);
  }
  // 2. Quoted strings — curly quotes AND straight quotes
  for (const m of blob.matchAll(/[““”’‘’]([^”“”’‘’]{2,80})[““”’‘’]/g)) {
    if (looksLikeUserKpiLabel(m[1])) add(m[1].trim());
  }
  // 3. Per-line scan (bullet lists, plain lines)
  for (const line of desc.split(/\r?\n/)) {
    const t = line.replace(/^[-*•\d.)\s]+/, "").trim().replace(/^["']|["']$/g, "");
    if (t && looksLikeUserKpiLabel(t)) add(t);
    // 3b. Comma-separated KPI labels within a line
    if (/,/.test(t)) {
      for (const seg of t.split(/,/)) {
        const s = seg.trim().replace(/^["']|["']$/g, "");
        if (s && s.length <= 50 && looksLikeUserKpiLabel(s)) add(s);
      }
    }
  }
  // 4. Extract KPI-like noun phrases from within sentences.
  //    Matches patterns like "capture the displayed Blink TRx value" → "Blink TRx"
  if (!out.length) {
    const verbRe = /(?:capture|extract|check|scrape|fetch|read|compare|verify|validate|match|displayed|showing|shows?)\s+(?:the\s+)?(?:displayed\s+|corresponding\s+|current\s+|expected\s+)?([A-Z][A-Za-z\s/()%]{1,50}?)\s+(?:values?|figures?|numbers?|metrics?|kpis?|tiles?|data\b)/gi;
    for (const m of blob.matchAll(verbRe)) {
      const candidate = m[1].trim();
      if (candidate && looksLikeUserKpiLabel(candidate)) add(candidate);
    }
  }
  // 5. Sliding window: scan for 1–4 word phrases containing KPI keywords
  if (!out.length) {
    const words = blob.split(/\s+/).map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9%()]+$/g, "")).filter(Boolean);
    for (let len = 4; len >= 1; len--) {
      for (let i = 0; i <= words.length - len; i++) {
        const phrase = words.slice(i, i + len).join(" ");
        if (phrase.length > 50) continue;
        if (looksLikeUserKpiLabel(phrase)) add(phrase);
      }
    }
  }
  return out;
}

/** User-configured KPI labels only. Never inject the 18 default Overview KPIs unless useDefault=true. */
export function parseKpiLabels(scenario: any, existingScript?: any, useDefault = false): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: any) => {
    const s = typeof raw === "string"
      ? raw.trim()
      : String(raw?.label || raw?.name || raw?.kpi || "").trim();
    if (!s || seen.has(s.toLowerCase()) || looksLikeDateKpiNoise(s)) return;
    seen.add(s.toLowerCase());
    out.push(s);
  };
  const spec = existingScript?.assertion_spec;
  if (Array.isArray(spec?.kpis)) spec.kpis.forEach(add);
  else if (spec?.kpis && typeof spec.kpis === "object") Object.keys(spec.kpis).forEach(add);
  if (spec?.kpi_tolerances && typeof spec.kpi_tolerances === "object") {
    Object.keys(spec.kpi_tolerances).forEach(add);
  }
  const cfg = scenario?.reports?.kpi_config;
  if (Array.isArray(cfg)) cfg.forEach(add);
  else if (cfg && typeof cfg === "object") {
    if (Array.isArray(cfg.kpis)) cfg.kpis.forEach(add);
    else if (Array.isArray(cfg.labels)) cfg.labels.forEach(add);
    else Object.keys(cfg).forEach(add);
  }
  if (out.length) return out;
  const fromText = labelsFromScenarioText(scenario);
  if (fromText.length) return fromText;
  return useDefault ? [...DEFAULT_OVERVIEW_KPIS] : [];
}

export function assembleKpiScript(opts: {
  reportUrl: string;
  kpiLabels: string[];
  /** Optional tab navigation before KPI scrape (e.g. Activity). Empty = stay on landing page. */
  navSteps?: string[];
}): string {
  const reportUrl = normalizeReportUrl(opts.reportUrl);
  const labels = (opts.kpiLabels || []).filter((k) => typeof k === "string" && k.trim());
  const navSteps = (opts.navSteps || []).filter((s) => typeof s === "string" && s.trim() && !/^(weekly|monthly|quarterly)$/i.test(s));
  const urlLit = JSON.stringify(reportUrl);
  const kpiLit = JSON.stringify(labels, null, 4).replace(/\n/g, "\n    ");
  const navLit = JSON.stringify(navSteps);
  // #region agent log
  fetch("http://127.0.0.1:7671/ingest/98652cf2-faf9-416e-8061-9c498534608d", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "427fbc" }, body: JSON.stringify({ sessionId: "427fbc", runId: "kpi-fail", hypothesisId: "B", location: "mstr-overview-template.ts:assembleKpiScript", message: "assembled KPI script slots", data: { urlTail: reportUrl.slice(-48), kpiLabels: labels, navSteps, navLit }, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
  const emptyLabelsNote = labels.length
    ? ""
    : "\n  // KPI_LABELS empty — set labels via Add/Remove KPIs or assertion_spec. Generate validation should fail until then.\n";

  return `/**
 * RTB skill template: KPI tiles (extractKPI).
 * Filled from UI: report URL, KPI_LABELS (user-configured only), optional NAV_STEPS.
 * Filters come from runtime __filterCombinations (never hardcode Area/Region values).
 * Runtime: Browserless /chromium/function — export default async ({ page }) => { ... }
 */
export default async ({ page }) => {

  // === AUTO-INJECTED SESSION-AWARE AUTH CHECK (do not remove) ===
  const __sleep = ms => new Promise(r => setTimeout(r, ms));
  const __reportUrl = ${urlLit};
  const __tryWidenViewport = async () => {
    try { if (typeof page.setViewport === 'function') await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 }); } catch (_) {}
    try { if (typeof page.setViewportSize === 'function') await page.setViewportSize({ width: 1920, height: 1080 }); } catch (_) {}
    try {
      await page.evaluate(() => {
        document.documentElement.style.zoom = '100%';
        if (document.body) document.body.style.zoom = '100%';
      });
    } catch (_) {}
  };
  await __tryWidenViewport();
  const __detectLoginForm = () => page.evaluate(() => {
    const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const hasUserField = !!document.querySelector(
      'input[placeholder*="user name" i], input[name*="user" i], input[id*="user" i], #Uid'
    );
    const hasPwdField = !!document.querySelector('input[type="password"], #Pwd');
    const hasLoginBtn = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"], a'))
      .some(el => /log ?in/.test(norm(el.innerText || el.value || '')));
    return hasUserField || hasPwdField || hasLoginBtn;
  }).catch(() => false);
  await page.goto(__reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await __sleep(2000);
  let __hasLoginForm = await __detectLoginForm();
  if (__hasLoginForm && typeof __creds !== 'undefined' && __creds && __creds.username) {
    const __onLoginPage = await page.evaluate(() => /\\/auth\\/ui\\/loginPage/i.test(location.href)).catch(() => false);
    if (!__onLoginPage && __creds.loginUrl) {
      await page.goto(__creds.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await __sleep(1000);
    }
    const __userSel = '#Uid, input[placeholder*="user name" i], input[name*="user" i], input[id*="user" i], input[type="text"]';
    const __pwdSel  = '#Pwd, input[type="password"], input[placeholder*="password" i]';
    await page.type(__userSel, __creds.username).catch(() => {});
    await page.type(__pwdSel, __creds.password).catch(() => {});
    await page.evaluate((pSel) => {
      const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const cands = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"], a'));
      let btn = cands.find(el => norm(el.innerText || el.value || '') === 'log in with credentials');
      if (!btn) btn = cands.find(el => /log ?in/.test(norm(el.innerText || el.value || '')));
      if (btn) { btn.click(); return true; }
      const pwd = document.querySelector(pSel);
      const form = pwd && pwd.closest('form');
      if (form) { (form.requestSubmit ? form.requestSubmit() : form.submit()); return true; }
      return false;
    }, __pwdSel).catch(() => {});
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
      __sleep(3000),
    ]);
    await __sleep(1500);
    const __loginFailed = await page.evaluate(() =>
      /login\\s*failure|error\\s*in\\s*login|invalid (user|credentials|password)|incorrect (user|password)/i.test(document.body.innerText || '')
    ).catch(() => false);
    if (__loginFailed) {
      return { ok: false, error: 'LOGIN_FAILED', message: 'Credentials rejected by the report login page' };
    }
    await page.goto(__reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await __sleep(2000);
    __hasLoginForm = await __detectLoginForm();
    if (__hasLoginForm) {
      return { ok: false, error: 'LOGIN_FAILED', message: 'Still on login page after submitting credentials' };
    }
    await __tryWidenViewport();
  } else if (__hasLoginForm) {
    return { ok: false, error: 'AUTH_REQUIRED', message: 'Login form present but no credentials provided' };
  }
  // === END AUTO-INJECTED AUTH CHECK ===

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const tryWidenViewport = async () => {
    try { if (typeof page.setViewport === 'function') await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 }); } catch (_) {}
    try { if (typeof page.setViewportSize === 'function') await page.setViewportSize({ width: 1920, height: 1080 }); } catch (_) {}
    try {
      await page.evaluate(() => {
        document.documentElement.style.zoom = '100%';
        if (document.body) document.body.style.zoom = '100%';
      });
    } catch (_) {}
  };
  await tryWidenViewport();

  const reportUrl = ${urlLit};

  const waitForLoadingToFinish = async (maxMs = 20000) => {
    const start = Date.now();
    await sleep(400);
    const isLoading = () => page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText : '';
      if (/Loading\\s*Data/i.test(bodyText)) {
        for (const el of Array.from(document.querySelectorAll('*'))) {
          let direct = '';
          for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) direct += n.textContent;
          if (!/Loading\\s*Data/i.test(direct)) continue;
          const r = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none')
            return true;
        }
      }
      const spin = document.querySelector(
        '.mstrmojo-WaitBox, .mstrmojo-Wait, .mstrWaitBox, [class*="WaitBox" i], [class*="loading" i][class*="overlay" i]'
      );
      if (spin) {
        const r = spin.getBoundingClientRect();
        const st = window.getComputedStyle(spin);
        if (r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none')
          return true;
      }
      return false;
    }).catch(() => false);
    while (Date.now() - start < maxMs) {
      const loading = await isLoading();
      if (!loading) {
        await sleep(800);
        if (!(await isLoading())) return;
      }
      await sleep(400);
    }
  };

  // Ready BEFORE tab nav: filter chrome / footer tabs. Never wait for KPI tiles here —
  // those only exist on the target screen (Overview/Activity), not login or Performance.
  const waitForDossierReady = async (maxMs = 25000) => {
    await waitForLoadingToFinish(Math.min(maxMs, 15000));
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const found = await page.evaluate(() => {
        const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const isVisible = el => {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return false;
          const st = getComputedStyle(el);
          return st.visibility !== 'hidden' && st.display !== 'none';
        };
        if (document.querySelector('input[type="password"], #Pwd')) return false;
        if (document.querySelector('.mstrmojo-DocSelector, [class*="DocSelector"], [class*="FilterPanel" i]')) return true;
        for (const el of Array.from(document.querySelectorAll('label, span, div, td, th, button, a, [role="tab"]'))) {
          if (!isVisible(el)) continue;
          let t = '';
          for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
          const nrm = norm(t);
          if (nrm === 'area' || nrm === 'overview' || nrm === 'performance') return true;
        }
        return false;
      }).catch(() => false);
      if (found) {
        await waitForLoadingToFinish(8000);
        return true;
      }
      await sleep(600);
    }
    return false;
  };

  // Ready AFTER tab nav: a KPI label on THIS screen (not hardcoded Overview "NBRx Total").
  // One call after nav and one before scrape — never after every filter pick.
  const waitForDashboard = async (maxMs = 15000) => {
    await waitForLoadingToFinish(Math.min(maxMs, 15000));
    const markers = (typeof KPI_LABELS !== 'undefined' && Array.isArray(KPI_LABELS)) ? KPI_LABELS : [];
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const found = await page.evaluate((labels) => {
        function getDirectText(el) {
          let text = '';
          for (const node of el.childNodes)
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
          return text.trim();
        }
        const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const want = (labels || []).map(s => norm(s)).filter(Boolean);
        if (!want.length) return !!document.querySelector('.mstrmojo-DocSelector, [class*="DocSelector"], [class*="FilterPanel" i]');
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const t = norm(getDirectText(el));
          if (t && want.includes(t)) return true;
        }
        return false;
      }, markers).catch(() => false);
      if (found) break;
      await sleep(500);
    }
    await waitForLoadingToFinish(5000);
  };

  const closeAnyOpenDropdown = async () => {
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', bubbles: true }));
      const x = 5, y = Math.max(5, window.innerHeight - 5);
      const opts = { bubbles: true, clientX: x, clientY: y };
      document.body.dispatchEvent(new MouseEvent('mousedown', opts));
      document.body.dispatchEvent(new MouseEvent('mouseup',   opts));
      document.body.dispatchEvent(new MouseEvent('click',     opts));
    }).catch(() => {});
    await sleep(300);
  };

  const selectByLabel = async (labelText, optionText) => {
    await closeAnyOpenDropdown();
    const result = await page.evaluate((label, opt) => {
      function getDirectText(el) {
        let t = '';
        for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
        return t.trim();
      }
      const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const extractCode = v => norm(v).split(/\\s+/)[0].trim();
      const optCode = extractCode(opt);
      const normOpt = norm(opt);
      const isVisible = el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none';
      };
      let labelEl = null, labelArea = Infinity;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (!isVisible(el)) continue;
        if (norm(getDirectText(el)) !== norm(label)) continue;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area < labelArea) { labelEl = el; labelArea = area; }
      }
      if (!labelEl) return { error: 'Label not found: ' + label };
      const lr = labelEl.getBoundingClientRect();

      let bestSelect = null, bestDist = Infinity;
      for (const s of Array.from(document.querySelectorAll('select'))) {
        if (!isVisible(s)) continue;
        const r = s.getBoundingClientRect();
        const dist = Math.abs(r.top - lr.top) + Math.abs(r.left - lr.left);
        if (dist < 200 && dist < bestDist) { bestSelect = s; bestDist = dist; }
      }
      if (bestSelect) {
        const options = Array.from(bestSelect.options);
        let m = options.find(o => extractCode(o.textContent) === optCode)
             || options.find(o => norm(o.textContent) === normOpt)
             || options.find(o => norm(o.textContent).startsWith(normOpt) || normOpt.startsWith(norm(o.textContent)));
        if (m) {
          bestSelect.value = m.value;
          bestSelect.dispatchEvent(new Event('input',  { bubbles: true }));
          bestSelect.dispatchEvent(new Event('change', { bubbles: true }));
          return { clicked: true, via: 'native-select', option: m.textContent.trim() };
        }
      }

      const legacy = Array.from(document.querySelectorAll('.mstrmojo-DocSelector'));
      if (legacy.length) {
        const withCode = [], withoutCode = [];
        for (const sel of legacy) {
          const r = sel.getBoundingClientRect();
          if (Math.abs(r.top - lr.top) > 40) continue;
          if (r.left < lr.left - 10) continue;
          const dist = Math.abs(r.left - lr.left);
          let hasCode = false;
          for (const c of Array.from(sel.querySelectorAll('*')))
            if (extractCode(getDirectText(c)) === optCode) { hasCode = true; break; }
          (hasCode ? withCode : withoutCode).push({ sel, dist });
        }
        withCode.sort((a, b) => a.dist - b.dist);
        withoutCode.sort((a, b) => a.dist - b.dist);
        const best = withCode[0]?.sel || withoutCode[0]?.sel;
        if (best) {
          for (const c of Array.from(best.querySelectorAll('*'))) {
            const d = getDirectText(c);
            if (!d || d.length < 2) continue;
            if (extractCode(d) === optCode) { c.click(); return { clicked: true, via: 'legacy-selector', option: d }; }
          }
        }
      }

      let valueEl = null, valueDist = Infinity;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (!isVisible(el)) continue;
        const d = getDirectText(el);
        if (!d || norm(d) === norm(label)) continue;
        const r = el.getBoundingClientRect();
        if (r.top < lr.top - 2) continue;
        if (r.top - lr.top > 60) continue;
        const dx = Math.abs(r.left - lr.left);
        if (dx > 250) continue;
        const dist = (r.top - lr.top) + dx;
        if (dist < valueDist) { valueDist = dist; valueEl = el; }
      }
      if (valueEl) { valueEl.click(); return { opened: true, via: 'click-current-value', clickedText: getDirectText(valueEl) }; }

      const nearby = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (!isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (Math.abs(r.top - lr.top) > 80 || Math.abs(r.left - lr.left) > 300) continue;
        const t = getDirectText(el);
        if (!t) continue;
        nearby.push({ tag: el.tagName, cls: (el.className || '').toString().substring(0, 60), text: t.substring(0, 40) });
        if (nearby.length >= 8) break;
      }
      return { error: 'No selector or clickable value found near: ' + label, nearby };
    }, labelText, optionText).catch(() => ({ error: 'evaluate failed for ' + labelText }));

    if (result.clicked) {
      await closeAnyOpenDropdown();
      await waitForLoadingToFinish(15000);
      return { ok: true, ...result };
    }

    if (result.opened) {
      await sleep(400);
      const picked = await page.evaluate((opt) => {
        const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const optCode = norm(opt).split(/\\s+/)[0];
        const normOpt = norm(opt);
        const isVisible = el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const st = getComputedStyle(el);
          return st.visibility !== 'hidden' && st.display !== 'none';
        };
        const cands = Array.from(document.querySelectorAll(
          'li, [role="option"], [role="menuitem"], [role="listbox"] *, ul *, div, span, td'
        ));
        let exact = null, codeMatch = null, contains = null;
        for (const el of cands) {
          if (!isVisible(el)) continue;
          const t = norm(el.innerText || el.textContent || '');
          if (!t || t.length > 60) continue;
          if (t === normOpt && !exact) exact = el;
          else if (t.split(/\\s+/)[0] === optCode && !codeMatch) codeMatch = el;
          else if (t.includes(normOpt) && !contains) contains = el;
        }
        const best = exact || codeMatch || contains;
        if (best) { best.click(); return { clicked: true, text: (best.innerText || best.textContent || '').trim().substring(0, 60) }; }
        return null;
      }, optionText).catch(() => null);
      if (picked && picked.clicked) {
        await closeAnyOpenDropdown();
        await waitForLoadingToFinish(15000);
        return { ok: true, via: 'opened-then-picked', ...picked };
      }
      return { ok: false, error: 'Opened dropdown for ' + labelText + ' but option not found: ' + optionText, clickedTo: result.clickedText };
    }

    return { ok: false, ...result };
  };

  const extractKPI = async (labelText) => {
    return await page.evaluate((label) => {
      function getDirectText(el) {
        let text = '';
        for (const node of el.childNodes)
          if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        return text.trim();
      }
      function hasElementChildren(el) {
        for (const node of el.childNodes)
          if (node.nodeType === Node.ELEMENT_NODE) return true;
        return false;
      }
      const norm = s => s.replace(/\\s+/g, ' ').trim().toLowerCase();
      const target = norm(label);
      const labelMatches = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const direct = getDirectText(el);
        if (!direct || norm(direct) !== target) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        labelMatches.push({ el, r, area: r.width * r.height });
      }
      if (!labelMatches.length) return { error: 'Label not found: ' + label };
      labelMatches.sort((a, b) => a.area - b.area);
      const numRe = /^\\s*[$]?\\s*-?[\\d,]+(\\.\\d+)?\\s*%?\\s*$/;
      for (const { r: lr } of labelMatches) {
        const labelCx = lr.left + lr.width / 2;
        const maxDx = Math.max(80, lr.width / 2 + 40);
        const candidates = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          if (hasElementChildren(el)) continue;
          const direct = getDirectText(el);
          if (!numRe.test(direct)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.top < lr.top + lr.height - 2) continue;
          if (r.top > lr.top + 120) continue;
          const cx = r.left + r.width / 2;
          if (Math.abs(cx - labelCx) > maxDx) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
          candidates.push({ text: direct.trim(), fs, dx: Math.abs(cx - labelCx), dy: r.top - lr.top });
        }
        if (!candidates.length) continue;
        candidates.sort((a, b) => (b.fs - a.fs) || (a.dx - b.dx) || (a.dy - b.dy));
        return { value: candidates[0].text };
      }
      return { error: 'No value found near label: ' + label };
    }, labelText).catch(() => ({ error: 'evaluate failed' }));
  };

  const NAV_STEPS = ${navLit};
  const NAV_OPENERS = ['Menu', 'Navigation', 'More', 'Open menu', 'Main menu', '☰'];
  const navDebug = [];

  const clickByText = async (step, opts = {}) => {
    const openers = (opts && opts.openers) || NAV_OPENERS;
    const tryClick = async () => page.evaluate((label) => {
      const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const want = norm(label);
      const isVisible = el => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none';
      };
      const nodes = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"], span, div, li'));
      let best = null, bestArea = Infinity;
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const t = norm(el.innerText || el.textContent || '');
        if (t !== want && !(t.length <= want.length + 16 && t.includes(want))) continue;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area < bestArea && area < 80000) { best = el; bestArea = area; }
      }
      if (!best) return { error: 'not found: ' + label };
      best.click();
      return { clicked: true, text: (best.innerText || '').trim().slice(0, 60) };
    }, step).catch(() => ({ error: 'evaluate failed' }));
    let res = await tryClick();
    if (res && res.error) {
      for (const op of openers) {
        await page.evaluate((label) => {
          const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          const want = norm(label);
          for (const el of Array.from(document.querySelectorAll('button, [role="button"], span, div'))) {
            const t = norm(el.innerText || el.textContent || '');
            if (t === want || t === '\\u2630') { el.click(); return true; }
          }
          return false;
        }, op).catch(() => false);
        await sleep(400);
        res = await tryClick();
        if (res && !res.error) break;
      }
    }
    await waitForLoadingToFinish(15000);
    return res;
  };

  const runNav = async () => {
    for (const step of NAV_STEPS) {
      const r = await clickByText(step, { openers: NAV_OPENERS });
      navDebug.push({ step, ...r });
      if (r && r.error) break;
    }
  };

  const KPI_LABELS = ${kpiLit};${emptyLabelsNote}
  const toNum = v => (v == null ? null : parseFloat(String(v).replace(/[^0-9.\\-]/g, '')));

  const filterCombinations = (typeof __filterCombinations !== 'undefined' && Array.isArray(__filterCombinations) && __filterCombinations.length > 0)
    ? __filterCombinations : [];

  await waitForDossierReady();
  await runNav();
  await waitForDashboard();

  if (filterCombinations.length === 0) {
    const out = { navigation: navDebug };
    for (const k of KPI_LABELS) {
      const raw = await extractKPI(k);
      out[k] = toNum(raw && raw.value);
    }
    return out;
  }

  const results = {};
  for (let i = 0; i < filterCombinations.length; i++) {
    const { label = String(i), filters = {} } = filterCombinations[i];
    if (i > 0) {
      await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await waitForDossierReady();
      await runNav();
      await waitForDashboard();
    }

    const debug = {};
    const GEO_ORDER = ['Area', 'Region', 'Territory'];
    const allKeys = Object.keys(filters);
    const geoKeys = GEO_ORDER.filter(k => allKeys.includes(k));
    const otherKeys = allKeys.filter(k => !GEO_ORDER.includes(k));
    for (const key of geoKeys) {
      debug[key] = await selectByLabel(key, filters[key]);
    }
    for (const key of otherKeys) {
      debug[key] = await selectByLabel(key, filters[key]);
    }
    await closeAnyOpenDropdown();
    await waitForLoadingToFinish(15000);
    await waitForDashboard();

    const row = { filters_applied: debug };
    for (const k of KPI_LABELS) {
      const raw = await extractKPI(k);
      row[k] = toNum(raw && raw.value);
    }
    results[label] = row;
  }
  return { navigation: navDebug, results };
};
`;
}

/** @deprecated Use assembleKpiScript — same KPI template. */
export const assembleOverviewScript = assembleKpiScript;
