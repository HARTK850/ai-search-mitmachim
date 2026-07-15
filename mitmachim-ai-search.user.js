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
// @connect      generativelanguage.googleapis.com
// @connect      mitmachim.top
// @connect      html.duckduckgo.com
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

  let maiSpoilerSeq = 0;
  // ממיר תוכן פוסט מהפורום (HTML גולמי) לתצוגה מקדימה בטוחה,
  // תוך שמירה על תיוגי משתמשים, ספוילרים, אימוג'ים ותמונות — כמו בעמוד החיפוש עצמו.
  function sanitizePostHtml(sourceEl) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = sourceEl.innerHTML;

    // תיוגי משתמשים (@שם) -> קישור לפרופיל
    wrapper.querySelectorAll('a.plugin-mentions-a, a[href*="/user/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      let url = href;
      try { url = new URL(href, location.origin).href; } catch (_) {}
      const text = a.textContent.trim();
      const span = document.createElement('a');
      span.className = 'mai-mention';
      span.href = url;
      span.target = '_blank';
      span.rel = 'noopener';
      span.textContent = text || '@';
      a.replaceWith(span);
    });

    // ספוילרים -> כפתור פתיחה/סגירה עצמאי (לא תלוי ב-Bootstrap collapse של האתר המארח)
    wrapper.querySelectorAll('.extended-markdown-spoiler').forEach((button) => {
      const targetSel = button.getAttribute('data-bs-target');
      const targetId = targetSel ? targetSel.replace('#', '') : '';
      const collapseEl = targetId ? wrapper.querySelector(`#${CSS.escape(targetId)}`) : button.nextElementSibling;
      const bodyHtml = collapseEl ? collapseEl.innerHTML : '';
      maiSpoilerSeq += 1;
      const id = `mai-spoiler-${maiSpoilerSeq}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mai-spoiler-btn';
      btn.dataset.spoilerToggle = id;
      btn.innerHTML = '<i class="fa fa-eye"></i> ספוילר';
      const body = document.createElement('div');
      body.className = 'mai-spoiler-body';
      body.id = id;
      body.innerHTML = bodyHtml;
      button.replaceWith(btn, body);
      if (collapseEl && collapseEl.parentNode) collapseEl.remove();
    });

    // תמונות ואימוג'ים — מציבים class לעיצוב, שאר התמונות מוגבלות לרוחב
    wrapper.querySelectorAll('img').forEach((img) => {
      if (img.classList.contains('emoji')) {
        img.classList.add('mai-post-emoji');
      } else {
        img.classList.add('mai-post-img');
        img.removeAttribute('style');
      }
      img.removeAttribute('loading');
    });

    // קישורים רגילים (לא תיוגים) -> נפתחים בטאב חדש, בלי לעקוב
    wrapper.querySelectorAll('a:not(.mai-mention)').forEach((a) => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow ugc';
    });

    // הסרת אלמנטים/תכונות מסוכנים (script, event handlers וכו')
    wrapper.querySelectorAll('script, style, iframe, object, embed').forEach((el) => el.remove());
    wrapper.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });

    return wrapper.innerHTML.trim();
  }
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
          if (response.status === 400) {
            let msg = 'מפתח Gemini — בקשה לא תקינה (400)';
            try { const e = JSON.parse(response.responseText); msg = e?.error?.message || msg; } catch (_) {}
            throw new Error(msg);
          }
          if (response.status === 401 || response.status === 403) {
            let msg = 'מפתח Gemini אינו תקין או אין הרשאה (403)';
            try { const e = JSON.parse(response.responseText); msg = e?.error?.message || msg; } catch (_) {}
            throw new Error(msg);
          }
          if (response.status === 429) throw new Error('Gemini — חרגתם ממגבלת הקצב, נסו שוב עוד רגע');
          if (response.status >= 500) throw new Error(`Gemini שגיאת שרת (${response.status})`);
          if (response.status >= 400) throw new Error(`Gemini שגיאה (${response.status})`);
          this.index = (index + 1) % this.keys.length; GM_setValue('mitmachim-ai-key-index', this.index);
          const payload = JSON.parse(response.responseText);
          return cleanJson(payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '');
        } catch (error) { lastError = error; await new Promise((r) => setTimeout(r, Math.min(1800, 300 * 2 ** attempt))); }
      }
      throw lastError || new Error('כל מפתחות Gemini נכשלו');
    }
  }

  async function planSearch(query, keyManager, signal) {
    return keyManager.call(
      `אתה עוזר לחיפוש בפורום הטכנולוגיה החרדי mitmachim.top.
המשימה שלך: צור שאילתות חיפוש קצרות ומדויקות לאיתור אשכולות קיימים בפורום שעונים על השאלה: "${query}"

כללים חשובים:
- החזר ONLY JSON, ללא הסברים
- queries: 3-6 שאילתות עבריות קצרות (2-4 מילים כל אחת), מגוונות, ישירות לנושא
- possibleTitles: עד 4 כותרות אשכול שסביר למצוא בפורום
- אל תמציא מידע, אל תענה על השאלה, רק תכנן חיפוש
- שאילתות צריכות להיות מילות מפתח בלבד, לא משפטים
פורמט: {"queries":["..."],"possibleTitles":["..."]}`, signal);
  }

  async function explainResults(query, results, keyManager, signal, onProgress, onItemExplained) {
    if (!results.length) return results;
    const BATCH_SIZE = 24;
    const explanations = new Array(results.length).fill('');
    const batches = [];
    for (let start = 0; start < results.length; start += BATCH_SIZE) batches.push(results.slice(start, start + BATCH_SIZE));
    for (let b = 0; b < batches.length; b += 1) {
      const batch = batches[b];
      const offset = b * BATCH_SIZE;
      const compact = batch.map((r, i) => ({ i, title: r.title, snippet: r.snippet })).map(JSON.stringify).join('\n');
      try {
        const data = await keyManager.call(`השאלה: "${query}". כתוב הסבר עברי עובדתי וקצר בן 2-3 שורות לכל תוצאה, רק לפי הכותרת והתקציר. החזר {"items":[{"i":0,"explanation":"..."}]}.
${compact}`, signal);
        (data.items || []).forEach((item) => {
          const idx = offset + Number(item.i);
          if (idx >= 0 && idx < explanations.length) {
            explanations[idx] = String(item.explanation || '');
            if (onItemExplained) onItemExplained({ ...results[idx], explanation: explanations[idx] });
          }
        });
      } catch (_) { /* ממשיכים לאצווה הבאה גם אם אחת נכשלה */ }
      if (onProgress) onProgress(Math.min(offset + batch.length, results.length), results.length);
    }
    return results.map((result, index) => ({ ...result, explanation: explanations[index] || '' }));
  }

  // ─── Search engine (runs entirely in the browser, no server needed) ──────────

  function tokenize(text) {
    return new Set((text || '').toLowerCase().match(/[\w\u0590-\u05ff]{2,}/g) || []);
  }

  function canonicalKey(url) {
    const m = url.match(/\/(?:post|topic)\/(\d+)/);
    const type = url.includes('/topic/') ? 'topic' : 'post';
    return m ? `${type}:${m[1]}` : url.toLowerCase().replace(/\/+$/, '');
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
    if (item.url.includes('/post/') || item.url.includes('/topic/')) score += 8;
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
          if ((r.snippet || '').length > (cur.snippet || '').length) { cur.snippet = r.snippet; if (r.snippetHtml) cur.snippetHtml = r.snippetHtml; }
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

  // Searches mitmachim.top via GM_xmlhttpRequest (avoids NetFree 418 block).
  async function forumSearch(query, page) {
    try {
      const res = await request({
        method: 'GET',
        url: `https://mitmachim.top/search?term=${encodeURIComponent(query)}&in=titlesposts&matchWords=all&showAs=posts&sortBy=relevance&sortDirection=desc&page=${page}`,
        headers: { 'Accept': 'text/html', 'Accept-Language': 'he-IL,he;q=0.9' }
      });
      if (res.status !== 200) return [];
      const doc = new DOMParser().parseFromString(res.responseText, 'text/html');
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
        // תוכן הפוסט — שומרים גם טקסט נקי (לניקוד/AI) וגם HTML מעוצב (לתצוגה)
        const contentEl = li.querySelector('[component="post/content"]');
        const snippet = contentEl ? contentEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        const snippetHtml = contentEl ? sanitizePostHtml(contentEl) : '';
        // שם משתמש
        const authorEl = li.querySelector('.post-author a.fw-semibold');
        const author = authorEl ? authorEl.textContent.trim() : '';
        const authorUrlEl = li.querySelector('.post-author a[href*="/user/"]');
        const authorUrl = authorUrlEl ? new URL(authorUrlEl.getAttribute('href'), location.origin).href : '';
        // תאריך — כמו בפורום עצמו: טקסט יחסי ("לפני 6 ימים") עם התאריך המדויק כ-title
        const timeEl = li.querySelector('.timeago');
        const date = timeEl ? timeEl.textContent.trim() : '';
        const dateTitle = timeEl ? (timeEl.getAttribute('title') || '') : '';
        // קטגוריה
        const catEl = li.querySelector('[component="topic/category"]');
        const category = catEl ? catEl.textContent.replace(/\s+/g, ' ').trim() : '';
        found.push({
          title,
          url: new URL(href, location.origin).href,
          snippet,
          snippetHtml,
          author,
          authorUrl,
          date,
          dateTitle,
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

  // גרסה סטרימינג: כל שאילתה מתבצעת במקביל, ומיד כשהיא מסתיימת (עמוד ראשון,
  // ובמידת הצורך גם עמודים נוספים) מדווחים החוצה על התוצאות החדשות שהתקבלו ממנה
  // דרך onBatch, בלי להמתין לשאר השאילתות. onBatch מקבל מערך פריטים בודדים
  // (לא ממוינים מחדש מול מה שכבר הוצג) — הקריאה מציבה אותם, ואילו מיון/דירוג
  // פנימי בין הפריטים בתוך אותה אצווה עדיין מתבצע לפי relevanceScore.
  async function streamSearch(queries, signal, onBatch) {
    const seen = new Set();
    let total = 0;

    async function runQuery(q) {
      let staleRounds = 0;
      for (let page = 1; page <= 3 && staleRounds < 2 && !signal?.aborted; page += 1) {
        const [forum, ddg] = await Promise.all([forumSearch(q, page), duckduckgoSearch(q, page, signal)]);
        const combined = [...forum, ...ddg];
        if (!combined.length) { staleRounds += 1; continue; }
        const scored = combined
          .map((item) => ({ ...item, score: relevanceScore(item, [q]) }))
          .sort((a, b) => b.score - a.score);
        const fresh = [];
        for (const item of scored) {
          const key = canonicalKey(item.url);
          if (seen.has(key)) continue;
          seen.add(key);
          fresh.push({ ...item, sources: [item.source], matchedQueries: [q] });
        }
        if (fresh.length) { total += fresh.length; onBatch(fresh, total); staleRounds = 0; }
        else staleRounds += 1;
      }
    }

    await Promise.all(queries.map(runQuery));
  }

  // Main: runs both sources in parallel per query, merges and scores locally (שימוש לא-סטרימינג, לדוגמה טעינה מהמטמון).
  async function localSearch(queries, page, signal) {
    const groups = await Promise.all(queries.map(async (q) => {
      const [forum, ddg] = await Promise.all([forumSearch(q, page), duckduckgoSearch(q, page, signal)]);
      return [q, [...forum, ...ddg]];
    }));
    const results = mergeResults(groups, queries);
    return { results, meta: { queries, count: results.length, page, hasMore: false, nextPage: null } };
  }


  // ─── תמלול קולי לשדה החיפוש ───────────────────────────────────────────────
  // הלוגיקה מבוססת על הסקריפט "Universal Voice to Text": מאזינים ל-SpeechRecognition,
  // מציגים תוצאת ביניים (interim) בשדה בזמן אמת, ובסיום מציבים את הטקסט הסופי.
  // כדי שהתמלול לא "יבלע" תחילת/סוף מילים, מתחילים להאזין כבר לפני שהמשתמש
  // מתחיל לדבר (איפוס דיבאונס) ומחכים שנייה נוספת אחרי לחיצת העצירה לפני שסוגרים
  // את ההאזנה בפועל — כך נשמר "כרית שקט" של כשנייה בכל צד של ההקלטה בפועל.
  const voiceDictation = (() => {
    const SILENCE_PAD_MS = 1000;
    let recognition = null;
    let listening = false;
    let stopTimer = null;
    let targetInput = null;
    let targetButton = null;
    let baseValue = '';
    let finalTranscript = '';

    function supported() {
      return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    function ctor() {
      return window.SpeechRecognition || window.webkitSpeechRecognition;
    }

    function detectLang() {
      // הפורום עברי — ברירת מחדל עברית, אלא אם הדפדפן מוגדר אחרת במפורש לאנגלית
      const nav = (navigator.language || 'he-IL');
      return /^en/i.test(nav) ? 'en-US' : 'he-IL';
    }

    function setButtonState(recording) {
      if (!targetButton) return;
      targetButton.classList.toggle('mai-mic-recording', recording);
      targetButton.setAttribute('aria-pressed', recording ? 'true' : 'false');
      targetButton.title = recording ? 'מקליט… לחצו לעצירה' : 'חיפוש בקול';
    }

    function composeValue(interim) {
      const prefix = baseValue && !/\s$/.test(baseValue) ? ' ' : '';
      const finalPart = finalTranscript ? `${prefix}${finalTranscript}` : '';
      const interimPart = interim ? `${(baseValue + finalPart) && !/\s$/.test(baseValue + finalPart) ? ' ' : ''}${interim}` : '';
      return `${baseValue}${finalPart}${interimPart}`.replace(/\s+/g, ' ').trim();
    }

    function updateInput(interim) {
      if (!targetInput) return;
      targetInput.value = composeValue(interim);
    }

    function start(button, input) {
      if (listening) return;
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      targetButton = button;
      targetInput = input;
      baseValue = (input.value || '').trim();
      finalTranscript = '';

      const Recognition = ctor();
      recognition = new Recognition();
      recognition.lang = detectLang();
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        listening = true;
        setButtonState(true);
      };

      recognition.onresult = (event) => {
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result[0]?.transcript || '';
          if (result.isFinal) {
            finalTranscript = `${finalTranscript}${finalTranscript && !/\s$/.test(finalTranscript) ? ' ' : ''}${transcript.trim()}`;
          } else {
            interimText += transcript;
          }
        }
        updateInput(interimText.trim());
      };

      recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        finish();
      };

      recognition.onend = () => {
        // אם עדיין לא ביקשו לעצור (למשל דפדפן שסוגר session מעצמו), ננסה להמשיך להאזין
        if (listening && !stopTimer) {
          try { recognition.start(); return; } catch (_) {}
        }
        listening = false;
        recognition = null;
        setButtonState(false);
        updateInput('');
        if (targetInput) {
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.focus();
        }
      };

      try {
        recognition.start();
      } catch (_) {
        setButtonState(false);
      }
    }

    function finish() {
      // "כרית שקט" בסוף: ממתינים עוד שנייה אחרי לחיצת העצירה לפני שסוגרים את
      // ההאזנה בפועל, כדי לא לחתוך את סוף המילה/המשפט האחרון.
      if (!listening || stopTimer) return;
      setButtonState(false);
      stopTimer = setTimeout(() => {
        stopTimer = null;
        listening = false;
        if (recognition) { try { recognition.stop(); } catch (_) {} }
      }, SILENCE_PAD_MS);
    }

    function toggle(button, input) {
      if (!supported()) return;
      if (listening) finish();
      else start(button, input);
    }

    return { supported, toggle };
  })();

  function styles() {
    const style = document.createElement('style');
    style.id = 'mai-styles';
    style.textContent = `
.mai-icon{width:34px;height:34px;object-fit:cover;border-radius:50%;display:block;flex:0 0 auto}
.mai-icon-heading{width:44px;height:44px}
.mai-search-link-ready{display:inline-flex!important;align-items:center;justify-content:center;width:34px;height:34px;flex:0 0 34px;padding:0!important;overflow:visible!important}
.mai-mic-btn{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:1px solid #d7dde3;background:#fff;color:#36434f;cursor:pointer;flex:0 0 auto;transition:background .15s,color .15s,box-shadow .15s}
.mai-mic-btn:hover{background:#f1f5f9}
.mai-mic-btn.mai-mic-recording{background:#d93025;border-color:#d93025;color:#fff;box-shadow:0 0 0 4px rgba(217,48,37,.15);animation:mai-mic-pulse 1.2s infinite}
.mai-mic-btn svg{width:18px;height:18px;fill:currentColor;pointer-events:none}
@keyframes mai-mic-pulse{0%{box-shadow:0 0 0 0 rgba(217,48,37,.35)}70%{box-shadow:0 0 0 8px rgba(217,48,37,0)}100%{box-shadow:0 0 0 0 rgba(217,48,37,0)}}
.mai-mention{color:#1976ed;text-decoration:none;font-weight:600}
.mai-mention:hover{text-decoration:underline}
.mai-spoiler-btn{background:#1976ed;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin:4px 0}
.mai-spoiler-btn:hover{background:#1462c4}
.mai-spoiler-body{display:none;margin:6px 0;padding:8px 10px;background:#f5f8fc;border-radius:6px;border:1px solid #e1e8ef}
.mai-spoiler-body.open{display:block}
.mai-post-emoji{height:20px;width:auto;vertical-align:middle}
.mai-post-img{max-width:100%;border-radius:4px;margin:4px 0}
.mai-content-preview{max-height:225px;overflow-y:auto;position:relative;padding-inline-end:4px;scrollbar-width:thin;scrollbar-color:#a9c6ef #eaf1fb}
.mai-content-preview::-webkit-scrollbar{width:6px}
.mai-content-preview::-webkit-scrollbar-track{background:#eaf1fb;border-radius:4px}
.mai-content-preview::-webkit-scrollbar-thumb{background:#a9c6ef;border-radius:4px}
.mai-content-preview::-webkit-scrollbar-thumb:hover{background:#7fb0e8}
.mai-content-preview p{margin:0 0 6px}
.mai-content-fade{position:relative}
.mai-content-fade::after{content:'';position:absolute;left:0;right:0;bottom:0;height:22px;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.92));pointer-events:none;border-radius:0 0 4px 4px}
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
<button type="button" class="mai-mic-btn" id="mai-mic-btn" title="חיפוש בקול" aria-label="חיפוש בקול" aria-pressed="false">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3.75 3.75 0 0 0 3.75-3.75V6.75a3.75 3.75 0 1 0-7.5 0v4.5A3.75 3.75 0 0 0 12 15Zm6-3.75a.75.75 0 0 1 1.5 0A7.5 7.5 0 0 1 12.75 18.7V21a.75.75 0 0 1-1.5 0v-2.3A7.5 7.5 0 0 1 4.5 11.25a.75.75 0 0 1 1.5 0 6 6 0 0 0 12 0Z"></path></svg>
</button>
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

    const micBtn = body.querySelector('#mai-mic-btn');
    if (micBtn) {
      if (!voiceDictation.supported()) {
        micBtn.disabled = true;
        micBtn.title = 'הדפדפן לא תומך בתמלול קולי';
        micBtn.style.opacity = '0.5';
        micBtn.style.cursor = 'not-allowed';
      } else {
        micBtn.addEventListener('click', () => voiceDictation.toggle(micBtn, body.querySelector('#mai-query')));
      }
    }

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
<input class="form-control py-2 ps-2 pe-3" id="mai-new-key" type="password" dir="ltr" autocomplete="off" placeholder="הדביקו את המפתח כאן (AIza... / AQ.../ וכו׳)">
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
      if (key.length < 10 || /\s/.test(key)) return alert('המפתח אינו תקין — ודאו שהעתקתם אותו במלואו ללא רווחים');
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
    cancel.hidden = false; results.innerHTML = '<div class="mai-empty mai-searching" id="mai-searching-hint">מחפש תוצאות ראשונות…</div>'; state.results = []; status.textContent = 'Gemini מתכנן את החיפוש…';
    try {
      const cacheKey = query.toLowerCase(); const cached = settings.cache[cacheKey];
      if (cached && Date.now() - cached.at < CACHE_TTL) { state.results = cached.results; state.plans = cached.plans; renderResults(); status.textContent = 'התוצאות נטענו מהמטמון המקומי'; return; }
      const manager = new KeyManager(settings.keys); const plan = await planSearch(query, manager, state.controller.signal);
      const queries = [...new Set([query, ...(plan.queries || []), ...(plan.possibleTitles || [])])].filter(Boolean).slice(0, 12); state.plans = queries;
      status.textContent = `מחפש ${queries.length} וריאציות במתמחים טופ…`;

      // ─── שלב 1: חיפוש בסטרימינג — כל שאילתה מדווחת תוצאות מיד כשהן מוכנות ───
      // תוצאות חדשות מתווספות לסוף state.results בדיוק בסדר קבלתן; תוצאות
      // שכבר הוצגו למשתמש לעולם לא זזות ממקומן, גם אם שאילתה מאוחרת יותר
      // תניב תוצאה עם ציון גבוה יותר.
      await streamSearch(queries, state.controller.signal, (freshItems, totalSoFar) => {
        if (state.controller.signal.aborted) return;
        state.results.push(...freshItems);
        appendResultCards(freshItems);
        status.textContent = `נמצאו ${totalSoFar} תוצאות עד כה…`;
      });

      if (state.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      if (!state.results.length) {
        renderResults();
        status.textContent = 'לא נמצאו תוצאות';
      } else {
        status.textContent = `נמצאו ${state.results.length} תוצאות ייחודיות`;
      }

      // ─── שלב 2: הסברי Gemini בסטרימינג — כל הסבר מודבק לכרטיס שלו מיד כשמוכן ───
      if (settings.explain && state.results.length) {
        status.textContent = `נמצאו ${state.results.length} תוצאות · Gemini מייצר הסברים…`;
        state.results = await explainResults(query, state.results, manager, state.controller.signal,
          (done, total) => { status.textContent = `נמצאו ${state.results.length} תוצאות · מייצר הסבר… (${done}/${total})`; },
          (item) => { patchExplanation(item); }
        );
      }

      const fresh = storage.get(); const historyList = [query, ...fresh.history.filter((item) => item !== query)].slice(0, 10); const cache = { ...fresh.cache, [cacheKey]: { at: Date.now(), results: state.results, plans: queries } };
      Object.keys(cache).forEach((key) => { if (Date.now() - cache[key].at > CACHE_TTL) delete cache[key]; }); storage.update({ history: historyList, cache, explain: body.querySelector('#mai-explain').checked });
      status.textContent = `נמצאו ${state.results.length} תוצאות ייחודיות`;
    } catch (error) {
      if (error.name === 'AbortError') { results.innerHTML = state.results.length ? results.innerHTML : '<div class="mai-empty">החיפוש בוטל.</div>'; status.textContent = 'החיפוש בוטל'; }
      else { results.innerHTML = `<div class="mai-empty"><strong>${escapeHtml(error.message)}</strong><br><button class="btn btn-primary btn-sm mt-2" id="mai-retry">ניסיון חוזר</button></div>`; results.querySelector('#mai-retry').addEventListener('click', () => run(query)); status.textContent = 'אירעה שגיאה'; }
    } finally { state.busy = false; cancel.hidden = true; }
  }

  function buildResultCard(item) {
    return `<li class="posts-list-item" component="post" data-url="${escapeHtml(item.url)}">
<hr>
<a class="topic-title fw-semibold fs-5 mb-2 text-reset text-break d-block" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
<i class="fa fa-book text-muted" title="נושא"></i> ${escapeHtml(item.title)}
</a>
<div class="post-body d-flex flex-column gap-1 mb-2">
<div class="d-flex gap-2 post-info text-sm align-items-center">
${item.author ? `<div class="post-author d-flex align-items-center gap-1">
<span class="avatar not-responsive avatar-rounded" style="--avatar-size:16px;width:16px;height:16px;border-radius:50%;background-color:#1976ed;color:#fff;font-size:10px;display:inline-flex;align-items:center;justify-content:center;">${escapeHtml((item.author || 'מ').trim().charAt(0))}</span>
${item.authorUrl ? `<a class="fw-semibold text-reset text-decoration-none" href="${escapeHtml(item.authorUrl)}" target="_blank" rel="noopener">${escapeHtml(item.author)}</a>` : `<span class="fw-semibold">${escapeHtml(item.author)}</span>`}
</div>` : ''}
${item.date ? `<span class="timeago text-muted lh-1"${item.dateTitle ? ` title="${escapeHtml(item.dateTitle)}"` : ''}>${escapeHtml(item.date)}</span>` : ''}
</div>
<div class="content text-sm text-break" component="post/content">
<div class="mai-content-preview mai-content-fade">
${item.snippetHtml ? `<div dir="auto">${item.snippetHtml}</div>` : `<p dir="auto">${escapeHtml(item.snippet || 'לחצו לפתיחת הנושא במתמחים טופ')}</p>`}
</div>
<div class="mai-explain-slot">${item.explanation ? `<p dir="auto" class="mai-explain"><strong>הסבר AI:</strong> ${escapeHtml(item.explanation)}</p>` : ''}</div>
</div>
</div>
<div class="mb-3 d-flex flex-wrap gap-1 w-100">
${item.category ? `<a class="badge px-1 text-truncate text-decoration-none border" style="max-width:70vw;">${escapeHtml(item.category)}</a>` : ''}
${(item.sources || []).map((source) => `<span class="badge px-1 text-truncate border text-sm">${escapeHtml(source)}</span>`).join('')}
</div>
</li>`;
  }

  function bindResultCardEvents(container) {
    container.querySelectorAll('[data-spoiler-toggle]').forEach((button) => {
      if (button.dataset.maiBound) return;
      button.dataset.maiBound = '1';
      button.addEventListener('click', () => {
        const body = container.querySelector(`#${CSS.escape(button.dataset.spoilerToggle)}`);
        if (body) body.classList.toggle('open');
      });
    });
  }

  // רינדור מלא (עמוד חדש שנבחר, או תוצאות שנטענו מהמטמון) — מציג עמוד יחיד לפי state.page.
  function renderResults() {
    const container = document.getElementById('mai-results'); if (!container) return;
    if (!state.results.length) { container.innerHTML = '<div class="mai-empty"><strong>לא נמצאו תוצאות</strong><p>נסו לנסח את הבקשה אחרת או להרחיב את מילות החיפוש.</p></div>'; return; }
    const totalPages = Math.ceil(state.results.length / PAGE_SIZE); state.page = Math.min(state.page, totalPages); const start = (state.page - 1) * PAGE_SIZE;
    const cards = state.results.slice(start, start + PAGE_SIZE).map(buildResultCard).join('');
    container.innerHTML = `<ul component="posts" class="posts-list list-unstyled">${cards}</ul><nav class="mai-pager d-flex gap-2 justify-content-center mt-3 pt-3 border-top" aria-label="עמודי תוצאות">${Array.from({ length: totalPages }, (_, i) => `<button class="btn btn-sm ${i + 1 === state.page ? 'btn-primary' : 'btn-light border'} mai-page" data-page="${i + 1}">${i + 1}</button>`).join('')}</nav>`;
    container.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => { state.page = Number(button.dataset.page); renderResults(); getContentEl()?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    bindResultCardEvents(container);
  }

  // תוספת סטרימינג: מוסיפים רק את הפריטים החדשים לסוף הרשימה המוצגת כרגע,
  // בלי לגעת/למיין מחדש בכרטיסים שכבר קיימים על המסך. פועל רק כשמוצג עמוד 1
  // (בעמוד הראשון בלבד יש טעם "לראות תוצאות נכנסות" בזמן אמת); אם המשתמש כבר
  // עבר לעמוד אחר, רק סופרים את התוצאות ברקע ומעדכנים את הפאג'ינציה בשקט.
  function appendResultCards(newItems) {
    const container = document.getElementById('mai-results'); if (!container) return;
    const totalPages = Math.ceil(state.results.length / PAGE_SIZE);
    let list = container.querySelector('ul.posts-list');
    if (!list) {
      // אין עדיין רשימה על המסך (למשל אחרי מסך ריק/שגיאה) — יוצרים מהתחלה
      renderResults();
      return;
    }
    if (state.page === 1) {
      const currentCount = list.children.length;
      const room = PAGE_SIZE - currentCount;
      if (room > 0) {
        const toAppend = newItems.slice(0, room);
        list.insertAdjacentHTML('beforeend', toAppend.map(buildResultCard).join(''));
        bindResultCardEvents(container);
      }
    }
    // מעדכנים תמיד את הפאג'ינציה כדי לשקף את כמות התוצאות הכוללת שהצטברה
    let nav = container.querySelector('.mai-pager');
    const navHtml = `${Array.from({ length: totalPages }, (_, i) => `<button class="btn btn-sm ${i + 1 === state.page ? 'btn-primary' : 'btn-light border'} mai-page" data-page="${i + 1}">${i + 1}</button>`).join('')}`;
    if (totalPages > 1) {
      if (!nav) {
        container.insertAdjacentHTML('beforeend', `<nav class="mai-pager d-flex gap-2 justify-content-center mt-3 pt-3 border-top" aria-label="עמודי תוצאות">${navHtml}</nav>`);
        nav = container.querySelector('.mai-pager');
      } else {
        nav.innerHTML = navHtml;
      }
      nav.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => { state.page = Number(button.dataset.page); renderResults(); getContentEl()?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    }
  }

  // מדביק הסבר AI לכרטיס ספציפי (לפי URL) מבלי לרנדר מחדש את שאר הרשימה.
  function patchExplanation(item) {
    const container = document.getElementById('mai-results'); if (!container) return;
    const li = container.querySelector(`li[data-url="${CSS.escape(item.url)}"]`);
    if (!li) return; // הפריט לא מוצג כרגע (בעמוד אחר) — ה-state כבר עודכן, יוצג נכון בפעם הבאה שהעמוד יירונדר
    const slot = li.querySelector('.mai-explain-slot');
    if (slot) slot.innerHTML = item.explanation ? `<p dir="auto" class="mai-explain"><strong>הסבר AI:</strong> ${escapeHtml(item.explanation)}</p>` : '';
  }

  function enhanceSearchLink() {
    document.querySelectorAll('a.advanced-search-link').forEach((link) => {
      if (link.dataset.maiReady) return;
      link.dataset.maiReady = 'true';
      link.classList.add('mai-search-link-ready');
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
