"""Aurix Reddit relay adapter.

Calls a user-hosted Aurix Reddit relay (typically Vercel) and returns the same
normalized item shape as the other Reddit adapters. The relay should use
compliant server-side sources such as Reddit OAuth and expose `/api/reddit/search`.
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional

from . import http


def _log(msg: str) -> None:
    sys.stderr.write(f"[RedditRelay] {msg}\n")
    sys.stderr.flush()


def _strict(config: dict[str, Any] | None) -> bool:
    value = str((config or {}).get("AURIX_REDDIT_RELAY_STRICT") or "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _base_url(config: dict[str, Any] | None) -> str:
    return str((config or {}).get("AURIX_REDDIT_RELAY_URL") or "").strip().rstrip("/")


def _token(config: dict[str, Any] | None) -> str:
    return str((config or {}).get("AURIX_REDDIT_RELAY_TOKEN") or "").strip()


def _timeout(config: dict[str, Any] | None) -> int:
    raw = (config or {}).get("AURIX_REDDIT_RELAY_TIMEOUT_SECONDS") or 25
    try:
        return max(5, min(90, int(raw)))
    except (TypeError, ValueError):
        return 25


def _headers(config: dict[str, Any] | None) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    token = _token(config)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def parse_reddit_response(response: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = response.get("items", [])
    return items if isinstance(items, list) else []


def search_and_enrich(
    topic: str,
    from_date: str,
    to_date: str,
    depth: str = "default",
    config: Optional[dict[str, Any]] = None,
    subreddits: Optional[List[str]] = None,
) -> Dict[str, Any]:
    base = _base_url(config)
    if not base:
        return {"items": [], "error": "AURIX_REDDIT_RELAY_URL is not configured"}

    params: dict[str, Any] = {
        "q": topic,
        "from": from_date,
        "to": to_date,
        "depth": depth,
    }
    if subreddits:
        params["subreddits"] = ",".join(subreddits)

    try:
        data = http.get(
            f"{base}/api/reddit/search",
            headers=_headers(config),
            params=params,
            timeout=_timeout(config),
            retries=2,
            max_429_retries=1,
        )
    except http.HTTPError as exc:
        _log(f"Relay request failed: HTTP {exc.status_code or 'unknown'}")
        if _strict(config):
            raise
        return {"items": [], "error": str(exc)}
    except Exception as exc:
        _log(f"Relay request failed: {type(exc).__name__}: {exc}")
        if _strict(config):
            raise
        return {"items": [], "error": str(exc)}

    if not isinstance(data, dict):
        return {"items": [], "error": "Relay returned non-object JSON"}

    warnings = data.get("warnings") or []
    if warnings:
        _log("; ".join(str(w) for w in warnings[:3]))

    items = parse_reddit_response(data)
    if items:
        _log(f"{len(items)} posts from relay ({data.get('backend') or 'unknown backend'})")
    else:
        _log("Relay returned 0 posts")
    return {"items": items, "warnings": warnings, "backend": data.get("backend")}
