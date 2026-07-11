import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from backend.main import SearchRequest, canonical_key, merge_results, normalize_url, relevance_score


def test_normalize_url_enforces_mitmachim_domain():
    assert normalize_url("https://mitmachim.top/topic/123/title?utm=x#reply") == "https://mitmachim.top/topic/123/title"
    assert normalize_url("https://www.mitmachim.top/topic/9") == "https://mitmachim.top/topic/9"
    assert normalize_url("https://evil.example/topic/123") is None
    assert normalize_url("javascript:alert(1)") is None


def test_canonical_topic_key_deduplicates_slugs():
    assert canonical_key("https://mitmachim.top/topic/123/first") == canonical_key("https://mitmachim.top/topic/123/second")


def test_merge_results_keeps_best_snippet_and_sources():
    groups = [
        ("חסימת פרסומות", [{"title": "חסימת פרסומות", "url": "https://mitmachim.top/topic/123/a", "snippet": "קצר", "source": "A"}]),
        ("פרסומות אנדרואיד", [{"title": "חסימת פרסומות באנדרואיד", "url": "https://mitmachim.top/topic/123/b", "snippet": "תקציר ארוך ומפורט יותר", "source": "B"}]),
    ]
    results = merge_results(groups, ["חסימת פרסומות", "פרסומות אנדרואיד"])
    assert len(results) == 1
    assert results[0]["snippet"] == "תקציר ארוך ומפורט יותר"
    assert results[0]["sources"] == ["A", "B"]
    assert len(results[0]["matchedQueries"]) == 2


def test_title_matches_rank_above_unrelated_content():
    relevant = {"title": "חסימת פרסומות באנדרואיד", "snippet": "מדריך", "url": "https://mitmachim.top/topic/1/x"}
    unrelated = {"title": "מחשב חדש", "snippet": "דיון כללי", "url": "https://mitmachim.top/topic/2/x"}
    assert relevance_score(relevant, ["חסימת פרסומות"]) > relevance_score(unrelated, ["חסימת פרסומות"])


def test_request_strips_site_operators_and_limits_payload():
    request = SearchRequest(queries=["site:evil.example חסימת פרסומות", "  מחשב   נייד "])
    assert request.queries == ["חסימת פרסומות", "מחשב נייד"]
