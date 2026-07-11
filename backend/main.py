from __future__ import annotations

import logging
import math
import random
import re
import time
from collections import defaultdict
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("mitmachim-search")

TARGET_HOST = "mitmachim.top"
ALLOWED_ORIGINS = ["https://mitmachim.top", "https://www.mitmachim.top"]
MAX_QUERIES = 12
MAX_PAGES = 5
MAX_RESULTS = 100
REQUEST_TIMEOUT = (4, 10)
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
]

app = FastAPI(title="Mitmachim AI Search API", version="1.0.0", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=86400,
)


class SearchRequest(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=MAX_QUERIES)
    page: int = Field(default=1, ge=1, le=MAX_PAGES)
    pages_per_query: int = Field(default=1, ge=1, le=2)
    limit: int = Field(default=30, ge=1, le=MAX_RESULTS)

    @field_validator("queries")
    @classmethod
    def clean_queries(cls, queries: list[str]) -> list[str]:
        cleaned: list[str] = []
        for raw in queries:
            query = re.sub(r"\s+", " ", raw).strip()
            query = re.sub(r"\b(?:site|inurl|link|cache):\S+", "", query, flags=re.I).strip()
            if not query or len(query) > 180:
                raise ValueError("Each query must contain 1-180 characters")
            if query not in cleaned:
                cleaned.append(query)
        if not cleaned:
            raise ValueError("At least one valid query is required")
        return cleaned


def headers() -> dict[str, str]:
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.7",
    }


def normalize_url(raw_url: str) -> str | None:
    raw_url = unquote(raw_url.strip())
    parsed = urlparse(raw_url)
    if "duckduckgo.com" in parsed.netloc:
        raw_url = parse_qs(parsed.query).get("uddg", [""])[0]
        parsed = urlparse(raw_url)
    host = parsed.hostname.lower().removeprefix("www.") if parsed.hostname else ""
    if host != TARGET_HOST or parsed.scheme not in {"http", "https"}:
        return None
    path = re.sub(r"/+", "/", parsed.path).rstrip("/") or "/"
    # NodeBB topic URLs remain canonical without tracking/search fragments.
    query = "" if path.startswith("/topic/") else parsed.query
    return urlunparse(("https", TARGET_HOST, path, "", query, ""))


def canonical_key(url: str) -> str:
    match = re.search(r"/topic/(\d+)", url)
    return f"topic:{match.group(1)}" if match else url.lower().rstrip("/")


def tokenize(text: str) -> set[str]:
    return {word for word in re.findall(r"[\w\u0590-\u05ff]+", text.lower()) if len(word) > 1}


def relevance_score(item: dict[str, Any], queries: list[str]) -> float:
    title_tokens = tokenize(item.get("title", ""))
    snippet_tokens = tokenize(item.get("snippet", ""))
    score = 0.0
    matched_queries = 0
    for query in queries:
        q_tokens = tokenize(query)
        if not q_tokens:
            continue
        title_overlap = len(q_tokens & title_tokens) / len(q_tokens)
        snippet_overlap = len(q_tokens & snippet_tokens) / len(q_tokens)
        if title_overlap or snippet_overlap:
            matched_queries += 1
        score += title_overlap * 55 + snippet_overlap * 24
        if query.lower() in item.get("title", "").lower():
            score += 18
    if "/topic/" in item.get("url", ""):
        score += 8
    score += min(matched_queries, 4) * 7
    return round(score, 2)


def _request_with_retry(session: requests.Session, method: str, url: str, **kwargs: Any) -> requests.Response:
    error: Exception | None = None
    for attempt in range(3):
        try:
            response = session.request(method, url, headers=headers(), timeout=REQUEST_TIMEOUT, **kwargs)
            if response.status_code in {429, 500, 502, 503, 504}:
                raise requests.HTTPError(f"upstream status {response.status_code}")
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            error = exc
            if attempt < 2:
                time.sleep(0.35 * (2**attempt) + random.random() * 0.15)
    raise requests.RequestException(str(error or "upstream request failed"))


