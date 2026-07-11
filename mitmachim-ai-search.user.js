// ==UserScript==
// @name         חיפוש AI למתמחים טופ
// @namespace    https://mitmachim.top/
// @version      1.0.0
// @description  חיפוש סמנטי מוטמע במתמחים טופ, עם Gemini מקומי בדפדפן
// @author       מייבין במקצת
// @match        https://mitmachim.top/*
// @match        https://www.mitmachim.top/*
// @icon         https://hebbkx1anhila5yf.public.blob.vercel-storage.com/gpt-image-2_%D7%94%D7%A2%D7%9C%D7%99%D7%AA%D7%99_%D7%9C%D7%9A_%D7%AA%D7%9E%D7%95%D7%A0%D7%94%D7%99%D7%A9_%D7%91%D7%94_%D7%A1%D7%99%D7%9E%D7%95%D7%9F_%D7%A9%D7%9C_%D7%94%D7%90%D7%99%D7%99%D7%A7%D7%95%D7%9F_%D7%A9%D7%9C_%D7%90%D7%AA%D7%A8-0-xJNfbiCLQi0BHTD9KclXqR5F06BgBg.jpg
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ICON_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/gpt-image-2_%D7%94%D7%A2%D7%9C%D7%99%D7%AA%D7%99_%D7%9C%D7%9A_%D7%AA%D7%9E%D7%95%D7%A0%D7%94%D7%99%D7%A9_%D7%91%D7%94_%D7%A1%D7%99%D7%9E%D7%95%D7%9F_%D7%A9%D7%9C_%D7%94%D7%90%D7%99%D7%99%D7%A7%D7%95%D7%9F_%D7%A9%D7%9C_%D7%90%D7%AA%D7%A8-0-xJNfbiCLQi0BHTD9KclXqR5F06BgBg.jpg';
  const TARGET_HOST = 'mitmachim.top';
  const GEMINI_MODEL = 'gemini-3.1-flash-lite';
  const STORE_VERSION = 1;
  const CACHE_TTL = 30 * 60 * 1000;
  const PAGE_SIZE = 12;
  const state = { controller: null, results: [], page: 1, query: '', plans: [], busy: false, lastFocus: null, originalContent: null };
  const AI_SEARCH_PATH = '/search';
  const AI_SEARCH_PARAM = 'ai';

  function isAiSearchUrl(url = location.href) {
    const u = new URL(url, location.origin);
    return u.pathname === AI_SEARCH_PATH && u.searchParams.has(AI_SEARCH_PARAM);
  }

  function buildAiSearchUrl(query) {
    const u = new URL(AI_SEARCH_PATH, location.origin);
    u.searchParams.set(AI_SEARCH_PARAM, '');
    if (query) u.searchParams.set('q', query);
    return u.pathname + u.search;
  }

  function getContentEl() { return document.getElementById('content'); }

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
          if (response.status >= 400) {
            let errMsg = `שגיאת Gemini ${response.status}`;
            try {
              const errBody = JSON.parse(response.responseText);
              const detail = errBody?.error?.message;
              if (detail) errMsg += `: ${detail}`;
            } catch (_) {}
            if ([429].includes(response.status)) errMsg = `חריגה ממכסת הבקשות (429) — נסה מפתח אחר`;
            if ([403].includes(response.status)) errMsg = `הגישה נדחתה (403) — בדוק שה-API מופעל ב-Google Cloud`;
            throw new Error(errMsg);
          }
          this.index = (index + 1) % this.keys.length; GM_setValue('mitmachim-ai-key-index', this.index);
          const payload = JSON.parse(response.responseText);
          return cleanJson(payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '');
        } catch (error) { lastError = error; await new Promise((r) => setTimeout(r, Math.min(1800, 300 * 2 ** attempt))); }
      }
      throw lastError || new Error('כל מפתחות Gemini נכשלו');
    }
  }

  async function planSearch(query, keyManager, signal) {
    return keyManager.call(`אתה מתכנן חיפוש בפורום הטכנולוגיה החרדי mitmachim.top.
עבור השאלה: "${query}"
החזר JSON בלבד בפורמט הבא, ללא טקסט נוסף:
{"queries":["2-4 מילות מפתח קצרות בעברית שצפויות להופיע בכותרות פוסטים קשורים לשאלה — בלי site:, בלי משפטים שלמים"],"possibleTitles":["עד 3 כותרות ספציפיות שעשויות להיות בפורום"],"synonyms":["עד 5 מילים נרדפות לנושא הראשי בלבד"]}
חשוב: הקפד שכל השאילתות קשורות ישירות לנושא הספציפי של השאלה. אל תוסיף נושאים כלליים לא-קשורים. אל תענה על השאלה עצמה.`, signal);
  }

  async function filterRelevantResults(query, results, keyManager, signal) {
    if (!results.length) return results;
    const compact = results.slice(0, 40).map((r, i) => ({ i, title: r.title, snippet: (r.snippet || '').slice(0, 120) })).map(JSON.stringify).join('\n');
    try {
      const data = await keyManager.call(`השאלה: "${query}".
להלן רשימת תוצאות חיפוש מהפורום. סנן רק את התוצאות שקשורות ישירות לשאלה. התעלם מתוצאות שמזכירות את מילות החיפוש בצורה אגבית בלבד.
החזר JSON בלבד: {"relevant":[מספרי האינדקסים של התוצאות הרלוונטיות בלבד, לדוגמה: 0,2,5]}
${compact}`, signal);
      const relevant = new Set((data.relevant || []).map(Number));
      if (!relevant.size) return results; // במקרה של כשלון — לא לסנן
      return results.filter((_, i) => i >= 40 || relevant.has(i));
    } catch (_) { return results; }
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

  // ─── Search engine (runs entirely in the browser, no server needed) ──────────

  function tokenize(text) {
    return new Set((text || '').toLowerCase().match(/[\w\u0590-\u05ff]{2,}/g) || []);
  }

  function canonicalKey(url) {
    const m = url.match(/\/post\/(\d+)/);
    return m ? `post:${m[1]}` : url.toLowerCase().replace(/\/+$/, '');
  }

  function relevanceScore(item, queries) {
    const titleTok = tokenize(item.title);
    const snippetTok = tokenize(item.snippet);
    let score = 0, matchedQueries = 0;
    for (const q of queries) {
      const qt = tokenize(q); if (!qt.size) continue;
      const titleOverlap = [...qt].filter(w => titleTok.has(w)).length / qt.size;
      const snippetOverlap = [...qt].filter(w => snippetTok.has(w)).length / qt.size;
      if (titleOverlap || snippetOverlap) matchedQueries++;
      score += titleOverlap * 55 + snippetOverlap * 24;
      if (item.title.toLowerCase().includes(q.toLowerCase())) score += 18;
    }
    if (item.url.includes('/post/')) score += 8;
    score += Math.min(matchedQueries, 4) * 7;
    return Math.round(score * 100) / 100;
  }

  function mergeResults(groups, queries) {
    const merged = new Map();
    const queryHits = new Map();
    for (const [query, results] of groups) {
      for (const r of results) {
        const key = canonicalKey(r.url);
        if (!queryHits.has(key)) queryHits.set(key, new Set());
        queryHits.get(key).add(query);
        if (!merged.has(key)) {
          merged.set(key, { ...r, sources: [r.source] });
        } else {
          const cur = merged.get(key);
          if ((r.snippet || '').length > (cur.snippet || '').length) cur.snippet = r.snippet;
          if (!cur.sources.includes(r.source)) cur.sources.push(r.source);
        }
      }
    }
    const out = [];
    for (const [key, item] of merged) {
      const hits = queryHits.get(key) || new Set();
      item.matchedQueries = [...hits].sort();
      item.score = relevanceScore(item, queries) + Math.min(hits.size, 4) * 4;
      out.push(item);
    }
    return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }

  // Searches mitmachim.top NodeBB /search directly from the browser.
  // Same-origin fetch => user session/cookies included automatically.
  async function forumSearch(query, page) {
    try {
      const res = await fetch(`/search?term=${encodeURIComponent(query)}&in=titlesposts&matchWords=all&showAs=posts&sortBy=relevance&sortDirection=desc&page=${page}`, { credentials: 'same-origin' });
      if (!res.ok) return [];
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const seen = new Set(); const found = [];
      // תוצאות החיפוש נמצאות ב-#results > ul > li[component="post"]
      for (const li of doc.querySelectorAll('#results li[component="post"]')) {
        // כותרת הנושא
        const titleEl = li.querySelector('a.topic-title');
        if (!titleEl) continue;
        const title = titleEl.textContent.replace(/\s+/g, ' ').trim();
        const href = titleEl.getAttribute('href') || '';
        // ה-URL הוא /post/<pid> — נשמור אותו כמות שהוא
        const m = href.match(/\/post\/(\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        // תוכן הפוסט
        const contentEl = li.querySelector('[component="post/content"]');
        const snippet = contentEl ? contentEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        // שם משתמש
        const authorEl = li.querySelector('.post-author a.fw-semibold');
        const author = authorEl ? authorEl.textContent.trim() : '';
        // תאריך
        const timeEl = li.querySelector('.timeago');
        const date = timeEl ? (timeEl.getAttribute('title') || timeEl.textContent.trim()).replace(/^(\d+)\s+(ב\S+)\s+(\d+),\s*(.+)$/, '$1 $2 $3') : '';
        // קטגוריה
        const catEl = li.querySelector('[component="topic/category"]');
        const category = catEl ? catEl.textContent.replace(/\s+/g, ' ').trim() : '';
        found.push({
          title,
          url: new URL(href, location.origin).href,
          snippet,
          author,
          date,
          category,
          source: 'מתמחים טופ'
        });
        if (found.length >= 40) break;
      }
      return found;
    } catch (err) { console.warn('[mitmachim-ai-search] forum search failed', err); return []; }
  }

  // Searches DuckDuckGo via GM_xmlhttpRequest (cross-origin).
  async function duckduckgoSearch(query, page, signal) {
    try {
      const scoped = `site:${TARGET_HOST} ${query}`;
      const offset = Math.max(0, (page - 1) * 30);
      const res = await request({ method: 'POST', url: 'https://html.duckduckgo.com/html/',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html', 'Accept-Language': 'he-IL,he;q=0.9' },
        data: `q=${encodeURIComponent(scoped)}&s=${offset}&dc=${offset + 1}`, signal });
      if (res.status !== 200) return [];
      const doc = new DOMParser().parseFromString(res.responseText, 'text/html');
      const found = [];
      for (const el of doc.querySelectorAll('.result')) {
        const a = el.querySelector('.result__a'); if (!a) continue;
        const rawHref = decodeURIComponent(a.getAttribute('href') || '');
        const uddg = new URLSearchParams(rawHref.split('?')[1] || '').get('uddg') || rawHref;
        try {
          const parsed = new URL(uddg);
          if (parsed.hostname.replace(/^www\./, '') !== TARGET_HOST) continue;
          // קבל רק קישורים לפוסטים (/post/) או לנושאים (/topic/)
          if (!parsed.pathname.match(/\/(post|topic)\//)) continue;
          const snippetEl = el.querySelector('.result__snippet');
          found.push({
            title: a.textContent.trim(),
            url: `https://${TARGET_HOST}${parsed.pathname}${parsed.search}`,
            snippet: snippetEl ? snippetEl.textContent.trim() : '',
            author: '',
            date: '',
            category: '',
            source: 'DuckDuckGo'
          });
        } catch { continue; }
      }
      return found;
    } catch (err) { console.warn('[mitmachim-ai-search] DuckDuckGo failed', err); return []; }
  }

  // Main: runs both sources in parallel per query, merges and scores locally.
  async function localSearch(queries, page, signal) {
    const groups = await Promise.all(queries.map(async (q) => {
      const [forum, ddg] = await Promise.all([forumSearch(q, page), duckduckgoSearch(q, page, signal)]);
      return [q, [...forum, ...ddg]];
    }));
    const results = mergeResults(groups, queries);
    return { results, meta: { queries, count: results.length, page, hasMore: false, nextPage: null } };
  }


  function styles() {
    const style = document.createElement('style');
    style.id = 'mai-styles';
    style.textContent = `
.mai-icon{width:20px;height:20px;object-fit:cover;border-radius:50%;display:block}
.mai-icon-heading{width:24px;height:24px}
.mai-explain{font-size:14px;margin-top:8px;padding:8px;background:#f5f8fc;border-radius:4px;color:#36434f}
.mai-empty{text-align:center;padding:40px 20px;color:#71808d}
.mai-skeleton{height:70px;border-radius:6px;margin-bottom:10px;background:linear-gradient(90deg,#eef1f4 25%,#e4e8ec 37%,#eef1f4 63%);background-size:400% 100%;animation:mai-shimmer 1.4s ease infinite}
@keyframes mai-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
.mai-history-panel{display:none;flex-wrap:wrap;gap:8px;margin-top:8px}
.mai-history-panel.open{display:flex}`;
    document.head.appendChild(style);
  }

  function shell() {
    const contentEl = getContentEl();
    if (!contentEl || contentEl.dataset.maiActive) return;
    if (state.originalContent === null) state.originalContent = contentEl.innerHTML;
    contentEl.dataset.maiActive = 'true';
    const urlQuery = new URL(location.href).searchParams.get('q');
    if (urlQuery) state.query = urlQuery;
    contentEl.innerHTML = `<div class="search flex-fill" id="mai-root">
<div class="d-flex flex-column flex-md-row">
<div class="flex-shrink-0 pe-2 border-end-md text-sm mb-3" style="flex-basis: 240px!important;">
<div class="nav sticky-md-top d-flex flex-row flex-md-column flex-wrap gap-3 pe-md-3" style="top: 1rem; z-index: 1;">
<h2 class="fw-semibold tracking-tight mb-0 d-flex align-items-center gap-2"><img class="mai-icon mai-icon-heading" src="${ICON_URL}" alt="">חיפוש AI</h2>
<p class="text-sm text-muted mb-0">חיפוש חכם בכל נושאי הפורום, מבוסס Gemini</p>
<button type="button" class="btn btn-light btn-sm border w-100" id="mai-settings-btn">הגדרות מפתחות Gemini</button>
<a href="https://mitmachim.top/search" class="btn btn-ghost btn-sm border w-100" id="mai-native-link">חיפוש רגיל בפורום</a>
</div>
</div>
<div class="flex-grow-1 ps-md-2 ps-lg-5" style="min-width:0;">
<div id="mai-body"></div>
</div>
</div>
</div>`;
    renderSearch();
    contentEl.querySelector('#mai-settings-btn').addEventListener('click', renderSettings);
    contentEl.querySelector('#mai-native-link').addEventListener('click', (event) => {
      event.preventDefault();
      state.controller?.abort();
      const contentEl2 = getContentEl();
      if (contentEl2 && contentEl2.dataset.maiActive) {
        if (state.originalContent !== null) contentEl2.innerHTML = state.originalContent;
        delete contentEl2.dataset.maiActive;
      }
      location.href = '/search';
    });
    if (urlQuery) run(urlQuery);
  }

  function close(skipHistory) {
    state.controller?.abort();
    const contentEl = getContentEl();
    if (contentEl && contentEl.dataset.maiActive) {
      if (state.originalContent !== null) contentEl.innerHTML = state.originalContent;
      delete contentEl.dataset.maiActive;
    }
    if (!skipHistory && isAiSearchUrl()) {
      if (state.cameFromHistory) history.back();
      else history.pushState({}, '', location.pathname === AI_SEARCH_PATH ? '/' : location.pathname);
    }
  }

  function navigateToAiSearch(query) {
    state.cameFromHistory = false;
    history.pushState({ maiSearch: true }, '', buildAiSearchUrl(query));
    shell();
  }

  window.addEventListener('popstate', () => {
    if (isAiSearchUrl()) { state.cameFromHistory = true; shell(); }
    else close(true);
  });

  function keyboard(event) {
    if (event.key === 'Escape') close();
  }

  function renderSearch() {
    const body = document.getElementById('mai-body'); if (!body) return;
    const settings = storage.get(); const recentQueries = settings.history.slice(0, 7);
    body.innerHTML = `<form id="mai-form" class="d-flex flex-column gap-3">
<div class="d-flex flex-wrap gap-2">
<input id="mai-query" class="form-control fw-semibold py-2 ps-2 pe-3" style="min-width:0;flex:1 1 260px;" aria-label="מה תרצו למצוא" placeholder="לדוגמה: תוכנה לחסימת פרסומות באנדרואיד" value="${escapeHtml(state.query)}">
<button class="btn btn-primary fw-semibold px-3" type="submit">חיפוש</button>
<button class="btn btn-light border" type="button" id="mai-cancel" hidden>ביטול</button>
</div>
<div class="d-flex flex-wrap gap-2 align-items-center justify-content-between text-sm">
<label class="d-flex align-items-center gap-2"><input id="mai-explain" type="checkbox" ${settings.explain ? 'checked' : ''}> הוסף הסבר AI קצר לכל תוצאה</label>
<span class="text-muted" id="mai-status">Gemini משמש רק בדפדפן; המפתחות לא נשלחים לשרת</span>
</div>
${recentQueries.length ? `
<div>
  <div class="d-flex align-items-center gap-2">
    <button type="button" class="btn btn-light btn-sm border" id="mai-history-toggle">
      <i class="fa fa-history"></i> היסטוריית חיפושים (${recentQueries.length})
    </button>
    <button type="button" class="btn btn-light btn-sm border text-danger" id="mai-history-clear">מחק הכל</button>
  </div>
  <div class="mai-history-panel" id="mai-history-panel">
    ${recentQueries.map((q) => `<div class="d-flex align-items-center gap-1">
      <button type="button" class="btn btn-light btn-sm border" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>
      <button type="button" class="btn btn-light btn-sm border text-danger px-1" data-remove-query="${escapeHtml(q)}" title="מחק">×</button>
    </div>`).join('')}
  </div>
</div>` : ''}
</form>
<div id="mai-results" class="mt-3"></div>`;

    body.querySelector('#mai-form').addEventListener('submit', (event) => { event.preventDefault(); const q = body.querySelector('#mai-query').value; if (isAiSearchUrl()) history.replaceState({ maiSearch: true }, '', buildAiSearchUrl(q)); run(q); });
    body.querySelector('#mai-cancel').addEventListener('click', () => state.controller?.abort());
    body.querySelector('#mai-explain').addEventListener('change', (e) => { storage.update({ explain: e.target.checked }); });

    const historyToggle = body.querySelector('#mai-history-toggle');
    const historyPanel = body.querySelector('#mai-history-panel');
    if (historyToggle && historyPanel) {
      historyToggle.addEventListener('click', () => historyPanel.classList.toggle('open'));
    }
    const historyClear = body.querySelector('#mai-history-clear');
    if (historyClear) {
      historyClear.addEventListener('click', () => { storage.update({ history: [] }); renderSearch(); });
    }
    body.querySelectorAll('[data-remove-query]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const q = btn.dataset.removeQuery;
        const fresh = storage.get();
        storage.update({ history: fresh.history.filter((h) => h !== q) });
        renderSearch();
        // שמור את הפאנל פתוח אחרי מחיקה
        const panel = body.querySelector('#mai-history-panel');
        if (panel) panel.classList.add('open');
      });
    });

    body.querySelectorAll('[data-query]').forEach((button) => button.addEventListener('click', () => {
      body.querySelector('#mai-query').value = button.dataset.query;
      if (historyPanel) historyPanel.classList.remove('open');
      if (isAiSearchUrl()) history.replaceState({ maiSearch: true }, '', buildAiSearchUrl(button.dataset.query));
      run(button.dataset.query);
    }));
    body.querySelector('#mai-query').focus(); if (state.results.length) renderResults();
  }

  function renderSettings() {
    const body = document.getElementById('mai-body'); const settings = storage.get();
    body.innerHTML = `<div class="d-flex flex-column gap-3">
<h3 class="fw-semibold tracking-tight mb-0">הגדרות חיפוש AI</h3>
<label class="d-flex flex-column gap-1 text-sm">הוספת מפתח Gemini
<input class="form-control py-2 ps-2 pe-3" id="mai-new-key" type="password" dir="ltr" autocomplete="off" placeholder="AIza...">
</label>
<button class="btn btn-primary fw-semibold align-self-start px-3" id="mai-add-key">הוספת מפתח</button>
<div id="mai-keys" class="d-flex flex-column gap-2">${settings.keys.map((key, index) => `<div class="d-flex align-items-center gap-2 border-top pt-2"><code class="text-sm">${escapeHtml(maskKey(key))}</code><button class="btn btn-light btn-sm border text-danger" data-remove="${index}">מחיקה</button></div>`).join('') || '<p class="text-muted text-sm mb-0">עדיין לא נשמרו מפתחות.</p>'}</div>
<div>
<button class="btn btn-light border" id="mai-back">חזרה</button>
</div>
<p class="text-muted text-sm mb-0">המפתחות נשמרים ב-Tampermonkey בלבד ונשלחים ישירות ל-Gemini. החיפוש מתבצע כולו בדפדפן, ללא שרת חיצוני.</p>
</div>`;
    body.querySelector('#mai-add-key').addEventListener('click', () => {
      const input = body.querySelector('#mai-new-key');
      const key = input.value.trim();
      if (key.length < 8) return alert('המפתח קצר מדי — נסה שוב');
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
        const response = await localSearch(queries, page, state.controller.signal); const before = merged.size;
        response.results.forEach((item) => merged.set(item.url, item));
        staleRounds = merged.size === before ? staleRounds + 1 : 0;
        page++;
      }
      state.results = [...merged.values()].sort((a, b) => b.score - a.score);
      status.textContent = 'Gemini מסנן תוצאות רלוונטיות…';
      state.results = await filterRelevantResults(query, state.results, manager, state.controller.signal);
      if (settings.explain) { status.textContent = 'Gemini מוסיף הסברים לתוצאות…'; state.results = await explainResults(query, state.results, manager, state.controller.signal); }
      const fresh = storage.get(); const historyList = [query, ...fresh.history.filter((item) => item !== query)].slice(0, 10); const cache = { ...fresh.cache, [cacheKey]: { at: Date.now(), results: state.results, plans: queries } };
      Object.keys(cache).forEach((key) => { if (Date.now() - cache[key].at > CACHE_TTL) delete cache[key]; }); storage.update({ history: historyList, cache, explain: body.querySelector('#mai-explain').checked });
      renderResults(); status.textContent = `נמצאו ${state.results.length} תוצאות ייחודיות`;
    } catch (error) {
      if (error.name === 'AbortError') { results.innerHTML = '<div class="mai-empty">החיפוש בוטל.</div>'; status.textContent = 'החיפוש בוטל'; }
      else { results.innerHTML = `<div class="mai-empty"><strong>${escapeHtml(error.message)}</strong><br><button class="btn btn-primary btn-sm mt-2" id="mai-retry">ניסיון חוזר</button></div>`; results.querySelector('#mai-retry').addEventListener('click', () => run(query)); status.textContent = 'אירעה שגיאה'; }
    } finally { state.busy = false; cancel.hidden = true; }
  }

  function renderResults() {
    const container = document.getElementById('mai-results'); if (!container) return;
    if (!state.results.length) { container.innerHTML = '<div class="mai-empty"><strong>לא נמצאו תוצאות</strong><p>נסו לנסח את הבקשה אחרת או להרחיב את מילות החיפוש.</p></div>'; return; }
    const totalPages = Math.ceil(state.results.length / PAGE_SIZE); state.page = Math.min(state.page, totalPages); const start = (state.page - 1) * PAGE_SIZE;
    const cards = state.results.slice(start, start + PAGE_SIZE).map((item) => `<li class="posts-list-item" component="post">
<hr>
<a class="topic-title fw-semibold fs-5 mb-2 text-reset text-break d-block" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
<i class="fa fa-book text-muted" title="נושא"></i> ${escapeHtml(item.title)}
</a>
<div class="post-body d-flex flex-column gap-1 mb-2">
<div class="d-flex gap-2 post-info text-sm align-items-center">
${item.author ? `<div class="post-author d-flex align-items-center gap-1">
<span class="avatar not-responsive avatar-rounded" style="--avatar-size:16px;width:16px;height:16px;border-radius:50%;background-color:#1976ed;color:#fff;font-size:10px;display:inline-flex;align-items:center;justify-content:center;">${escapeHtml((item.author || 'מ').trim().charAt(0))}</span>
<span class="fw-semibold">${escapeHtml(item.author)}</span>
</div>` : ''}
${item.date ? `<span class="timeago text-muted lh-1">${escapeHtml(item.date)}</span>` : ''}
</div>
<div class="content text-sm text-break" component="post/content">
<p dir="auto">${escapeHtml(item.snippet || 'לחצו לפתיחת הנושא במתמחים טופ')}</p>
${item.explanation ? `<p dir="auto" class="mai-explain"><strong>הסבר AI:</strong> ${escapeHtml(item.explanation)}</p>` : ''}
</div>
</div>
<div class="mb-3 d-flex flex-wrap gap-1 w-100">
${item.category ? `<a class="badge px-1 text-truncate text-decoration-none border" style="max-width:70vw;">${escapeHtml(item.category)}</a>` : ''}
${(item.sources || []).map((source) => `<span class="badge px-1 text-truncate border text-sm">${escapeHtml(source)}</span>`).join('')}
</div>
</li>`).join('');
    container.innerHTML = `<ul component="posts" class="posts-list list-unstyled">${cards}</ul><nav class="mai-pager d-flex gap-2 justify-content-center mt-3 pt-3 border-top" aria-label="עמודי תוצאות">${Array.from({ length: totalPages }, (_, i) => `<button class="btn btn-sm ${i + 1 === state.page ? 'btn-primary' : 'btn-light border'} mai-page" data-page="${i + 1}">${i + 1}</button>`).join('')}</nav>`;
    container.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => { state.page = Number(button.dataset.page); renderResults(); getContentEl()?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  }

  function enhanceSearchLink() {
    document.querySelectorAll('a.advanced-search-link').forEach((link) => {
      if (link.dataset.maiReady) return;
      link.dataset.maiReady = 'true';
      const oldIcon = link.querySelector('i.fa.fa-gears, i.fa-gears');
      if (oldIcon) { const image = document.createElement('img'); image.className = 'mai-icon'; image.src = ICON_URL; image.alt = ''; oldIcon.replaceWith(image); }
      link.setAttribute('title', 'חיפוש AI מתקדם'); link.setAttribute('href', buildAiSearchUrl());
      link.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); navigateToAiSearch(); });
    });
  }

  if (!document.getElementById('mai-styles')) styles();
  enhanceSearchLink();
  if (isAiSearchUrl()) { state.cameFromHistory = true; shell(); }
  let scheduled = false;
  new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.addedNodes.length)) return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      document.querySelectorAll('a.advanced-search-link').forEach((link) => {
        if (!document.contains(link)) delete link.dataset.maiReady;
      });
      enhanceSearchLink();
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
