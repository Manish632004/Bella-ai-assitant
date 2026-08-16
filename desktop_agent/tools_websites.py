"""
Website control: open named sites or arbitrary URLs in the default browser.

Uses the OS default-browser handler so the user's real Chrome/Edge/Firefox
opens at the requested destination (independent of the Playwright automation
browser and the in-app holographic BrowserAgent).
"""

from __future__ import annotations

import webbrowser
from typing import Any, Dict
from urllib.parse import quote

from .registry import ToolError, register

# Named shortcuts the model can request by friendly name.
SITE_URLS: Dict[str, str] = {
    "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com",
    "chatgpt": "https://chatgpt.com",
    "openai": "https://chatgpt.com",
    "claude": "https://claude.ai",
    "google": "https://www.google.com",
    "github": "https://github.com",
    "wikipedia": "https://www.wikipedia.org",
    "wiki": "https://www.wikipedia.org",
    "reddit": "https://www.reddit.com",
    "twitter": "https://x.com",
    "x": "https://x.com",
    "instagram": "https://www.instagram.com",
    "facebook": "https://www.facebook.com",
    "fb": "https://www.facebook.com",
    "linkedin": "https://www.linkedin.com",
    "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com",
    "translate": "https://translate.google.com",
    "drive": "https://drive.google.com",
    "calendar": "https://calendar.google.com",
    "amazon": "https://www.amazon.com",
    "netflix": "https://www.netflix.com",
    "spotify": "https://open.spotify.com",
    "stack overflow": "https://stackoverflow.com",
    "stackoverflow": "https://stackoverflow.com",
    "huggingface": "https://huggingface.co",
    "twitch": "https://www.twitch.tv",
    "tiktok": "https://www.tiktok.com",
    "pinterest": "https://www.pinterest.com",
    "quora": "https://www.quora.com",
    "medium": "https://medium.com",
    "canva": "https://www.canva.com",
    "figma": "https://www.figma.com",
    "notion": "https://www.notion.so",
    "zoom": "https://zoom.us",
    "weather": "https://weather.com",
}


def _normalize_url(raw: str) -> str:
    url = raw.strip()
    if not url or url.lower() in ("https://", "http://", "https", "http"):
        return "https://www.google.com"
    lower = url.lower()
    if lower in SITE_URLS:
        return SITE_URLS[lower]
    if "://" not in url:
        if "." in url:
            url = "https://" + url
        elif " " not in url:
            url = f"https://www.{url}.com"
        else:
            url = f"https://www.google.com/search?q={quote(url)}"
    return url


def open_url(url: str) -> str:
    """Open a URL in the default browser; returns the resolved URL."""
    url = _normalize_url(url)
    ok = webbrowser.open(url, new=2)  # new tab in a new window group if possible
    if not ok:
        raise ToolError(f"Failed to open default browser for {url}.")
    return url


@register("openWebsite")
def open_website(args: Dict[str, Any]) -> Dict[str, Any]:
    raw = (
        args.get("url")
        or args.get("name")
        or args.get("site")
        or args.get("query")
        or args.get("app")
        or args.get("website")
        or ""
    )
    resolved = open_url(str(raw))
    return {"result": f"Opened {resolved} in the default browser."}


# Expose for sibling modules (tools_search).
def _build_search_url(engine: str, query: str) -> str:
    q = quote(query)
    base = {
        "google": f"https://www.google.com/search?q={q}",
        "youtube": f"https://www.youtube.com/results?search_query={q}",
        "github": f"https://github.com/search?q={q}&type=repositories",
        "chatgpt": f"https://www.google.com/search?q={q}",  # no search API
        "duckduckgo": f"https://duckduckgo.com/?q={q}",
        "bing": f"https://www.bing.com/search?q={q}",
        "amazon": f"https://www.amazon.com/s?k={q}",
        "wikipedia": f"https://en.wikipedia.org/w/index.php?search={q}",
    }
    if engine not in base:
        raise ToolError(
            f"Unsupported search engine '{engine}'. Choose from "
            f"{', '.join(sorted(base))}."
        )
    return base[engine]


__all__ = ["open_website", "open_url", "SITE_URLS", "_build_search_url"]
