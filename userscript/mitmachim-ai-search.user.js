// ==UserScript==
// @name         חיפוש AI למתמחים טופ
// @namespace    https://mitmachim.top/
// @version      1.0.1
// @description  חיפוש סמנטי מוטמע במתמחים טופ, עם Gemini מקומי בדפדפן
// @author       Mitmachim AI Search
// @match        https://mitmachim.top/*
// @match        https://www.mitmachim.top/*
// @icon         https://hebbkx1anhila5yf.public.blob.vercel-storage.com/gpt-image-2_%D7%94%D7%A2%D7%9C%D7%99%D7%AA%D7%99_%D7%9C%D7%9A_%D7%AA%D7%9E%D7%95%D7%A0%D7%94%D7%99%D7%A9_%D7%91%D7%94_%D7%A1%D7%99%D7%9E%D7%95%D7%9F_%D7%A9%D7%9C_%D7%94%D7%90%D7%99%D7%99%D7%A7%D7%95%D7%9F_%D7%A9%D7%9C_%D7%90%D7%AA%D7%A8-0-xJNfbiCLQi0BHTD9KclXqR5F06BgBg.jpg
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      ai-search-mitmachim.vercel.app
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_SERVER_URL = 'https://ai-search-mitmachim.vercel.app';
  const ICON_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/gpt-image-2_%D7%94%D7%A2%D7%9C%D7%99%D7%AA%D7%99_%D7%9C%D7%9A_%D7%AA%D7%9E%D7%95%D7%A0%D7%94%D7%99%D7%A9_%D7%91%D7%94_%D7%A1%D7%99%D7%9E%D7%95%D7%9F_%D7%A9%D7%9C_%D7%94%D7%90%D7%99%D7%99%D7%A7%D7%95%D7%9F_%D7%A9%D7%9C_%D7%90%D7%AA%D7%A8-0-xJNfbiCLQi0BHTD9KclXqR5F06BgBg.jpg';
  const GEMINI_MODEL = 'gemini-3.1-flash-lite';
  const STORE_VERSION = 1;
  const CACHE_TTL = 30 * 60 * 1000;
  const PAGE_SIZE = 12;
  const state = { controller: null, results: [], page: 1, query: '', plans: [], busy: false, lastFocus: null };

  const storage = {
    get() {
      const value = GM_getValue('mitmachim-ai-settings', null);
      if (!value || value.version !== STORE_VERSION) return { version: STORE_VERSION, keys: [], explain: true, history: [], cache: {} };
      return { version: STORE_VERSION, keys: [], explain: true, history: [], cache: {}, ...value };
    },
    set(next) { GM_setValue('mitmachim-ai-settings', next); },
    update(patch) { const next = { ...this.get(), ...patch }; this.set(next); return next; }
  };

  function request({ method = 'GET', url, headers = {}, data, signal }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const req = GM_xmlhttpRequest({ method, url, headers, data, timeout: 30000,
        onload: (res) => resolve(res), onerror: () => reject(new Error('Network request failed')),
        ontimeout: () => reject(new Error('Network request timed out'))
      });
      signal?.addEventListener('abort', () => { req.abort(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }

  function maskKey(key) { return key.length < 9 ? '••••••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`; }
  function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
  function cleanJson(text) { const match = text.replace(/```(?:json)?/g, '').trim().match(/\{[\s\S]*\}/); if (!match) throw new Error('Gemini returned invalid JSON'); return JSON.parse(match[0]); }

  class KeyManager {
    constructor(keys) { this.keys = keys.filter(Boolean); this.index = Number(GM_getValue('mitmachim-ai-key-index', 0)) % Math.max(this.keys.length, 1); }
    async call(prompt, signal) {
      if (!this.keys.length) throw new Error('יש להוסיף מפתח Gemini בהגדרות');
      let lastError;
      for (let attempt = 0; attempt < this.keys.length * 2; attempt += 1) {
        const index = (this.index + attempt) % this.keys.length;
        const key = this.keys[index];
        try {
          const response = await request({ method: 'POST', signal,
            url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.25 } })
          });
          if ([403, 429].includes(response.status) || response.status >= 500) throw new Error(`Gemini ${response.status}`);
          if (response.status >= 400) throw new Error('מפתח Gemini אינו תקין');
          this.index = (index + 1) % this.keys.length; GM_setValue('mitmachim-ai-key-index', this.index);
          const payload = JSON.parse(response.responseText);
          return cleanJson(payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '');
        } catch (error) { lastError = error; await new Promise((r) => setTimeout(r, Math.min(1800, 300 * 2 ** attempt))); }
      }
      throw lastError || new Error('כל מפתחות Gemini נכשלו');
    }
  }

  async function planSearch(query, keyManager, signal) {
    return keyManager.call(`אתה מתכנן חיפוש בפורום הטכנולוגיה החרדי mitmachim.top. עבור השאלה: "${query}" החזר JSON בלבד: {"queries":[3 עד 8 שאילתות עברית קצרות ומגוונות, ללא site:],"possibleTitles":[עד 5 כותרות אפשריות],"synonyms":[עד 8 מילים]}. אל תענה על השאלה.`, signal);
  }

  async function explainResults(query, results, keyManager, signal) {
    if (!results.length) return results;
    const compact = results.slice(0, 24).map((r, i) => ({ i, title: r.title, snippet: r.snippet })).map(JSON.stringify).join('\n');
    try {
      const data = await keyManager.call(`השאלה: "${query}". כתוב הסבר עברי עובדתי וקצר בן 2-3 שורות לכל תוצאה, רק לפי הכותרת והתקציר. החזר {"items":[{"i":0,"explanation":"..."}]}.
${compact}`, signal);
      const map = new Map((data.items || []).map((item) => [Number(item.i), String(item.explanation || '')]));
      return results.map((result, index) => ({ ...result, explanation: map.get(index) || '' }));
    } catch (_) { return results; }
  }

  async function serverSearch(queries, page, signal) {
    const base = DEFAULT_SERVER_URL;
    const response = await request({ method: 'POST', url: `${base}/api/search`, signal,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ queries, page, pages_per_query: 1, limit: 70 })
    });
    if (response.status >= 400) throw new Error('שרת החיפוש אינו זמין');
    const payload = JSON.parse(response.responseText);
    if (!payload.success) throw new Error(payload.error?.message || 'החיפוש נכשל');
    return payload;
  }

  function styles() {
    const style = document.createElement('style'); 
    style.id = 'mai-styles'; 
    style.textContent = `.mai-icon{width:20px;height:20px;object-fit:cover;border-radius:4px;display:block;all:unset}
.mai-overlay{position:fixed;inset:0;z-index:10050;background:rgba(27,36,48,.48);display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;direction:rtl;all:unset}
.mai-dialog{background:#fff;color:#263238;width:min(940px,100%);max-height:92vh;border-radius:12px;box-shadow:0 24px 70px rgba(20,35,50,.25);display:flex;flex-direction:column;overflow:hidden;font-family:Arial,sans-serif;all:unset}
.mai-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #dfe5ea;all:unset}
.mai-head img{width:38px;height:38px;border-radius:8px;all:unset}
.mai-title{flex:1;all:unset}
.mai-title h2{font-size:20px;margin:0;color:#2d75b9;all:unset}
.mai-title p{font-size:14px;margin:2px 0 0;color:#6c7883;all:unset}
.mai-icon-btn{border:0;background:transparent;color:#64717c;font-size:24px;padding:5px 10px;cursor:pointer;all:unset}
.mai-body{padding:18px;overflow:auto;all:unset}
.mai-search-row{display:flex;gap:8px;all:unset}
.mai-input{flex:1;min-width:0;border:1px solid #cad4dd;border-radius:7px;padding:11px 13px;font-size:16px;background:#fff;color:#263238;all:unset}
.mai-btn{border:1px solid #1976ed;background:#1976ed;color:#fff;border-radius:7px;padding:9px 16px;font-size:15px;cursor:pointer;all:unset}
.mai-btn.secondary{background:#fff;color:#53616d;border-color:#cad4dd;all:unset}
.mai-btn.danger{background:#fff;color:#b4233c;border-color:#e7b8c1;all:unset}
.mai-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;all:unset}
.mai-muted{color:#71808d;font-size:14px;all:unset}
.mai-results{display:flex;flex-direction:column;margin-top:12px;all:unset}
.mai-card{display:flex;gap:14px;padding:17px 4px;border-top:1px solid #e2e7eb;all:unset}
.mai-avatar{flex:0 0 42px;width:42px;height:42px;border-radius:50%;background:#2d75b9;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;all:unset}
.mai-content{min-width:0;flex:1;all:unset}
.mai-card h3{font-size:20px;margin:0 0 6px;all:unset}
.mai-card h3 a{color:#1473e6;text-decoration:none;all:unset}
.mai-snippet{font-size:15px;line-height:1.55;margin:0;color:#35434f;all:unset}
.mai-explain{font-size:14px;margin-top:8px;padding:8px;background:#f5f8fc;border-radius:4px;color:#36434f;all:unset}
.mai-meta{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;all:unset}
.mai-badge{display:inline-block;background:#e3f2fd;color:#1976ed;font-size:12px;padding:3px 8px;border-radius:3px;all:unset}
.mai-label{display:block;margin:12px 0;all:unset}
.mai-label input{margin-top:4px;all:unset}
.mai-key-row{display:flex;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #dfe5ea;all:unset}
.mai-key-row code{background:#f5f8fc;padding:4px 8px;border-radius:4px;font-size:12px;all:unset}
.mai-empty{text-align:center;padding:40px 20px;color:#71808d;all:unset}
.mai-history{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;all:unset}
.mai-history button{padding:6px 12px;border:1px solid #cad4dd;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;all:unset}
.mai-pager{display:flex;gap:6px;justify-content:center;margin-top:24px;padding-top:16px;border-top:1px solid #dfe5ea;all:unset}
.mai-pager .mai-btn{padding:6px 12px;font-size:14px;all:unset}
.mai-settings{all:unset}
.mai-settings h3{font-size:18px;margin:0 0 16px;color:#2d75b9;all:unset}`;
    document.head.appendChild(style);
  }

  function shell() {
    if (document.getElementById('mai-overlay')) return;
    state.lastFocus = document.activeElement;
    const overlay = document.createElement('div'); 
    overlay.id = 'mai-overlay'; 
    overlay.className = 'mai-overlay'; 
    overlay.innerHTML = `<section class="mai-dialog" role="dialog" aria-modal="true" aria-labelledby="mai-heading">
<header class="mai-head">
<img src="${ICON_URL}" alt="">
<div class="mai-title">
<h2 id="mai-heading">חיפוש AI במתמחים טופ</h2>
<p>חיפוש חכם בכל נושאי הפורום</p>
</div>
<button class="mai-icon-btn" id="mai-settings" title="הגדרות" aria-label="הגדרות">⚙</button>
<button class="mai-icon-btn" id="mai-close" title="סגירה" aria-label="סגירה">×</button>
</header>
<main class="mai-body" id="mai-body"></main>
</section>`;
    document.body.appendChild(overlay); 
    renderSearch();
    overlay.querySelector('#mai-close').addEventListener('click', close);
    overlay.querySelector('#mai-settings').addEventListener('click', renderSettings);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', keyboard);
  }

  function close() { state.controller?.abort(); document.getElementById('mai-overlay')?.remove(); document.removeEventListener('keydown', keyboard); state.lastFocus?.focus?.(); }
  
  function keyboard(event) { 
    if (event.key === 'Escape') close(); 
    if (event.key === 'Tab') { 
      const box = document.querySelector('.mai-dialog'); 
      const focusable = [...box.querySelectorAll('button,input,a[href]')].filter((el) => !el.disabled); 
      if (!focusable.length) return; 
      const first = focusable[0], last = focusable.at(-1); 
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } 
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } 
    } 
  }

  function renderSearch() {
    const body = document.getElementById('mai-body'); if (!body) return;
    const settings = storage.get(); const history = settings.history.slice(0, 7);
    body.innerHTML = `<form id="mai-form">
<div class="mai-search-row">
<input id="mai-query" class="mai-input" aria-label="מה תרצו למצוא" placeholder="לדוגמה: תוכנה לחסימת פרסומות באנדרואיד" value="${escapeHtml(state.query)}">
<button class="mai-btn" type="submit">חיפוש</button>
<button class="mai-btn secondary" type="button" id="mai-cancel" hidden>ביטול</button>
</div>
<div class="mai-tools">
<label><input id="mai-explain" type="checkbox" ${settings.explain ? 'checked' : ''}> הוסף הסבר AI קצר לכל תוצאה</label>
<span class="mai-muted" id="mai-status">Gemini משמש רק בדפדפן; המפתחות לא נשלחים לשרת</span>
</div>
<div class="mai-history">${history.map((q) => `<button type="button" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>
</form>
<div id="mai-results" class="mai-results"></div>`;
    body.querySelector('#mai-form').addEventListener('submit', (event) => { event.preventDefault(); run(body.querySelector('#mai-query').value); });
    body.querySelector('#mai-cancel').addEventListener('click', () => state.controller?.abort());
    body.querySelector('#mai-explain').addEventListener('change', (e) => { storage.update({ explain: e.target.checked }); });
    body.querySelectorAll('[data-query]').forEach((button) => button.addEventListener('click', () => { body.querySelector('#mai-query').value = button.dataset.query; run(button.dataset.query); }));
    body.querySelector('#mai-query').focus(); if (state.results.length) renderResults();
  }

  function renderSettings() {
    const body = document.getElementById('mai-body'); const settings = storage.get();
    body.innerHTML = `<div class="mai-settings">
<h3>הגדרות חיפוש</h3>
<label class="mai-label">הוספת מפתח Gemini<input class="mai-input" id="mai-new-key" type="password" dir="ltr" autocomplete="off" placeholder="AIza..."></label>
<button class="mai-btn" id="mai-add-key">הוספת מפתח</button>
<div id="mai-keys">${settings.keys.map((key, index) => `<div class="mai-key-row"><code>${escapeHtml(maskKey(key))}</code><button class="mai-btn danger" data-remove="${index}">מחיקה</button></div>`).join('') || '<p class="mai-muted">עדיין לא נשמרו מפתחות.</p>'}</div>
<div class="mai-tools">
<button class="mai-btn secondary" id="mai-back">חזרה</button>
</div>
<p class="mai-muted">המפתחות נשמרים ב-Tampermonkey בלבד ונשלחים ישירות ל-Gemini.<br>כתובת שרת: <code dir="ltr">${escapeHtml(DEFAULT_SERVER_URL)}</code></p>
</div>`;
    body.querySelector('#mai-add-key').addEventListener('click', () => { 
      const input = body.querySelector('#mai-new-key'); 
      const key = input.value.trim(); 
      if (!/^AIza[\w-]{20,}$/.test(key)) return alert('מבנה המפתח אינו תקין'); 
      storage.update({ keys: [...settings.keys, key] }); 
      renderSettings(); 
    });
    body.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { 
      const keys = storage.get().keys; 
      keys.splice(Number(button.dataset.remove), 1); 
      storage.update({ keys }); 
      renderSettings(); 
    }));
    body.querySelector('#mai-back').addEventListener('click', renderSearch);
  }

  async function run(rawQuery) {
    const query = rawQuery.trim(); if (!query || state.busy) return;
    const settings = storage.get(); if (!settings.keys.length) return renderSettings();
    state.busy = true; state.query = query; state.page = 1; state.controller = new AbortController();
    const body = document.getElementById('mai-body'); const results = body.querySelector('#mai-results'); const cancel = body.querySelector('#mai-cancel'); const status = body.querySelector('#mai-status');
    cancel.hidden = false; results.innerHTML = '<div class="mai-skeleton"></div><div class="mai-skeleton"></div><div class="mai-skeleton"></div>'; status.textContent = 'Gemini מתכנן את החיפוש…';
    try {
      const cacheKey = query.toLowerCase(); const cached = settings.cache[cacheKey];
      if (cached && Date.now() - cached.at < CACHE_TTL) { state.results = cached.results; state.plans = cached.plans; renderResults(); status.textContent = 'התוצאות נטענו מהמטמון המקומי'; return; }
      const manager = new KeyManager(settings.keys); const plan = await planSearch(query, manager, state.controller.signal);
      const queries = [...new Set([query, ...(plan.queries || []), ...(plan.possibleTitles || [])])].filter(Boolean).slice(0, 12); state.plans = queries;
      status.textContent = `מחפש ${queries.length} וריאציות במתמחים טופ…`;
      let page = 1, staleRounds = 0; const merged = new Map();
      while (page <= 3 && staleRounds < 2) {
        const response = await serverSearch(queries, page, state.controller.signal); const before = merged.size;
        response.results.forEach((item) => merged.set(item.url, item)); staleRounds = merged.size === before ? staleRounds + 1 : 0;
        if (!response.meta.hasMore) break; page = response.meta.nextPage;
      }
      state.results = [...merged.values()].sort((a, b) => b.score - a.score);
      if (settings.explain) { status.textContent = 'Gemini מוסיף הסברים לתוצאות…'; state.results = await explainResults(query, state.results, manager, state.controller.signal); }
      const fresh = storage.get(); const history = [query, ...fresh.history.filter((item) => item !== query)].slice(0, 10); const cache = { ...fresh.cache, [cacheKey]: { at: Date.now(), results: state.results, plans: queries } };
      Object.keys(cache).forEach((key) => { if (Date.now() - cache[key].at > CACHE_TTL) delete cache[key]; }); storage.update({ history, cache, explain: body.querySelector('#mai-explain').checked });
      renderResults(); status.textContent = `נמצאו ${state.results.length} תוצאות ייחודיות`;
    } catch (error) {
      if (error.name === 'AbortError') { results.innerHTML = '<div class="mai-empty">החיפוש בוטל.</div>'; status.textContent = 'החיפוש בוטל'; }
      else { results.innerHTML = `<div class="mai-empty"><strong>${escapeHtml(error.message)}</strong><br><button class="mai-btn" id="mai-retry">ניסיון חוזר</button></div>`; results.querySelector('#mai-retry').addEventListener('click', () => run(query)); status.textContent = 'אירעה שגיאה'; }
    } finally { state.busy = false; cancel.hidden = true; }
  }

  function renderResults() {
    const container = document.getElementById('mai-results'); if (!container) return;
    if (!state.results.length) { container.innerHTML = '<div class="mai-empty"><strong>לא נמצאו תוצאות</strong><p>נסו לנסח את הבקשה אחרת או להרחיב את מילות החיפוש.</p></div>'; return; }
    const totalPages = Math.ceil(state.results.length / PAGE_SIZE); state.page = Math.min(state.page, totalPages); const start = (state.page - 1) * PAGE_SIZE;
    const cards = state.results.slice(start, start + PAGE_SIZE).map((item) => `<article class="mai-card"><div class="mai-avatar" aria-hidden="true">${escapeHtml(item.title.trim().charAt(0) || 'מ')}</div><div class="mai-content"><h3><a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a></h3><p class="mai-snippet">${escapeHtml(item.snippet || 'לחצו לפתיחת הנושא במתמחים טופ')}</p>${item.explanation ? `<div class="mai-explain"><strong>הסבר AI:</strong> ${escapeHtml(item.explanation)}</div>` : ''}<div class="mai-meta"><span class="mai-badge">ציון ${Math.round(item.score)}</span>${(item.sources || []).map((source) => `<span class="mai-badge">${escapeHtml(source)}</span>`).join('')}</div></div></article>`).join('');
    container.innerHTML = `${cards}<nav class="mai-pager" aria-label="עמודי תוצאות">${Array.from({ length: totalPages }, (_, i) => `<button class="mai-btn ${i + 1 === state.page ? '' : 'secondary'} mai-page" data-page="${i + 1}">${i + 1}</button>`).join('')}</nav>`;
    container.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => { state.page = Number(button.dataset.page); renderResults(); document.querySelector('.mai-body').scrollTo({ top: 0, behavior: 'smooth' }); }));
  }

  function enhanceSearchLink() {
    const link = document.querySelector('a.advanced-search-link'); if (!link || link.dataset.maiReady) return;
    link.dataset.maiReady = 'true'; const oldIcon = link.querySelector('i.fa.fa-gears, i.fa-gears');
    if (oldIcon) { const image = document.createElement('img'); image.className = 'mai-icon'; image.src = ICON_URL; image.alt = ''; oldIcon.replaceWith(image); }
    link.setAttribute('title', 'חיפוש AI מתקדם'); link.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); shell(); });
  }

  if (!document.getElementById('mai-styles')) styles(); 
  enhanceSearchLink();
  let scheduled = false; 
  new MutationObserver(() => { 
    if (scheduled) return; 
    scheduled = true; 
    requestAnimationFrame(() => { 
      scheduled = false; 
      enhanceSearchLink(); 
    }); 
  }).observe(document.body, { childList: true, subtree: true });
})();
