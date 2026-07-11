from pathlib import Path

SCRIPT = (Path(__file__).parents[1] / "userscript" / "mitmachim-ai-search.user.js").read_text(encoding="utf-8")


def test_userscript_has_required_permissions_and_domains():
    assert "@grant        GM_getValue" in SCRIPT
    assert "@grant        GM_setValue" in SCRIPT
    assert "@connect      ai-search-mitmachim.vercel.app" in SCRIPT
    assert "@connect      generativelanguage.googleapis.com" in SCRIPT


def test_default_server_and_model_are_explicit_and_changeable():
    assert "const DEFAULT_SERVER_URL = 'https://ai-search-mitmachim.vercel.app'" in SCRIPT
    assert "const GEMINI_MODEL = 'gemini-3.1-flash-lite'" in SCRIPT
    assert "serverUrl: url" in SCRIPT


def test_gemini_keys_never_enter_server_payload():
    server_call = SCRIPT[SCRIPT.index("async function serverSearch"):SCRIPT.index("function styles")]
    assert "api_key" not in server_call
    assert "settings.keys" not in server_call
    assert "queries, page, pages_per_query" in server_call


def test_overlay_is_in_page_and_intercepts_advanced_search():
    assert "a.advanced-search-link" in SCRIPT
    assert "event.preventDefault()" in SCRIPT
    assert "aria-modal=\"true\"" in SCRIPT
    assert "window.open" not in SCRIPT
    assert "<iframe" not in SCRIPT


def test_keys_are_masked_before_rendering():
    assert "maskKey(key)" in SCRIPT
    assert "type=\"password\"" in SCRIPT
