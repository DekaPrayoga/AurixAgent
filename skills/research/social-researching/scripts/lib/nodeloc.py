"""NodeLoc public Discourse search client for social-researching.

Uses public JSON endpoints exposed by NodeLoc's Discourse instance:
- /search/query.json?term=<query>
- /latest.json as a recent-topic fallback

The client is read-only and keyless. It does not attempt login-only pages or
session bypasses; when public endpoints fail, it returns an empty list so other
sources can continue.
"""

from __future__ import annotations

import html
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urljoin

from . import http

DEFAULT_BASE_URL = "https://www.nodeloc.com"
AI_TERMS = [
    "AI",
    "人工智能",
    "大模型",
    "国产AI",
    "DeepSeek",
    "通义千问",
    "豆包",
    "Kimi",
    "智谱",
    "月之暗面",
    "百度文心",
    "华为盘古",
    "阿里百炼",
    "算力",
    "GPU",
    "推理成本",
]


def _clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _date_from_iso(value: Any) -> Optional[str]:
    if not value:
        return None
    text = str(value)
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).astimezone(timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        match = re.match(r"(\d{4}-\d{2}-\d{2})", str(value))
        return match.group(1) if match else None


def _topic_url(base_url: str, topic: Dict[str, Any], post: Dict[str, Any] | None = None) -> str:
    slug = str(topic.get("slug") or "topic")
    topic_id = topic.get("id") or (post or {}).get("topic_id")
    post_number = (post or {}).get("post_number")
    if not topic_id:
        return base_url.rstrip("/")
    url = f"/t/{slug}/{topic_id}"
    if post_number and int(post_number or 0) > 1:
        url += f"/{post_number}"
    return urljoin(base_url.rstrip("/") + "/", url.lstrip("/"))


def _fetch_topic_detail(base_url: str, topic_id: Any) -> Dict[str, Any]:
    if not topic_id:
        return {}
    try:
        payload = http.get(
            f"{base_url.rstrip('/')}/t/{int(topic_id)}.json",
            headers={"Accept": "application/json", "User-Agent": http.BROWSER_USER_AGENT},
            timeout=10,
            retries=1,
        )
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _score_from_post(post: Dict[str, Any], topic: Dict[str, Any]) -> float:
    likes = int(post.get("like_count") or topic.get("like_count") or 0)
    replies = int(topic.get("reply_count") or topic.get("posts_count") or 0)
    views = int(topic.get("views") or 0)
    score = (likes * 4) + (replies * 2) + min(views, 5000) / 150
    return round(max(0.08, min(1.0, score / 80)), 3)


def _topic_lookup(payload: Dict[str, Any]) -> Dict[int, Dict[str, Any]]:
    grouped = payload.get("grouped_search_result") or {}
    topics = grouped.get("extra_data", {}).get("topics") or []
    lookup: Dict[int, Dict[str, Any]] = {}
    for topic in topics:
        if isinstance(topic, dict) and topic.get("id") is not None:
            lookup[int(topic["id"])] = topic
    return lookup


def _parse_search_payload(payload: Dict[str, Any], base_url: str, limit: int) -> List[Dict[str, Any]]:
    topics = _topic_lookup(payload)
    posts = payload.get("posts") or []
    items: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for index, post in enumerate(posts):
        if not isinstance(post, dict):
            continue
        topic_id = post.get("topic_id")
        topic = topics.get(int(topic_id or 0), {})
        if not topic.get("title") or not topic.get("slug"):
            detail = _fetch_topic_detail(base_url, topic_id)
            if detail:
                topic = {**topic, **detail}
        title = _clean_text(topic.get("title") or post.get("topic_title") or post.get("blurb"))
        snippet = _clean_text(post.get("blurb") or post.get("cooked") or title)
        if title == snippet and len(title) > 140:
            title = title[:137] + "..."
        url = _topic_url(base_url, topic, post)
        if url in seen:
            continue
        seen.add(url)
        likes = int(post.get("like_count") or topic.get("like_count") or 0)
        replies = int(topic.get("reply_count") or topic.get("posts_count") or 0)
        views = int(topic.get("views") or 0)
        date_value = _date_from_iso(post.get("created_at") or topic.get("created_at"))
        items.append({
            "id": f"NL{post.get('id') or index + 1}",
            "title": title[:220] or f"NodeLoc thread {topic_id or index + 1}",
            "url": url,
            "source_domain": "nodeloc.com",
            "snippet": snippet[:700],
            "date": date_value,
            "date_confidence": "high" if date_value else "low",
            "author": str(post.get("username") or ""),
            "container": "NodeLoc",
            "relevance": _score_from_post(post, topic),
            "why_relevant": f"NodeLoc discussion: likes={likes}, replies={replies}, views={views}",
            "engagement": {
                "likes": likes,
                "replies": replies,
                "views": views,
            },
        })
        if len(items) >= limit:
            break
    return items


def _parse_topic_list(payload: Dict[str, Any], base_url: str, topic: str, limit: int) -> List[Dict[str, Any]]:
    topic_list = payload.get("topic_list") or {}
    topics = topic_list.get("topics") or []
    needles = _query_terms(topic)
    items: List[Dict[str, Any]] = []

    for index, row in enumerate(topics):
        if not isinstance(row, dict):
            continue
        title = _clean_text(row.get("title"))
        excerpt = _clean_text(row.get("excerpt") or row.get("fancy_title") or title)
        haystack = f"{title} {excerpt}".lower()
        if needles and not any(term.lower() in haystack for term in needles):
            continue
        date_value = _date_from_iso(row.get("bumped_at") or row.get("created_at") or row.get("last_posted_at"))
        replies = int(row.get("reply_count") or row.get("posts_count") or 0)
        views = int(row.get("views") or 0)
        likes = int(row.get("like_count") or 0)
        items.append({
            "id": f"NLT{row.get('id') or index + 1}",
            "title": title[:220] or f"NodeLoc topic {row.get('id') or index + 1}",
            "url": _topic_url(base_url, row),
            "source_domain": "nodeloc.com",
            "snippet": excerpt[:700],
            "date": date_value,
            "date_confidence": "high" if date_value else "low",
            "author": str(row.get("last_poster_username") or ""),
            "container": "NodeLoc",
            "relevance": _score_from_post({}, row),
            "why_relevant": f"NodeLoc recent topic: likes={likes}, replies={replies}, views={views}",
            "engagement": {"likes": likes, "replies": replies, "views": views},
        })
        if len(items) >= limit:
            break
    return items


def _query_terms(topic: str) -> List[str]:
    terms = [part.strip() for part in re.split(r"[\s,，/|]+", topic) if len(part.strip()) >= 2]
    topic_lower = topic.lower()
    if any(token.lower() in topic_lower for token in ["ai", "人工智能", "大模型", "china", "中国"]):
        terms.extend(AI_TERMS)
    out: List[str] = []
    for term in terms:
        if term and term not in out:
            out.append(term)
    return out[:18]


def _search_once(base_url: str, query: str, limit: int) -> List[Dict[str, Any]]:
    path = f"/search/query.json?term={quote(query)}"
    payload = http.get(
        f"{base_url.rstrip('/')}{path}",
        headers={"Accept": "application/json", "User-Agent": http.BROWSER_USER_AGENT},
        timeout=15,
        retries=2,
    )
    return _parse_search_payload(payload, base_url, limit)


def search_nodeloc(
    topic: str,
    from_date: str,
    to_date: str,
    base_url: str = DEFAULT_BASE_URL,
    depth: str = "default",
) -> List[Dict[str, Any]]:
    """Search public NodeLoc discussions for a topic."""
    base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
    limit = {"quick": 8, "default": 15, "deep": 25}.get(depth, 15)
    queries = [topic]
    if any(t.lower() in topic.lower() for t in ["ai", "china", "中国", "人工智能", "大模型"]):
        queries.extend([
            "中国 AI 大模型",
            "国产 AI",
            "DeepSeek Kimi 豆包 通义千问",
            "AI 算力 GPU 推理成本",
        ])

    items: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for query in queries[:4]:
        try:
            for item in _search_once(base_url, query, limit):
                url = item.get("url") or ""
                if url and url not in seen:
                    seen.add(url)
                    items.append(item)
        except Exception:
            pass
        if len(items) >= limit:
            break
        time.sleep(0.35)

    if len(items) < max(3, min(limit, 6)):
        try:
            latest = http.get(
                f"{base_url}/latest.json",
                headers={"Accept": "application/json", "User-Agent": http.BROWSER_USER_AGENT},
                timeout=15,
                retries=2,
            )
            for item in _parse_topic_list(latest, base_url, topic, limit):
                url = item.get("url") or ""
                if url and url not in seen:
                    seen.add(url)
                    items.append(item)
                if len(items) >= limit:
                    break
        except Exception:
            pass

    return items[:limit]