def search_duckduckgo(session: requests.Session, query: str, page: int) -> list[dict[str, str]]:
    scoped = f"site:{TARGET_HOST} {query}"
    offset = max(0, (page - 1) * 30)
    response = _request_with_retry(
        session,
        "POST",
        "https://html.duckduckgo.com/html/",
        data={"q": scoped, "s": str(offset), "dc": str(offset + 1)},
    )
    soup = BeautifulSoup(response.text, "html.parser")
    found: list[dict[str, str]] = []
    for result in soup.select(".result"):
        link = result.select_one(".result__a")
        if not link:
            continue
        url = normalize_url(link.get("href", ""))
        if not url:
            continue
        snippet_node = result.select_one(".result__snippet")
        found.append({
            "title": link.get_text(" ", strip=True),
            "url": url,
            "snippet": snippet_node.get_text(" ", strip=True) if snippet_node else "",
            "source": "DuckDuckGo",
        })
    return found


def search_site(session: requests.Session, query: str, page: int) -> list[dict[str, str]]:
    # NodeBB's public search is used as a resilient second source.
    url = f"https://{TARGET_HOST}/search?term={quote_plus(query)}&page={page}"
    response = _request_with_retry(session, "GET", url)
    soup = BeautifulSoup(response.text, "html.parser")
    found: list[dict[str, str]] = []
    selectors = "a[href*='/topic/']"
    seen: set[str] = set()
    for link in soup.select(selectors):
        normalized = normalize_url(link.get("href", ""))
        title = link.get_text(" ", strip=True)
        if not normalized or not title or canonical_key(normalized) in seen:
            continue
        seen.add(canonical_key(normalized))
        parent = link.find_parent(["li", "article", "div"])
        snippet = parent.get_text(" ", strip=True)[:360] if parent else ""
        found.append({"title": title, "url": normalized, "snippet": snippet, "source": "Mitmachim Top"})
        if len(found) >= 40:
            break
    return found


def merge_results(groups: list[tuple[str, list[dict[str, str]]]], queries: list[str]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    query_hits: defaultdict[str, set[str]] = defaultdict(set)
    for query, results in groups:
        for result in results:
            key = canonical_key(result["url"])
            query_hits[key].add(query)
            if key not in merged:
                merged[key] = {**result, "sources": [result["source"]]}
            else:
                current = merged[key]
                if len(result.get("snippet", "")) > len(current.get("snippet", "")):
                    current["snippet"] = result["snippet"]
                if result["source"] not in current["sources"]:
                    current["sources"].append(result["source"])
    for key, item in merged.items():
        item["matchedQueries"] = sorted(query_hits[key])
        item["score"] = relevance_score(item, queries) + min(len(query_hits[key]), 4) * 4
    return sorted(merged.values(), key=lambda item: (-item["score"], item["title"]))


def run_search(payload: SearchRequest) -> dict[str, Any]:
    session = requests.Session()
    groups: list[tuple[str, list[dict[str, str]]]] = []
    errors: list[str] = []
    start_page = payload.page
    for query in payload.queries:
        for page in range(start_page, min(MAX_PAGES, start_page + payload.pages_per_query - 1) + 1):
            combined: list[dict[str, str]] = []
            for provider in (search_site, search_duckduckgo):
                try:
                    combined.extend(provider(session, query, page))
                except requests.RequestException:
                    errors.append(provider.__name__)
            groups.append((query, combined))
    results = merge_results(groups, payload.queries)
    sliced = results[: payload.limit]
    next_page = payload.page + payload.pages_per_query
    has_more = next_page <= MAX_PAGES and bool(results)
    return {
        "success": True,
        "results": sliced,
        "meta": {
            "queries": payload.queries,
            "count": len(sliced),
            "uniqueCollected": len(results),
            "page": payload.page,
            "hasMore": has_more,
            "nextPage": next_page if has_more else None,
            "partial": bool(errors),
        },
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"success": True, "service": "mitmachim-ai-search", "aiOnServer": False}


@app.post("/search")
def search(payload: SearchRequest) -> JSONResponse:
    try:
        body = run_search(payload)
        return JSONResponse(body, headers={"Cache-Control": "no-store"})
    except Exception:
        log.exception("Search pipeline failed")
        return JSONResponse(
            {"success": False, "error": {"code": "SEARCH_FAILED", "message": "החיפוש נכשל זמנית. נסו שוב."}},
            status_code=502,
            headers={"Cache-Control": "no-store"},
        )


@app.exception_handler(Exception)
async def unhandled_error(_: Request, exc: Exception) -> JSONResponse:
    log.error("Unhandled API error: %s", type(exc).__name__)
    return JSONResponse(
        {"success": False, "error": {"code": "INTERNAL_ERROR", "message": "אירעה שגיאה פנימית."}},
        status_code=500,
    )
