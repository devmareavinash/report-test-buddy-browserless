/**
 * REFERENCE: Proven Browserless open-source script for MSTR Overview KPI + filters.
 * Used as gold-standard training for the LLM agent (runtime=browserless).
 *
 * Runtime contract:
 * - Browserless entry: async ({ page, context }) => { ... }
 * - Pass reportUrl, creds, filterCombinations in POST context (or process.env.REPORT_URL)
 * - POST to http://localhost:3000/function with { code, context? }
 *
 * NOTE: This reference retains Puppeteer-compatible page APIs (page.type, page.waitForNavigation,
 * multi-arg page.evaluate) as supported by Browserless /function.
 */
export default async ({ page, context }) => {

  // === AUTO-INJECTED SESSION-AWARE AUTH CHECK (do not remove) ===
  const __creds = (context && context.creds) ? context.creds : (typeof __creds !== 'undefined' ? __creds : undefined);
  const __sleep = ms => new Promise(r => setTimeout(r, ms));
  const __reportUrl = String((context && context.reportUrl) || process.env.REPORT_URL || '').trim();
  const __tryWidenViewport = async () => {
    try { if (typeof page.setViewport === 'function') await page.setViewport({ width: 1440, height: 900 }); } catch (_) {}
    try { if (typeof page.setViewportSize === 'function') await page.setViewportSize({ width: 1440, height: 900 }); } catch (_) {}
  };
  await __tryWidenViewport();
  if (!__reportUrl) {
    return { ok: false, error: 'REPORT_URL_REQUIRED', message: 'Pass context.reportUrl in POST body or set process.env.REPORT_URL' };
  }
  const __detectLoginForm = () => page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const hasUserField = !!document.querySelector(
      'input[placeholder*="user name" i], input[name*="user" i], input[id*="user" i], #Uid'
    );
    const hasPwdField = !!document.querySelector('input[type="password"], #Pwd');
    const hasLoginBtn = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"], a'))
      .some(el => /log ?in/.test(norm(el.innerText || el.value || '')));
    return hasUserField || hasPwdField || hasLoginBtn;
  }).catch(() => false);
  try {
    await page.goto(__reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    return { ok: false, error: 'NAVIGATION_FAILED', message: String(e && e.message || e), reportUrl: __reportUrl };
  }
  const __navUrl = typeof page.url === 'function' ? page.url() : '';
  if (!__navUrl || __navUrl === 'about:blank') {
    return { ok: false, error: 'NAVIGATION_FAILED', message: 'page.goto did not leave about:blank', reportUrl: __reportUrl };
  }
  await __sleep(2000);
  let __hasLoginForm = await __detectLoginForm();
  if (__hasLoginForm && typeof __creds !== 'undefined' && __creds && __creds.username) {
    const __onLoginPage = await page.evaluate(() => /\/auth\/ui\/loginPage/i.test(location.href)).catch(() => false);
    if (!__onLoginPage && __creds.loginUrl) {
      await page.goto(__creds.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await __sleep(1000);
    }
    const __userSel = '#Uid, input[placeholder*="user name" i], input[name*="user" i], input[id*="user" i], input[type="text"]';
    const __pwdSel  = '#Pwd, input[type="password"], input[placeholder*="password" i]';
    await page.type(__userSel, __creds.username).catch(() => {});
    await page.type(__pwdSel, __creds.password).catch(() => {});
    await page.evaluate((pSel) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
      /login\s*failure|error\s*in\s*login|invalid (user|credentials|password)|incorrect (user|password)/i.test(document.body.innerText || '')
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
  const reportUrl = __reportUrl;

  const waitForLoadingToFinish = async (maxMs = 45000) => {
    const start = Date.now();
    await sleep(400);
    const isLoading = () => page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText : '';
      if (/Loading\s*Data/i.test(bodyText)) {
        for (const el of Array.from(document.querySelectorAll('*'))) {
          let direct = '';
          for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) direct += n.textContent;
          if (!/Loading\s*Data/i.test(direct)) continue;
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

  const waitForDossierReady = async (maxMs = 45000) => {
    await waitForLoadingToFinish(Math.min(maxMs, 25000));
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const found = await page.evaluate(() => {
        const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
        await waitForLoadingToFinish(15000);
        return true;
      }
      await sleep(600);
    }
    return false;
  };

  const waitForDashboard = async (maxMs = 20000) => {
    await waitForLoadingToFinish(maxMs);
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
        const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
    await waitForLoadingToFinish(maxMs);
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
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const extractCode = v => norm(v).split(/\s+/)[0].trim();
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
      return { error: 'No selector found near: ' + label };
    }, labelText, optionText).catch(() => ({ error: 'evaluate failed for ' + labelText }));
    if (result.clicked) {
      await closeAnyOpenDropdown();
      await waitForLoadingToFinish();
      await waitForDashboard();
      return { ok: true, ...result };
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
      const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const target = norm(label);
      const numRe = /^\s*[$]?\s*-?[\d,]+(\.\d+)?\s*%?\s*$/;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const direct = getDirectText(el);
        if (!direct || norm(direct) !== target) continue;
        const lr = el.getBoundingClientRect();
        if (lr.width === 0 || lr.height === 0) continue;
        for (const vEl of Array.from(document.querySelectorAll('*'))) {
          const vt = getDirectText(vEl);
          if (!numRe.test(vt)) continue;
          const r = vEl.getBoundingClientRect();
          if (r.top >= lr.top && r.top <= lr.top + 120) return { value: vt.trim() };
        }
      }
      return { error: 'Label not found: ' + label };
    }, labelText).catch(() => ({ error: 'evaluate failed' }));
  };

  const clickByText = async (text, { openers } = {}) => {
    const res = await page.evaluate((label) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const target = norm(label);
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const t = norm(el.innerText || el.textContent || '');
        if (t === target) { el.click(); return { clicked: true, text: label }; }
      }
      return { error: 'navigation target not found: ' + label };
    }, text).catch(() => ({ error: 'evaluate failed: ' + text }));
    await waitForLoadingToFinish();
    return res;
  };

  const NAV_STEPS = ['Overview'];
  const NAV_OPENERS = ['Menu', 'Navigation', 'More', 'Open menu', 'Main menu', '\u2630'];
  const KPI_LABELS = ['NRx Total', 'Total Writers', 'Target Writers %'];
  const toNum = v => (v == null ? null : parseFloat(String(v).replace(/[^0-9.\-]/g, '')));
  const navDebug = [];
  await waitForDossierReady();
  for (const step of NAV_STEPS) {
    const r = await clickByText(step, { openers: NAV_OPENERS });
    navDebug.push({ step, ...r });
    if (r && r.error) break;
  }
  await waitForDashboard();

  const filterCombinations = (context && Array.isArray(context.filterCombinations) && context.filterCombinations.length > 0)
    ? context.filterCombinations
    : ((typeof __filterCombinations !== 'undefined' && Array.isArray(__filterCombinations) && __filterCombinations.length > 0)
    ? __filterCombinations : []);

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
      for (const step of NAV_STEPS) {
        await clickByText(step, { openers: NAV_OPENERS });
      }
      await waitForDashboard();
    }
    const debug = {};
    const GEO_ORDER = ['Area', 'Region', 'Territory', 'Time Bucket'];
    const allKeys = Object.keys(filters);
    const geoKeys = GEO_ORDER.filter(k => allKeys.includes(k));
    const otherKeys = allKeys.filter(k => !GEO_ORDER.includes(k));
    for (const key of geoKeys) debug[key] = await selectByLabel(key, filters[key]);
    for (const key of otherKeys) debug[key] = await selectByLabel(key, filters[key]);
    await closeAnyOpenDropdown();
    const row = { filters_applied: debug };
    for (const k of KPI_LABELS) {
      const raw = await extractKPI(k);
      row[k] = toNum(raw && raw.value);
    }
    results[label] = row;
  }
  return { navigation: navDebug, ...results };
};
