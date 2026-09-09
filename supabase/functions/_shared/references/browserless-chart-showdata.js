/**
 * REFERENCE: Proven Browserless open-source script for MSTR chart/trend Show Data extraction.
 * Used as gold-standard training for the LLM agent (runtime=browserless).
 *
 * Runtime contract:
 * - Browserless entry: async ({ page }) => { ... }
 * - Injected globals: __creds, __filterCombinations
 * - Report URL: filled by RTB assemble (Browserless has no Node process.env)
 * - POST to http://localhost:3000/chromium/function with { code, context? }
 *
 * Chart extraction flow:
 * - Navigate NAV_STEPS (Performance footer, then Activity page tab), record navDebug
 * - Apply TIME_GRAIN (Weekly/Monthly/Quarterly) after tabs, then filters, then Show Data
 * - Return { navigation: navDebug, results } and copy navigation onto each combo row
 * - openShowData(chartTitle + title variants) → waitForShowDataPopup → extractShowDataTable
 * - NEVER scrape canvas/SVG — always use Show Data popup table extraction
 *
 * NOTE: This reference retains Puppeteer-compatible page APIs (page.type, page.waitForNavigation,
 * multi-arg page.evaluate) as supported by Browserless /function.
 */
export default async ({ page }) => {

  // === AUTO-INJECTED SESSION-AWARE AUTH CHECK (do not remove) ===
  const __sleep = ms => new Promise(r => setTimeout(r, ms));
  const __reportUrl = "";
  const __tryWidenViewport = async () => {
    try { if (typeof page.setViewport === 'function') await page.setViewport({ width: 1440, height: 900 }); } catch (_) {}
    try { if (typeof page.setViewportSize === 'function') await page.setViewportSize({ width: 1440, height: 900 }); } catch (_) {}
  };
  await __tryWidenViewport();
  if (!__reportUrl) {
    return { ok: false, error: 'REPORT_URL_REQUIRED', message: 'Report URL missing — regenerate script from RTB' };
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
  await page.goto(__reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
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


  const waitForLoadingToFinish = async (maxMs = 25000) => {
    const start = Date.now();
    await sleep(300);
    const isLoading = () => page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText : '';
      if (/Loading\s*Data/i.test(bodyText)) {
        for (const el of Array.from(document.querySelectorAll('*'))) {
          let direct = '';
          for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) direct += n.textContent;
          if (!/Loading\s*Data/i.test(direct)) continue;
          const r = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none') return true;
        }
      }
      const spin = document.querySelector('.mstrmojo-WaitBox, .mstrmojo-Wait, .mstrWaitBox, [class*="WaitBox" i]');
      if (spin) {
        const r = spin.getBoundingClientRect();
        const st = window.getComputedStyle(spin);
        if (r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none') return true;
      }
      return false;
    }).catch(() => false);
    while (Date.now() - start < maxMs) {
      const loading = await isLoading();
      if (!loading) { await sleep(400); if (!(await isLoading())) return; }
      await sleep(300);
    }
  };

  const waitForDashboard = async (maxMs = 15000) => {
    await waitForLoadingToFinish(maxMs);
    const CHART_WAIT_TITLE = 'Overall Performance';
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      let found = false;
      for (const frame of page.frames()) {
        try {
          const ok = await frame.evaluate((titleText) => {
            function getDirectText(el) {
              let text = '';
              for (const node of el.childNodes)
                if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
              return text.trim();
            }
            const target = titleText.toLowerCase();
            return Array.from(document.querySelectorAll('*'))
              .some(el => getDirectText(el).toLowerCase().includes(target));
          }, CHART_WAIT_TITLE);
          if (ok) { found = true; break; }
        } catch (_) {}
      }
      if (found) break;
      await sleep(500);
    }
    await waitForLoadingToFinish(maxMs);
  };

  // Ready BEFORE Performance nav: filter chrome / Area must exist.
  // Do not wait for chart title here — that only appears after the Performance tab.
  const waitForDossierReady = async (maxMs = 45000) => {
    await waitForLoadingToFinish(Math.min(maxMs, 25000));
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      for (const frame of page.frames()) {
        try {
          const ok = await frame.evaluate(() => {
            const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const isVisible = el => {
              const r = el.getBoundingClientRect();
              if (r.width < 1 || r.height < 1) return false;
              const st = getComputedStyle(el);
              return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
            };
            if (document.querySelector('.mstrmojo-DocSelector, [class*="DocSelector"], [class*="FilterPanel" i]')) return true;
            for (const el of Array.from(document.querySelectorAll('label, span, div, td, th'))) {
              if (!isVisible(el)) continue;
              let t = '';
              for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
              if (norm(t) === 'area') return true;
            }
            return false;
          });
          if (ok) {
            await waitForLoadingToFinish(15000);
            return true;
          }
        } catch (_) {}
      }
      await sleep(600);
    }
    return false;
  };

  const evalAcrossFrames = async (fn, arg) => {
    let lastErr = { error: 'not found in any accessible frame' };
    for (const frame of page.frames()) {
      try {
        const result = await frame.evaluate(fn, arg);
        if (result && !result.error) return { frame, result };
        if (result && result.error) lastErr = result;
      } catch (_) {}
    }
    return { frame: null, result: lastErr };
  };

  const evalInFrame = async (frame, fn, arg) => {
    try { return await frame.evaluate(fn, arg); } catch (e) { return { error: String(e && e.message || e) }; }
  };

  let cachedDossierFrame = null;

  const dismissGenericErrorDialog = async () => {
    const tryDismiss = () => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const isVisible = el => {
        try {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return false;
          const st = getComputedStyle(el);
          return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
        } catch (_) { return false; }
      };
      // Prefer explicit MSTR error dialogs ("An error has occurred…") then any OK in a dialog.
      const dialogs = Array.from(document.querySelectorAll(
        '[role="dialog"], .mstrmojo-Dialog, .mstrmojo-MsgBox, .mstrmojo-popup, [class*="Dialog"], [class*="MsgBox"], [class*="Modal"]'
      )).filter(isVisible);
      const looksLikeError = el => /an error has occurred|sorry for the inconvenience|contact your administrator/i.test(el.innerText || '');
      const candidates = dialogs.filter(looksLikeError).concat(dialogs);
      for (const dlg of candidates) {
        const btns = Array.from(dlg.querySelectorAll('button, [role="button"], a, span, input[type="button"]')).filter(isVisible);
        for (const el of btns) {
          const t = norm(el.innerText || el.textContent || el.value || '');
          if (/^(ok|close|dismiss|yes)$/i.test(t)) {
            try { el.click(); return { dismissed: true, via: 'dialog-ok', text: t }; } catch (_) {}
          }
        }
      }
      // Fallback: any visible OK whose ancestor mentions error / Show Details.
      for (const el of Array.from(document.querySelectorAll('button, [role="button"], a, span, input[type="button"]')).filter(isVisible)) {
        const t = norm(el.innerText || el.textContent || el.value || '');
        if (!/^(ok|close|dismiss)$/i.test(t)) continue;
        let p = el.parentElement;
        for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
          const pt = p.innerText || '';
          if (/an error has occurred|show details|sorry for the inconvenience/i.test(pt)) {
            try { el.click(); return { dismissed: true, via: 'ancestor-error-ok', text: t }; } catch (_) {}
          }
        }
      }
      return { dismissed: false };
    };

    let last = { dismissed: false };
    for (let attempt = 0; attempt < 3; attempt++) {
      let hit = false;
      const frames = [];
      if (cachedDossierFrame && !cachedDossierFrame.isDetached()) frames.push(cachedDossierFrame);
      for (const f of page.frames()) {
        if (!frames.includes(f)) frames.push(f);
      }
      for (const frame of frames) {
        try {
          const r = await frame.evaluate(tryDismiss);
          if (r && r.dismissed) { last = r; hit = true; break; }
        } catch (_) {}
      }
      if (!hit) {
        try {
          const r = await page.evaluate(tryDismiss);
          if (r && r.dismissed) { last = r; hit = true; }
        } catch (_) {}
      }
      if (hit) {
        await sleep(400);
        try { await page.keyboard.press('Escape'); } catch (_) {}
        try {
          const vh = (page.viewportSize() && page.viewportSize().height) || 800;
          await page.mouse.click(8, Math.max(8, vh - 8));
        } catch (_) {}
        await sleep(250);
      } else {
        break;
      }
    }
    return last;
  };

  const closeAnyOpenDropdown = async () => {
    try { await page.keyboard.press('Escape'); } catch (_) {}
    try {
      const vh = (page.viewportSize() && page.viewportSize().height) || 800;
      await page.mouse.click(8, Math.max(8, vh - 8));
    } catch (_) {}
    await sleep(250);
  };

  const selectByLabel = async (labelText, optionText) => {
    const __delay = ms => new Promise(r => setTimeout(r, ms));
    const __closeDd = async () => {
      try { await page.keyboard.press('Escape'); } catch (_) {}
      try {
        const vh = (page.viewportSize() && page.viewportSize().height) || 800;
        await page.mouse.click(8, Math.max(8, vh - 8));
      } catch (_) {}
      await __delay(250);
    };
    if (typeof closeAnyOpenDropdown === 'function') await closeAnyOpenDropdown();
    else await __closeDd();
    await __delay(200);
    const runInAllFrames = async (fn, payload) => {
      const frames = page.frames();
      let lastErr = null;
      for (const frame of frames) {
        try {
          const out = await frame.evaluate(fn, payload);
          if (out && !out.error) return out;
          if (out && out.error && !/Label not found/i.test(String(out.error))) return out;
          if (out) lastErr = out;
        } catch (e) { lastErr = { error: String(e && e.message || e) }; }
      }
      return lastErr || { error: 'Label not found: ' + labelText };
    };
    const findAndOpen = (payload) => {
      const label = payload[0]; const opt = payload[1];
      function getDirectText(el) { let t = ''; for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent; return (t || '').trim(); }
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const stripColon = s => norm(s).replace(/:$/, '');
      const normLabel = stripColon(label);
      const labelHit = (el) => {
        const direct = getDirectText(el);
        const inner = norm(el.innerText || '');
        const nd = stripColon(direct);
        const ni = stripColon(inner);
        return nd === normLabel || ni === normLabel || nd.startsWith(normLabel) || ni.startsWith(normLabel)
          || (inner === norm(label) && (el.innerText || '').length < 40);
      };
      const extractCode = v => norm(v).split(/\s+/)[0].trim();
      const optCode = extractCode(opt); const normOpt = norm(opt);
      const isVisible = el => { try { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const st = (el.ownerDocument.defaultView || window).getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0'; } catch (_) { return false; } };
      const labelSel = 'label, span, div, td, th, p, li, a, button, [role="button"], [class*="Selector"], [class*="Filter"]';
      const labelNodes = Array.from(document.querySelectorAll(labelSel)).filter(isVisible);
      let labelEl = null, labelArea = Infinity;
      const tryPickLabel = (nodes, topOnly) => {
        for (const el of nodes) {
          const r = el.getBoundingClientRect();
          if (topOnly && r.top > 160) continue;
          if (!labelHit(el)) continue;
          const area = r.width * r.height;
          if (area > 0 && area < labelArea && area < 40000) { labelEl = el; labelArea = area; }
        }
      };
      tryPickLabel(labelNodes, true);
      if (!labelEl) tryPickLabel(labelNodes, false);
      if (!labelEl) {
        for (const el of labelNodes) {
          const direct = getDirectText(el);
          if (!direct || direct.length > 28) continue;
          if (stripColon(direct) !== normLabel && !stripColon(direct).startsWith(normLabel)) continue;
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > 0 && area < labelArea && area < 40000) { labelEl = el; labelArea = area; }
        }
      }
      if (!labelEl) {
        const sampleFilterTexts = [];
        for (const el of labelNodes) {
          const r = el.getBoundingClientRect();
          if (r.top > 140) continue;
          const d = getDirectText(el) || (el.innerText || '').trim().split('\n')[0].trim();
          if (!d || d.length < 2 || d.length > 36) continue;
          if (sampleFilterTexts.indexOf(d) < 0) sampleFilterTexts.push(d);
          if (sampleFilterTexts.length >= 18) break;
        }
        return { error: 'Label not found: ' + label, sampleFilterTexts };
      }
      const lr = labelEl.getBoundingClientRect();
      let bestSelect = null, bestDist = Infinity;
      for (const s of Array.from(document.querySelectorAll('select'))) {
        if (!isVisible(s)) continue;
        const r = s.getBoundingClientRect(); const dist = Math.abs(r.top - lr.top) + Math.abs(r.left - lr.right);
        if (dist < 280 && dist < bestDist) { bestSelect = s; bestDist = dist; }
      }
      if (bestSelect) {
        const options = Array.from(bestSelect.options);
        const m = options.find(o => extractCode(o.textContent) === optCode) || options.find(o => norm(o.textContent) === normOpt);
        if (m) { bestSelect.value = m.value; bestSelect.dispatchEvent(new Event('input', { bubbles: true })); bestSelect.dispatchEvent(new Event('change', { bubbles: true })); return { clicked: true, via: 'native-select', option: (m.textContent || '').trim() }; }
      }
      const legacy = Array.from(document.querySelectorAll('.mstrmojo-DocSelector, [class*="DocSelector"]'));
      for (const sel of legacy) {
        if (!isVisible(sel)) continue;
        const r = sel.getBoundingClientRect();
        if (Math.abs(r.top - lr.top) > 50) continue;
        if (r.left < lr.left - 20) continue;
        for (const c of Array.from(sel.querySelectorAll('span, div, a, td, li'))) {
          const d = getDirectText(c) || (c.textContent || '').trim();
          if (!d || d.length < 2 || d.length > 80) continue;
          if (extractCode(d) === optCode || norm(d) === normOpt) {
            c.click();
            return { clicked: true, via: 'legacy-selector', option: d };
          }
        }
        sel.click();
        return { opened: true, via: 'legacy-open', clickedText: (sel.textContent || '').trim().substring(0, 60) };
      }
      let valueEl = null, valueDist = Infinity;
      for (const el of Array.from(document.querySelectorAll('span, div, button, a, input, [role="button"], [role="combobox"]')).filter(isVisible)) {
        const d = getDirectText(el) || (el.innerText || '').trim().split('\n')[0].trim();
        if (!d || norm(d) === norm(label) || d.length > 80) continue;
        const r = el.getBoundingClientRect(); if (r.top < lr.top - 8 || r.top - lr.top > 70) continue;
        const dist = (r.top - lr.top) + Math.abs(r.left - lr.left) * 0.5;
        if (dist < valueDist) { valueDist = dist; valueEl = el; }
      }
      if (valueEl) { valueEl.click(); return { opened: true, via: 'click-current-value', clickedText: (getDirectText(valueEl) || valueEl.innerText || '').trim().substring(0, 60) }; }
      try { labelEl.click(); } catch (_) {}
      return { opened: true, via: 'label-click', clickedText: label };
    };
    let result = await runInAllFrames(findAndOpen, [labelText, optionText]);
    if (result && result.error && /Label not found/i.test(String(result.error))) {
      for (const frame of page.frames()) {
        try {
          let loc = frame.getByText(labelText, { exact: true }).first();
          if (!(await loc.count().catch(() => 0))) {
            loc = frame.getByText(new RegExp('^\\s*' + String(labelText).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\s*:?\\s*$', 'i')).first();
          }
          if (!(await loc.count().catch(() => 0))) {
            loc = frame.getByText(labelText, { exact: false }).first();
          }
          if (await loc.count().catch(() => 0)) {
            const box = await loc.boundingBox().catch(() => null);
            if (box) {
              await page.mouse.click(box.x + box.width + 24, box.y + box.height / 2);
              result = { opened: true, via: 'playwright-near-label', clickedText: labelText };
            } else {
              await loc.click({ timeout: 2500 });
              result = { opened: true, via: 'playwright-label-click', clickedText: labelText };
            }
            break;
          }
        } catch (_) {}
      }
    }
    if (result && result.clicked) {
      if (typeof closeAnyOpenDropdown === 'function') await closeAnyOpenDropdown();
      if (typeof waitForLoadingToFinish === 'function') await waitForLoadingToFinish();
      return { ok: true, ...result };
    }
    if (result && result.opened) {
      await __delay(900);
      const pickInFrame = async (opt) => { /* option picker — see RTB filter-helpers */
        const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const optCode = norm(opt).split(/\s+/)[0]; const normOpt = norm(opt);
        function getDirectText(el) { let t = ''; for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent; return (t || '').trim(); }
        const isVisible = el => { try { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none'; } catch (_) { return false; } };
        const OPT_SEL = 'li, [role="option"], [role="menuitem"], td, span, div, a, label';
        for (const el of Array.from(document.querySelectorAll(OPT_SEL))) {
          if (!isVisible(el)) continue;
          const t = norm((el.innerText || el.textContent || '').trim());
          if (t === normOpt || t.split(/\s+/)[0] === optCode) { el.click(); return { clicked: true, text: (el.innerText || '').trim().substring(0, 80) }; }
        }
        return { clicked: false };
      };
      let picked = null;
      for (const frame of page.frames()) {
        const out = await frame.evaluate(pickInFrame, optionText).catch(() => null);
        if (out && out.clicked) { picked = out; break; }
      }
      if (picked && picked.clicked) {
        if (typeof closeAnyOpenDropdown === 'function') await closeAnyOpenDropdown();
        if (typeof waitForLoadingToFinish === 'function') await waitForLoadingToFinish();
        return { ok: true, via: 'opened-then-picked', ...picked };
      }
      return { ok: false, error: 'Opened dropdown for ' + labelText + ' but option not found: ' + optionText, clickedTo: result.clickedText };
    }
    return { ok: false, ...(result || { error: 'evaluate failed for ' + labelText }) };
  };
  const clickByTextInFrames = async (text, { preferBottom, preferTop, preferMiddle, openers } = {}) => {
    const payload = { preferBottom: !!preferBottom, preferTop: !!preferTop, preferMiddle: !!preferMiddle };
    for (const frame of page.frames()) {
      try {
        const r = await frame.evaluate(([label, opts]) => {
          function getDirectText(el) {
            let t = '';
            for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
            return (t || '').trim();
          }
          const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const target = norm(label);
          const matchText = (direct, inner) => {
            if (direct === target || inner === target) return true;
            // Short tab labels: do not match longer titles ("Overall Performance",
            // "Activity Trend", "Performance - Activity").
            if (target.length <= 18) {
              return direct.startsWith(target) && direct.length <= target.length + 4;
            }
            if (inner.includes(target) && inner.length <= target.length + 80) return true;
            if (target.includes(inner) && inner.length >= 4) return true;
            if (target.length >= 10 && inner.includes(target.slice(0, Math.min(24, target.length)))) return true;
            return false;
          };
          const isVisible = el => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return false;
            const st = (el.ownerDocument.defaultView || window).getComputedStyle(el);
            return st.visibility !== 'hidden' && st.display !== 'none';
          };
          const isBlueTab = el => {
            const st = getComputedStyle(el);
            const bg = st.backgroundColor || '';
            return /rgb\(\s*\d+,\s*\d+,\s*2[0-9]{2}/.test(bg)
              || /rgb\(\s*0,\s*\d+,\s*2[0-9]{2}/.test(bg);
          };
          const vh = window.innerHeight || 800;
          const hits = [];
          for (const el of Array.from(document.querySelectorAll('button, a, span, div, li, label, [role="button"], [role="tab"]'))) {
            if (!isVisible(el)) continue;
            const direct = norm(getDirectText(el));
            const inner = norm(el.innerText || el.textContent || '');
            if (!matchText(direct, inner)) continue;
            const r = el.getBoundingClientRect();
            if (opts.preferBottom && r.top < vh * 0.62) continue;
            if (opts.preferMiddle && (r.top < vh * 0.10 || r.top > vh * 0.58)) continue;
            if (opts.preferTop && !opts.preferMiddle && r.top > vh * 0.45) continue;
            const tag = (el.tagName || '').toLowerCase();
            const role = (el.getAttribute('role') || '').toLowerCase();
            const score = (tag === 'button' || role === 'tab' || role === 'button' ? 2 : 0)
              + (isBlueTab(el) ? 3 : 0)
              + (opts.preferMiddle && r.top >= vh * 0.14 && r.top <= vh * 0.50 ? 2 : 0);
            hits.push({ el, area: r.width * r.height, top: r.top, bottom: r.bottom, score });
          }
          if (!hits.length) return { error: 'not in frame' };
          hits.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (opts.preferBottom) return b.bottom - a.bottom || a.area - b.area;
            if (opts.preferTop || opts.preferMiddle) return a.top - b.top || a.area - b.area;
            return a.area - b.area;
          });
          hits[0].el.click();
          return { clicked: true, via: 'frame-eval', text: label };
        }, [text, payload]);
        if (r && r.clicked) return r;
      } catch (_) {}
    }
    return null;
  };

  const clickByText = async (text, { scope, openers, preferBottom, preferTop, preferMiddle } = {}) => {
    let r = await clickByTextInFrames(text, { preferBottom, preferTop, preferMiddle, openers });
    if (r && r.clicked) return r;
    const tryClick = () => page.evaluate(([label, scopeSel]) => {
      function getDirectText(el) { let t = ''; for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent; return t.trim(); }
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const target = norm(label);
      const isVisible = el => { const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; const st = el.ownerDocument.defaultView.getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none'; };
      const roots = [document];
      for (const f of Array.from(document.querySelectorAll('iframe, frame'))) { try { if (f.contentDocument) roots.push(f.contentDocument); } catch (_) {} }
      const exact = [];
      for (const root of roots) {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          if (!isVisible(el)) continue;
          const direct = norm(getDirectText(el));
          const inner = norm(el.innerText || '');
          const shortTab = target.length <= 18;
          const hit = (direct && direct === target) || inner === target
            || (!shortTab && inner.includes(target) && inner.length <= target.length + 24)
            || (shortTab && direct && direct.startsWith(target) && direct.length <= target.length + 4);
          if (hit) {
            const r = el.getBoundingClientRect();
            exact.push({ el, area: r.width * r.height });
          }
        }
      }
      exact.sort((a, b) => a.area - b.area);
      if (exact[0]) { exact[0].el.click(); return { clicked: true, via: 'exact', text: label }; }
      return { error: 'Text not found: ' + label };
    }, [text, scope || null]);
    r = await tryClick();
    if (r && r.clicked) return r;
    const menuOpeners = openers || ['Menu', 'Navigation', 'More', 'Open menu', 'Main menu', '☰'];
    for (const opener of menuOpeners) {
      await clickByTextInFrames(opener, { openers: menuOpeners }).catch(() => null);
      await page.evaluate((op) => {
        const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const t = norm(el.innerText || el.textContent || '');
          if (t === norm(op) || t.includes(norm(op))) { el.click(); return true; }
        }
        return false;
      }, opener).catch(() => false);
      await sleep(400);
      r = await clickByTextInFrames(text, { preferBottom, preferTop, preferMiddle, openers });
      if (r && r.clicked) return { ...r, via: 'after-opener-frame-' + (r.via || 'frame') };
      r = await tryClick();
      if (r && r.clicked) return { ...r, via: 'after-opener-' + opener };
    }
    return r || { error: 'Navigation failed: ' + text };
  };
  const chartTitleVariants = (titleText) => {
    const t = String(titleText || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const out = [t];
    const noSuffix = t.replace(/\s+(graph|chart|plot)$/i, '').trim();
    if (noSuffix && noSuffix !== t) out.push(noSuffix);
    if (!/\b(graph|chart|plot)\b/i.test(t)) {
      out.push(t + ' Graph');
      out.push(t + ' Chart');
    }
    if (/\btrend$/i.test(t) && !/\btrends$/i.test(t)) out.push(t + 's');
    if (/\btrends$/i.test(t)) out.push(t.replace(/s$/i, ''));
    return [...new Set(out.filter(Boolean))];
  };

  const locateChartByTitle = (titleText) => {
    const isVisible = el => { const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none'; };
    function getDirectText(el) { let t = ''; for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent; return t.trim(); }
    const target = String(titleText || '').toLowerCase();
    let titleEl = null, titleArea = Infinity;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (!isVisible(el)) continue;
      const direct = getDirectText(el).toLowerCase();
      const inner = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!direct.includes(target) && !(inner.includes(target) && inner.length <= target.length + 48)) continue;
      const r = el.getBoundingClientRect(); const area = r.width * r.height;
      if (area < titleArea) { titleEl = el; titleArea = area; }
    }
    if (!titleEl) return { error: 'chart title not found: ' + titleText };
    const tr = titleEl.getBoundingClientRect();
    let best = null, bestDist = Infinity, bestRect = null;
    for (const el of Array.from(document.querySelectorAll('canvas, svg, [class*="highcharts" i], [class*="mstrmojo-graph" i], [class*="chart-container" i], [class*="Graph" i]'))) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 50 || r.top < tr.bottom - 10) continue;
      const dist = (r.top - tr.bottom) + Math.abs(r.left - tr.left);
      if (dist < bestDist) { bestDist = dist; best = el; bestRect = r; }
    }
    if (!best) return { error: 'chart element not found below title' };
    return { top: bestRect.top, left: bestRect.left, width: bestRect.width, height: bestRect.height };
  };

  const findChartWidget = async (chartTitleText) => {
    const titles = chartTitleVariants(chartTitleText);
    if (!titles.length) titles.push(String(chartTitleText || 'Chart'));
    let lastError = 'chart title not found: ' + chartTitleText;
    for (const titleText of titles) {
      const { frame, result } = await evalAcrossFrames(locateChartByTitle, titleText);
      if (result && !result.error && frame) return { frame, rect: result };
      if (result && result.error) lastError = result.error;
    }
    for (const titleText of titles) {
      try {
        const result = await page.evaluate(locateChartByTitle, titleText);
        if (result && !result.error) return { frame: page.mainFrame(), rect: result };
        if (result && result.error) lastError = result.error;
      } catch (_) {}
    }
    return { frame: null, rect: null, error: lastError };
  };

  const getFrameViewportOffset = async (frame) => {
    if (!frame || frame === page.mainFrame()) return { x: 0, y: 0 };
    try { const frameEl = await frame.frameElement(); const box = await frameEl.boundingBox(); if (box) return { x: box.x, y: box.y }; } catch (_) {}
    return { x: 0, y: 0 };
  };

  const openShowData = async (chartTitleText) => {
    await dismissGenericErrorDialog();
    await waitForLoadingToFinish(20000);
    const { frame, rect, error } = await findChartWidget(chartTitleText);
    if (!frame || !rect) return { error: error || 'chart widget not located' };
    cachedDossierFrame = frame;
    const frameOffset = await getFrameViewportOffset(frame);
    const cx = frameOffset.x + rect.left + rect.width / 2;
    const cy = frameOffset.y + rect.top + Math.min(40, rect.height / 3);
    const cornerX = frameOffset.x + rect.left + rect.width - 18;
    const cornerY = frameOffset.y + rect.top + 14;

    const clickDotsAt = async (ax, ay) => {
      await page.mouse.move(cx, cy, { steps: 12 });
      await sleep(350);
      await page.mouse.move(ax, ay, { steps: 12 });
      await sleep(700);
      return await evalInFrame(frame, ([anchorX, anchorY]) => {
        const isVisible = el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const st = getComputedStyle(el);
          return st.visibility !== 'hidden' && st.display !== 'none';
        };
        const known = Array.from(document.querySelectorAll(
          '.hover-menu-btn, .hover-btn, [aria-label="Context Menu"], [aria-label*="context menu" i], [aria-label*="More" i], [title*="More" i]'
        )).filter(isVisible);
        if (known.length) {
          known.sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            const da = Math.abs(ra.left - anchorX) + Math.abs(ra.top - anchorY);
            const db = Math.abs(rb.left - anchorX) + Math.abs(rb.top - anchorY);
            return da - db;
          });
          known[0].click();
          return { clicked: true, via: 'known-menu-btn' };
        }
        for (const el of Array.from(document.querySelectorAll('*'))) {
          if (!isVisible(el)) continue;
          const t = (el.innerText || el.textContent || '').trim();
          if (t === '...' || t === '⋮' || t === '•••' || t === '···') {
            el.click();
            return { clicked: true, via: 'text-dots' };
          }
          const al = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || '')) || '';
          if (/more options|show more|kebab|ellipsis|3.?dot|three.?dot|context\s*menu/i.test(al)) {
            el.click();
            return { clicked: true, via: 'aria-label' };
          }
        }
        const classRe = /more|kebab|ellipsis|overflow|menu|dots?[-_]?btn|hover-btn/i;
        for (const el of Array.from(document.querySelectorAll('*'))) {
          if (!isVisible(el)) continue;
          const cls = (el.getAttribute && el.getAttribute('class')) || '';
          if (!cls || !classRe.test(cls)) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.width < 64 && r.height > 0 && r.height < 64) {
            el.click();
            return { clicked: true, via: 'class-keyword' };
          }
        }
        return { error: 'dots button not found' };
      }, [ax - frameOffset.x, ay - frameOffset.y]);
    };

    let dotsClicked = await clickDotsAt(cornerX, cornerY);
    if (dotsClicked.error) {
      for (const [dx, dy] of [[-8,0],[8,0],[0,-8],[0,8],[-16,-4],[16,-4],[-20,10],[10,20]]) {
        dotsClicked = await clickDotsAt(cornerX + dx, cornerY + dy);
        if (dotsClicked.clicked) break;
      }
    }
    if (dotsClicked.error) {
      // Last resort: right-click chart center to open context menu.
      await page.mouse.click(cx, cy, { button: 'right' });
      await sleep(700);
      dotsClicked = { clicked: true, via: 'right-click' };
    }

    await sleep(800);

    const clickShowDataAnywhere = async () => {
      const tryClick = () => {
        const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const isVisible = el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const st = getComputedStyle(el);
          return st.visibility !== 'hidden' && st.display !== 'none';
        };
        const isMatch = t => t === 'show data' || t === 'export data' || t === 'view data'
          || /^show\s*data/.test(t) || t.includes('show data');
        const exact = [], fuzzy = [];
        for (const el of Array.from(document.querySelectorAll('li, button, a, span, div, [role="menuitem"], [role="option"]'))) {
          if (!isVisible(el)) continue;
          const raw = (el.innerText || el.textContent || '').trim();
          if (!raw || raw.length > 40) continue;
          const t = norm(raw);
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (t === 'show data' || t === 'export data') exact.push({ el, area });
          else if (isMatch(t) && area < 8000) fuzzy.push({ el, area });
        }
        exact.sort((a, b) => a.area - b.area);
        fuzzy.sort((a, b) => a.area - b.area);
        const best = exact[0] || fuzzy[0];
        if (best) { best.el.click(); return { clicked: true, text: (best.el.innerText || '').trim() }; }
        return { error: 'Show Data menu item not found' };
      };

      if (cachedDossierFrame && !cachedDossierFrame.isDetached()) {
        try {
          const r = await cachedDossierFrame.evaluate(tryClick);
          if (r && r.clicked) return r;
        } catch (_) {}
      }
      const { result } = await evalAcrossFrames(tryClick);
      if (result && result.clicked) return result;
      try {
        const r = await page.evaluate(tryClick);
        if (r && r.clicked) return r;
        return r || { error: 'Show Data menu item not found' };
      } catch (e) {
        return { error: String(e && e.message || e) };
      }
    };

    let showDataClicked = await clickShowDataAnywhere();
    if (showDataClicked.error) {
      // Re-hover and retry once — menu can dismiss after grain/filter redraw.
      await dismissGenericErrorDialog();
      dotsClicked = await clickDotsAt(cornerX, cornerY);
      await sleep(900);
      showDataClicked = await clickShowDataAnywhere();
    }
    if (showDataClicked.error) {
      return { error: showDataClicked.error, dots: dotsClicked };
    }
    await sleep(1000);
    return { ok: true, dots: dotsClicked, showData: showDataClicked };
  };

  const findShowDataPopupContainer = async () => {
    // Prefer dialog/popup with a real multi-column grid — never a lone KPI cell.
    return await evalAcrossFrames(() => {
      const isVisible = el => {
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 40) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none';
      };
      const POPUP_SEL = '[role="dialog"], .mstrmojo-popup, .mstrmojo-Popup, .mstrmojo-Dialog, .mstrmojo-RootPopup, .mstrmojo-MsgBox, [class*="Popup"], [class*="Modal"], [class*="Dialog"]';
      const scoreTable = (table) => {
        if (!table || !table.rows || table.rows.length < 2) return 0;
        const cols = table.rows[0] ? table.rows[0].cells.length : 0;
        if (cols < 2) return 0; // reject single-KPI "tables"
        const rows = table.rows.length;
        const r = table.getBoundingClientRect();
        return rows * cols * 10 + (r.width * r.height) / 1000;
      };
      const candidates = Array.from(document.querySelectorAll(POPUP_SEL)).filter(isVisible);
      let best = null, bestScore = 0, bestTable = null;
      for (const el of candidates) {
        const tables = Array.from(el.querySelectorAll('table'));
        for (const table of tables) {
          const s = scoreTable(table);
          if (s > bestScore) { bestScore = s; best = el; bestTable = table; }
        }
        // ARIA grids inside popup
        const gridRows = el.querySelectorAll('[role="row"]');
        if (gridRows.length >= 3) {
          const s = gridRows.length * 5;
          if (s > bestScore) { bestScore = s; best = el; bestTable = null; }
        }
      }
      if (!best || bestScore < 20) {
        // Fallback: largest multi-col table on page that looks chart-like
        const tables = Array.from(document.querySelectorAll('table')).filter(t => scoreTable(t) > 0);
        tables.sort((a, b) => scoreTable(b) - scoreTable(a));
        if (!tables.length) {
          return {
            error: 'no multi-column Show Data table',
            popupCount: candidates.length,
            bestScore,
            visibleTables: document.querySelectorAll('table').length,
            roleRows: document.querySelectorAll('[role="row"]').length,
          };
        }
        bestTable = tables[0];
        best = bestTable.closest(POPUP_SEL) || bestTable;
        bestScore = scoreTable(bestTable);
      }
      if (bestScore < 20) {
        return {
          error: 'Show Data table too small (likely KPI, not chart)',
          popupCount: candidates.length,
          bestScore,
          visibleTables: document.querySelectorAll('table').length,
        };
      }
      let cols = bestTable && bestTable.rows[0] ? bestTable.rows[0].cells.length : 0;
      let rows = bestTable ? bestTable.rows.length : 0;
      let via = bestTable ? 'html-table' : 'aria-grid';
      // ARIA Show Data grids set bestTable=null; count role=rows so waitForShowDataPopup
      // does not treat a ready 634x494 popup as empty (rowCount=0/colCount=0).
      if (!bestTable && best) {
        const ariaRows = Array.from(best.querySelectorAll('[role="row"]'));
        rows = ariaRows.length;
        const first = ariaRows[0];
        cols = first
          ? first.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"], td, [class*="cell" i]').length
          : 0;
      }
      const tr = (bestTable || best).getBoundingClientRect();
      return {
        ready: true,
        rowCount: rows,
        colCount: cols,
        score: bestScore,
        via,
        top: tr.top,
        left: tr.left,
        width: tr.width,
        height: tr.height,
      };
    });
  };

  const waitForShowDataPopup = async (maxMs = 20000) => {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < maxMs) {
      const { result } = await findShowDataPopupContainer();
      last = result;
      if (result && result.ready && (result.colCount >= 2 || result.rowCount >= 3 || (result.via === 'aria-grid' && result.score >= 20))) {
        await sleep(300);
        return result;
      }
      await sleep(250);
    }
    return { error: 'Show Data popup timed out (no multi-column chart table)', last };
  };

  const extractShowDataTable = async () => {
    const extractFn = () => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const isVisible = el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none';
      };
      const isControlText = t => /^(close|add data|export|ok|cancel)$/.test(t);
      const isKpiLike = (headers, rows) => {
        if (!headers || headers.length < 2) return true;
        if (!rows || rows.length < 1) return true;
        // Single metric + one value = KPI tile scrape, not chart Show Data
        if (headers.length === 1 && rows.length <= 2) return true;
        return false;
      };
      const POPUP_SEL = '[role="dialog"], .mstrmojo-popup, .mstrmojo-Popup, .mstrmojo-Dialog, .mstrmojo-RootPopup, [class*="Popup"], [class*="Modal"], [class*="Dialog"], [class*="overlay" i]';
      const scoreTable = (table) => {
        if (!table || !table.rows || table.rows.length < 2) return 0;
        const cols = table.rows[0] ? table.rows[0].cells.length : 0;
        if (cols < 2) return 0;
        return table.rows.length * cols;
      };
      const parseHtmlTable = (table) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length < 2) return null;
        const headerCells = Array.from(rows[0].querySelectorAll('th, td'));
        const headers = headerCells.map((h, i) => (h.innerText || h.textContent || '').trim() || ('col_' + i));
        const data = [];
        for (let i = 1; i < rows.length; i++) {
          const cells = Array.from(rows[i].querySelectorAll('td, th'));
          if (!cells.length) continue;
          const rowText = norm(rows[i].innerText || rows[i].textContent || '');
          if (isControlText(rowText)) continue;
          const rowData = {};
          headers.forEach((h, idx) => {
            rowData[h] = cells[idx] ? (cells[idx].innerText || cells[idx].textContent || '').trim() : '';
          });
          data.push(rowData);
        }
        if (isKpiLike(headers, data)) return null;
        return { headers, rows: data, via: 'html-table' };
      };

      // 1) Tables inside popups first
      const popups = Array.from(document.querySelectorAll(POPUP_SEL)).filter(isVisible);
      let bestParsed = null, bestScore = 0;
      for (const popup of popups) {
        for (const table of Array.from(popup.querySelectorAll('table'))) {
          const s = scoreTable(table);
          if (s < 4) continue;
          const parsed = parseHtmlTable(table);
          if (!parsed) continue;
          if (s > bestScore) { bestScore = s; bestParsed = parsed; }
        }
      }
      if (bestParsed) return bestParsed;

      // 2) Largest multi-col table on page
      const tables = Array.from(document.querySelectorAll('table')).filter(t => scoreTable(t) >= 4);
      tables.sort((a, b) => scoreTable(b) - scoreTable(a));
      for (const table of tables) {
        const parsed = parseHtmlTable(table);
        if (parsed) return parsed;
      }

      // 3) ARIA grid inside popup (same as proven Monthly script)
      for (const popupEl of popups) {
        let rowEls = Array.from(popupEl.querySelectorAll('[role="row"]')).filter(isVisible);
        rowEls.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        if (rowEls.length < 2) continue;
        let headerRowEl = rowEls.find(r => r.querySelector('[role="columnheader"]')) || rowEls[0];
        const headerCellEls = Array.from(headerRowEl.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"], td, [class*="cell" i]'));
        if (headerCellEls.length < 2) continue;
        const headerCols = headerCellEls.map((h, i) => {
          const r = h.getBoundingClientRect();
          return { name: (h.innerText || h.textContent || '').trim() || ('col_' + i), cx: r.left + r.width / 2 };
        });
        const data = [];
        for (const rowEl of rowEls.filter(r => r !== headerRowEl)) {
          const cells = Array.from(rowEl.querySelectorAll('[role="gridcell"], [role="cell"], td, [class*="cell" i]'));
          if (!cells.length) continue;
          const rowText = norm(rowEl.innerText || rowEl.textContent || '');
          if (isControlText(rowText)) continue;
          const rowData = {};
          for (const cell of cells) {
            const raw = (cell.innerText || cell.textContent || '').trim();
            if (!raw) continue;
            const r = cell.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            let bestCol = null, bestDist = Infinity;
            for (const col of headerCols) {
              const d = Math.abs(cx - col.cx);
              if (d < bestDist) { bestDist = d; bestCol = col; }
            }
            if (bestCol) rowData[bestCol.name] = raw;
          }
          if (Object.keys(rowData).length > 0) data.push(rowData);
        }
        const headers = headerCols.map(c => c.name);
        if (!isKpiLike(headers, data) && data.length > 0) {
          return { headers, rows: data, via: 'aria-row-grid' };
        }
      }

      return { error: 'Show Data chart table not found (rejected KPI/single-column scrape)' };
    };

    if (cachedDossierFrame && !cachedDossierFrame.isDetached()) {
      try {
        const result = await cachedDossierFrame.evaluate(extractFn);
        if (result && !result.error) return result;
      } catch (_) {}
    }
    const { result } = await evalAcrossFrames(extractFn);
    return result;
  };

  const isGoodChartTable = (td) => {
    if (!td || td.error) return false;
    const headers = td.headers || [];
    const rows = td.rows || td.data || [];
    if (headers.length < 2) return false;
    if (!rows.length) return false;
    return true;
  };

  const closeShowDataPopup = async () => {
    const closed = await page.evaluate(() => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      for (const el of Array.from(document.querySelectorAll('button, [role="button"], span, a'))) {
        const t = norm(el.innerText || el.textContent || '');
        if (t === 'close') { el.click(); return true; }
      }
      return false;
    }).catch(() => false);
    if (!closed) await page.keyboard.press('Escape').catch(() => {});
    await sleep(400);
  };

  // Weekly / Monthly / Quarterly are radios beside Overall Performance — not footer tabs.
  const clickChartTimeGrain = async (grain, chartTitle = 'Overall Performance') => {
    const targetGrain = String(grain || 'Monthly');
    const titleHint = String(chartTitle || 'Overall Performance');
    const tryFrame = async (frame) => {
      try {
        return await frame.evaluate(([titleText, grainText]) => {
          const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const getDirectText = el => {
            let t = '';
            for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
            return t.trim();
          };
          const isVisible = el => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return false;
            const st = getComputedStyle(el);
            return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
          };
          const grainN = norm(grainText);
          const title = norm(titleText);
          const grains = ['weekly', 'monthly', 'quarterly'];
          let titleRect = null, titleArea = Infinity;
          for (const el of Array.from(document.querySelectorAll('*'))) {
            if (!isVisible(el)) continue;
            const d = norm(getDirectText(el));
            const inner = norm(el.innerText || '');
            if (d !== title && !d.includes(title) && !(inner.includes(title) && inner.length <= title.length + 48)) continue;
            const r = el.getBoundingClientRect();
            const area = r.width * r.height;
            if (area < titleArea) { titleArea = area; titleRect = r; }
          }
          const grainHits = [];
          for (const el of Array.from(document.querySelectorAll('*'))) {
            if (!isVisible(el)) continue;
            const d = norm(getDirectText(el));
            if (!grains.includes(d)) continue;
            const r = el.getBoundingClientRect();
            if (r.width * r.height > 8000) continue;
            grainHits.push({ el, d, r, area: r.width * r.height });
          }
          grainHits.sort((a, b) => a.area - b.area);
          if (!grainHits.length) return { error: 'no weekly/monthly/quarterly labels in frame' };
          let cluster = grainHits;
          if (titleRect) {
            const nearTitle = grainHits.filter(h =>
              Math.abs(h.r.top - titleRect.top) < 56 && h.r.left >= titleRect.left - 40
            );
            if (nearTitle.length) cluster = nearTitle;
          }
          const byRow = [];
          for (const h of cluster) {
            let row = byRow.find(x => Math.abs(x.top - h.r.top) < 22);
            if (!row) { row = { top: h.r.top, items: [] }; byRow.push(row); }
            row.items.push(h);
          }
          byRow.sort((a, b) => b.items.length - a.items.length);
          const bestRow = byRow.find(r => r.items.length >= 2) || byRow[0];
          const pool = bestRow ? bestRow.items : cluster;
          const pick = pool.find(h => h.d === grainN) || grainHits.find(h => h.d === grainN);
          if (!pick) return { error: 'grain label not found: ' + grainText };
          const clickControl = (el) => {
            const inner = el.querySelector && el.querySelector('input[type="radio"], [role="radio"]');
            if (inner) { inner.click(); return 'inner-radio'; }
            const forId = el.getAttribute && el.getAttribute('for');
            if (forId) {
              const inp = document.getElementById(forId);
              if (inp) { inp.click(); return 'label-for'; }
            }
            const parent = el.parentElement;
            if (parent) {
              const pr = parent.querySelector('input[type="radio"], [role="radio"]');
              if (pr) { pr.click(); return 'sibling-radio'; }
            }
            let prev = el.previousElementSibling;
            for (let i = 0; i < 4 && prev; i++, prev = prev.previousElementSibling) {
              const isRadio = prev.matches && (prev.matches('input[type="radio"]') || prev.getAttribute('role') === 'radio');
              const pr = isRadio ? prev : (prev.querySelector && prev.querySelector('input[type="radio"], [role="radio"]'));
              if (pr) { pr.click(); return 'prev-radio'; }
            }
            el.click();
            return 'text';
          };
          return { clicked: true, via: clickControl(pick.el), grain: grainText, cluster: pool.map(h => h.d) };
        }, [titleHint, targetGrain]);
      } catch (_) { return null; }
    };
    for (const frame of page.frames()) {
      const r = await tryFrame(frame);
      if (r && r.clicked) {
        await waitForLoadingToFinish();
        await waitForDashboard().catch(() => {});
        return r;
      }
    }
    return { error: 'grain control not found: ' + targetGrain };
  };

  // NAV_STEPS: footer tabs only. Grain (Weekly/Monthly/Quarterly) is clickByText — proven
  // in production Monthly scripts; chart-scoped radio finder is fallback only.
  const NAV_STEPS = ['Performance'];
  const NAV_OPENERS = ['Menu', 'Navigation', 'More', 'Open menu', 'Main menu', '\u2630'];
  const TIME_GRAIN = (typeof __timeGrain !== 'undefined' && __timeGrain)
    || (typeof context !== 'undefined' && context && context.timeGrain)
    || 'Monthly';
  // Filled by RTB assemble from scenario description (widget title for Show Data + grain radios).
  const CHART_TITLE = 'Overall Performance';
  const KPI_LABELS = [];

  const applyTimeGrain = async () => {
    await sleep(500);
    // Prefer chart-scoped radio (beside CHART_TITLE); clickByText as proven Monthly fallback.
    let r = await clickChartTimeGrain(TIME_GRAIN, CHART_TITLE);
    if (r && r.error) {
      r = await clickByText(TIME_GRAIN, { openers: NAV_OPENERS, preferMiddle: true });
    }
    if (r && r.error) {
      r = await clickByText(TIME_GRAIN, { openers: NAV_OPENERS });
    }
    await waitForLoadingToFinish();
    await dismissGenericErrorDialog();
    await waitForDashboard().catch(() => {});
    return r;
  };

  const navPrefer = (step) => {
    const s = String(step || '').trim();
    if (/^(performance|overview|geography)$/i.test(s)) return { preferBottom: true };
    if (/^(activity|trend)$/i.test(s)) return { preferMiddle: true };
    return { preferBottom: true };
  };

  await waitForLoadingToFinish();
  const dossierReady = await waitForDossierReady();
  const navDebug = [{ dossier_ready: dossierReady }];
  for (const step of NAV_STEPS) {
    const pref = navPrefer(step);
    let r = await clickByText(step, { openers: NAV_OPENERS, ...pref });
    if (r && r.error) {
      r = await clickByText(step, { openers: NAV_OPENERS });
    }
    navDebug.push({ step, ...r });
    await waitForLoadingToFinish();
  }
  await waitForDashboard();
  // Grain belongs with navigation (Performance → Activity → Quarterly), before filters.
  const grainNav = await applyTimeGrain();
  navDebug.push({ step: TIME_GRAIN, ...(grainNav || {}) });

  const filterCombinations = (typeof __filterCombinations !== 'undefined' && Array.isArray(__filterCombinations) && __filterCombinations.length > 0)
    ? __filterCombinations : [];

  const extractChartAfterGrain = async (row) => {
    // Filters often leave Territory dropdown + MSTR Error modal open (blocks Show Data).
    await dismissGenericErrorDialog();
    await closeAnyOpenDropdown();
    await sleep(300);

    // Re-assert grain after filters (filters can reset Weekly). Prefer clickByText like working script.
    row.time_grain = await applyTimeGrain();
    await closeAnyOpenDropdown();
    await sleep(400);

    const tryExtract = async (popupMs = 20000) => {
      const openResult = await openShowData(CHART_TITLE);
      if (openResult.error) return { openResult, tableData: null, waitResult: null };
      const waitResult = await waitForShowDataPopup(popupMs);
      if (waitResult && waitResult.error) {
        await closeShowDataPopup().catch(() => {});
        return { openResult, waitResult, tableData: null };
      }
      const tableData = await extractShowDataTable();
      await closeShowDataPopup();
      return { openResult, waitResult, tableData };
    };

    let attempt = await tryExtract(20000);
    if (!isGoodChartTable(attempt.tableData)) {
      await dismissGenericErrorDialog();
      await closeAnyOpenDropdown();
      await sleep(300);
      await clickChartTimeGrain(TIME_GRAIN, CHART_TITLE);
      await waitForLoadingToFinish(15000);
      await dismissGenericErrorDialog();
      attempt = await tryExtract(15000);
    }

    row.show_data_debug = {
      open: attempt.openResult || null,
      wait: attempt.waitResult || null,
      tableError: (attempt.tableData && attempt.tableData.error) || null,
    };
    if (!isGoodChartTable(attempt.tableData)) {
      row.show_data_error = (attempt.tableData && attempt.tableData.error)
        || (attempt.openResult && attempt.openResult.error)
        || (attempt.waitResult && attempt.waitResult.error)
        || 'extracted table is not a multi-column chart Show Data grid';
      if (attempt.tableData) row.tableData_rejected = attempt.tableData;
    } else {
      row.tableData = attempt.tableData;
      row.chart_title = CHART_TITLE;
      // Same key as the scenario KPI label so Latest result can bind without guessing.
      row[CHART_TITLE] = attempt.tableData;
    }
    return row;
  };

  if (filterCombinations.length === 0) {
    await waitForDashboard();
    const row = await extractChartAfterGrain({ navigation: navDebug });
    return { navigation: navDebug, ...row };
  }

  const results = {};
  for (let i = 0; i < filterCombinations.length; i++) {
    const { label = String(i), filters = {} } = filterCombinations[i];
    if (i > 0) {
      await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await waitForDossierReady();
      await dismissGenericErrorDialog();
      for (const step of NAV_STEPS) {
        const pref = navPrefer(step);
        let r = await clickByText(step, { openers: NAV_OPENERS, ...pref });
        if (r && r.error) r = await clickByText(step, { openers: NAV_OPENERS });
      }
      await waitForDashboard();
      await applyTimeGrain();
    }
    await waitForDossierReady(30000);
    const debug = {};
    // Match working script: geo first, Time Bucket / others after (not interleaved with Territory).
    const GEO_ORDER = ['Area', 'Region', 'Territory'];
    const allKeys = Object.keys(filters);
    const geoKeys = GEO_ORDER.filter(k => allKeys.includes(k));
    const otherKeys = allKeys.filter(k => !GEO_ORDER.includes(k));
    for (const key of geoKeys) {
      debug[key] = await selectByLabel(key, filters[key]);
      await dismissGenericErrorDialog();
      await closeAnyOpenDropdown();
    }
    for (const key of otherKeys) {
      debug[key] = await selectByLabel(key, filters[key]);
      await dismissGenericErrorDialog();
      await closeAnyOpenDropdown();
    }
    await dismissGenericErrorDialog();
    await closeAnyOpenDropdown();
    await waitForLoadingToFinish();
    const row = await extractChartAfterGrain({ filters_applied: debug, navigation: navDebug });
    results[label] = row;
  }
  return { navigation: navDebug, results };
};