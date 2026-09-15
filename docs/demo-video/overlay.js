(() => {
  const styleId = "afv-overlay-style";
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.documentElement.appendChild(style);
  }
  style.textContent = `
    .afv-hl {
      outline: 4px solid #ff7a18 !important;
      outline-offset: 5px !important;
      box-shadow: 0 0 0 10px rgba(255,122,24,.22) !important;
      border-radius: 10px;
      position: relative;
      z-index: 20;
    }
    #afv-caption {
      position: fixed;
      left: 50%;
      bottom: 72px;
      transform: translateX(-50%);
      width: min(760px, calc(100% - 100px));
      z-index: 2147483647;
      background: #000;
      color: #fff;
      padding: 10px 18px;
      border: 0;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
      font: 650 17px/1.35 "Segoe UI", system-ui, sans-serif;
      text-align: center;
      text-shadow: none;
      pointer-events: none;
    }
    #afv-caption small { display: none; }
    #afv-cursor {
      position: fixed; z-index: 2147483646; pointer-events: none;
      width: 36px; height: 36px; margin-left: -2px; margin-top: -2px;
      filter: drop-shadow(1px 2px 3px rgba(0,0,0,.45));
    }
  `;
  if (!document.getElementById("afv-caption")) {
    const cap = document.createElement("div");
    cap.id = "afv-caption";
    document.body.appendChild(cap);
  }
  let cur = document.getElementById("afv-cursor");
  if (!cur) {
    cur = document.createElement("div");
    cur.id = "afv-cursor";
    cur.innerHTML = `<svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 3 L5 26 L12 20 L17 30 L21 28 L16 18 L25 18 Z" fill="#ff7a18" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`;
    document.body.appendChild(cur);
  }
  window.afvClear = () => document.querySelectorAll(".afv-hl").forEach((e) => e.classList.remove("afv-hl"));
  window.afvCaption = (title, _sub = "") => {
    const cap = document.getElementById("afv-caption");
    if (cap) cap.textContent = title || "";
  };
  window.afvCursor = (x, y) => {
    const c = document.getElementById("afv-cursor");
    if (c) { c.style.left = x + "px"; c.style.top = y + "px"; }
  };
  window.afvHighlight = (el) => {
    window.afvClear();
    if (!el) return;
    let target = el;
    const r = el.getBoundingClientRect();
    const p = el.parentElement;
    if (p) {
      const pr = p.getBoundingClientRect();
      if (pr.width < 460 && pr.height < 240 && pr.width > r.width + 8) target = p;
    }
    if (target.getBoundingClientRect().width < 900) target.classList.add("afv-hl");
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
  };

  const SKIP = "#afv-caption, #afv-cursor, #afv-overlay-style, script, style, svg, path";
  const CHROME = /^(dashboard|screens|runs|settings|sql templates|tests execution status|total scenarios|cases ran|passed|failed|by report|add screen|save|generate|run suite|run report|run headless|filter combinations|new filter combination|test script|warehouse sql|latest result|screen url|reference url|description|sign out|profile|users|all reports|all workstreams|all criticality|search)$/i;
  const SENSITIVE = /kerendia|bayer|microstrategy|\bmstr\b|nbrx|\bnrx\b|\btrx\b|\bhcp\b|\bhco\b|\bpcc\b|my plan|overview|performance|geography|blink|writers|acceleration|targets|athena|https?:\/\//i;
  const TAGS = ["Example", "ABC", "XYZ"];

  const tagFor = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 3;
    return TAGS[h];
  };

  const placeholder = (raw) => {
    const t = String(raw || "").replace(/\s+/g, " ").trim();
    if (t.length > 70) return "Example description of the ABC screen and XYZ KPI.";
    if (/https?:\/\//i.test(t) || /\.(com|net|org)\b/i.test(t) || /mstr-/i.test(t)) {
      const slug = tagFor(t).toLowerCase();
      return slug === "example" ? "https://example.com/report" : `https://example.com/${slug}`;
    }
    const tag = tagFor(t);
    if (/nbrx|nrx|trx|writers|blink|\bkpi\b/i.test(t) && !/acceleration/i.test(t)) return `${tag} KPI`;
    if (/overview|targets|performance|geography|screen|plan/i.test(t) && !/kerendia|athena/i.test(t)) {
      return `${tag} Screen`;
    }
    return `${tag} Report`;
  };

  const alreadyFake = (raw) => {
    const t = String(raw || "").replace(/\s+/g, " ").trim();
    return /^(example|abc|xyz)(\s+(report|screen|kpi))?$/i.test(t)
      || /^https:\/\/example\.com\//i.test(t)
      || /^example description/i.test(t);
  };

  const shouldMask = (raw) => {
    const t = String(raw || "").replace(/\s+/g, " ").trim();
    if (t.length < 3 || CHROME.test(t) || alreadyFake(t)) return false;
    return SENSITIVE.test(t);
  };

  const inSkip = (el) => {
    if (!el || !el.closest) return true;
    if (el.closest(SKIP)) return true;
    if (el.closest("button") && !shouldMask(el.textContent)) return true;
    const aside = el.closest("aside");
    if (aside && CHROME.test(String(el.textContent || "").replace(/\s+/g, " ").trim())) return true;
    return false;
  };

  window.afvBlur = () => {
    if (window.__afvBlurring) return;
    window.__afvBlurring = true;
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const p = n.parentElement;
        if (!p || inSkip(p)) continue;
        if (shouldMask(n.nodeValue)) hits.push(n);
      }
      for (const n of hits) {
        n.nodeValue = placeholder(n.nodeValue);
      }
      document.querySelectorAll("input, textarea").forEach((el) => {
        if (inSkip(el)) return;
        if (shouldMask(el.value)) el.value = placeholder(el.value);
      });
    } finally {
      window.__afvBlurring = false;
    }
  };

  if (!window.__afvBlurMo) {
    window.__afvBlurMo = new MutationObserver(() => {
      if (window.__afvBlurTimer) return;
      window.__afvBlurTimer = setTimeout(() => {
        window.__afvBlurTimer = null;
        window.afvBlur();
      }, 60);
    });
    window.__afvBlurMo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  window.afvBlur();
})();
