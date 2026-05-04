from __future__ import annotations

import asyncio
import hashlib
import html
import json
import math
import os
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field


class ReverseEngineerRequest(BaseModel):
    url: str = Field(..., min_length=10, max_length=4096)


@dataclass(frozen=True)
class TextSignals:
    platform: str
    normalized_text: str
    title: str
    description: str
    tokens: list[str]
    metadata_confidence: float
    has_cover: bool
    url_entropy: float


app = FastAPI(title="KOC-Engine API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


SYSTEM_PROMPT = """
你是 KOC-Engine 的脚本增强模块。
系统已经用可解释特征工程完成了分数、留存曲线、证据和干预节点，请不要改动这些数值。
你的任务只是在保持 JSON 字段完整的前提下，润色 original_script、optimized_script、script_diff 和 insight_cards 的中文表达。
严格只返回 JSON 对象，不要 Markdown，不要额外说明。
"""

PLATFORM_HINTS = {
    "v.qq.com": "腾讯视频",
    "video.qq.com": "腾讯视频",
    "qzone.qq.com": "QQ 空间",
    "xhslink.com": "小红书",
    "xiaohongshu.com": "小红书",
    "douyin.com": "抖音",
    "iesdouyin.com": "抖音",
    "bilibili.com": "Bilibili",
    "kuaishou.com": "快手",
    "weixin.qq.com": "微信公众号",
}

PRODUCT_TERMS = {
    "精华",
    "防晒",
    "喷雾",
    "口红",
    "粉底",
    "面膜",
    "耳机",
    "相机",
    "课程",
    "好物",
    "护肤",
    "穿搭",
    "通勤",
    "宿舍",
    "校园",
    "军训",
}

HOOK_TERMS = {
    "别划走",
    "别再",
    "一定要",
    "千万",
    "后悔",
    "救命",
    "真实",
    "实测",
    "结果",
    "三天",
    "一周",
    "避雷",
    "痛点",
    "秒懂",
    "新手",
}

PROOF_TERMS = {
    "对比",
    "实拍",
    "截图",
    "数据",
    "前后",
    "测试",
    "测评",
    "真实",
    "结果",
    "同机位",
    "复购",
    "反馈",
}

CTA_TERMS = {
    "链接",
    "下单",
    "领取",
    "库存",
    "左下角",
    "评论",
    "私信",
    "购买",
    "收藏",
    "转发",
    "限时",
    "优惠",
}

EMOTION_TERMS = {
    "崩溃",
    "惊喜",
    "焦虑",
    "尴尬",
    "舒服",
    "后悔",
    "安心",
    "痛苦",
    "拯救",
    "救命",
    "炸裂",
}

SCENE_TERMS = {
    "校园",
    "宿舍",
    "通勤",
    "军训",
    "约会",
    "面试",
    "运动",
    "户外",
    "熬夜",
    "学生",
    "上班",
}


def _load_codex_auth_key() -> str | None:
    auth_path = Path.home() / ".codex" / "auth.json"
    if not auth_path.exists():
        return None

    try:
        payload = json.loads(auth_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    api_key = payload.get("OPENAI_API_KEY")
    if isinstance(api_key, str) and api_key.strip():
        return api_key.strip()
    return None


def _load_codex_config() -> dict[str, Any]:
    config_path = Path.home() / ".codex" / "config.toml"
    if not config_path.exists():
        return {}

    try:
        return tomllib.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _resolve_model_settings() -> tuple[str | None, str, str]:
    config = _load_codex_config()
    provider_name = os.getenv("OPENAI_PROVIDER") or config.get("model_provider") or "OpenAI"
    providers = config.get("model_providers", {})
    provider_config = providers.get(provider_name) or providers.get("OpenAI") or {}

    api_key = os.getenv("OPENAI_API_KEY") or _load_codex_auth_key()
    base_url = os.getenv("OPENAI_BASE_URL") or provider_config.get("base_url") or "https://api.openai.com/v1"
    model = os.getenv("OPENAI_MODEL") or config.get("model") or "gpt-4o-mini"
    return api_key, str(base_url).rstrip("/"), str(model)


def _resolve_timeout_seconds() -> float:
    raw = os.getenv("OPENAI_TIMEOUT_SECONDS", "8")
    try:
        value = float(raw)
    except ValueError:
        return 8.0
    return max(4.0, min(value, 20.0))


def _hash_unit(seed: str, index: int) -> float:
    digest = hashlib.sha256(f"{seed}:{index}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _validate_content_url(raw_url: str) -> str:
    url = raw_url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=422, detail="请输入完整的 http/https 内容链接")
    if "." not in parsed.netloc:
        raise HTTPException(status_code=422, detail="链接域名不完整，无法进行内容解析")
    return url


def _score(value: float) -> int:
    return int(round(_clamp(value, 0, 100)))


def _detect_platform(url: str) -> str:
    host = urlparse(url if "://" in url else f"https://{url}").netloc.lower()
    for domain, label in PLATFORM_HINTS.items():
        if domain in host:
            return label
    return "未知平台"


def _tokenize_text(text: str) -> list[str]:
    cleaned = unquote(html.unescape(text)).lower()
    chunks = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z0-9]{2,}", cleaned)
    return [chunk.strip() for chunk in chunks if chunk.strip()]


def _count_terms(text: str, terms: set[str]) -> int:
    return sum(1 for term in terms if term.lower() in text.lower())


def _extract_title_from_url(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    query = parse_qs(parsed.query)
    candidates = []
    for key in ("title", "desc", "keyword", "q", "share_desc"):
        candidates.extend(query.get(key, []))

    path_text = unquote(parsed.path.replace("/", " ").replace("-", " ").replace("_", " "))
    if path_text.strip():
        candidates.append(path_text)

    text = " ".join(item for item in candidates if item)
    return re.sub(r"\s+", " ", text).strip()


def _extract_query_metadata(url: str) -> dict[str, str]:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    query = parse_qs(parsed.query)

    def pick(*keys: str) -> str:
        for key in keys:
            values = query.get(key)
            if values and values[0].strip():
                return values[0].strip()
        return ""

    return {
        "title": pick("title", "share_title", "name", "keyword", "q"),
        "description": pick("desc", "description", "share_desc", "summary"),
    }


def _is_low_value_title(title: str) -> bool:
    normalized = title.strip().lower()
    if not normalized:
        return True
    low_value_markers = ("不见了", "不存在", "404", "not found", "error", "页面")
    return any(marker in normalized for marker in low_value_markers)


def _extract_metadata_from_html(raw_html: str, final_url: str) -> dict[str, Any]:
    soup = BeautifulSoup(raw_html, "html.parser")

    def pick_meta(*names: str) -> str:
        for name in names:
            tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
            if tag and tag.get("content"):
                return str(tag["content"]).strip()
        return ""

    title = pick_meta("og:title", "twitter:title")
    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()

    description = pick_meta("og:description", "description", "twitter:description")
    image = pick_meta("og:image", "twitter:image")
    site_name = pick_meta("og:site_name", "application-name")

    return {
        "final_url": final_url,
        "title": html.unescape(title),
        "description": html.unescape(description),
        "image": image,
        "site_name": html.unescape(site_name),
        "fetched": True,
    }


async def _fetch_page_metadata(url: str) -> dict[str, Any]:
    if not re.match(r"^https?://", url, flags=re.I):
        return {"final_url": url, "title": _extract_title_from_url(url), "description": "", "image": "", "fetched": False}

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(2.6, connect=1.2)) as client:
            response = await client.get(url, headers=headers)
            content_type = response.headers.get("content-type", "")
            if response.status_code >= 400 or "text/html" not in content_type:
                return {
                    "final_url": str(response.url),
                    "title": _extract_title_from_url(url),
                    "description": "",
                    "image": "",
                    "http_status": response.status_code,
                    "fetched": False,
                }
            return _extract_metadata_from_html(response.text[:200_000], str(response.url))
    except Exception as exc:
        return {
            "final_url": url,
            "title": _extract_title_from_url(url),
            "description": "",
            "image": "",
            "fetch_error": exc.__class__.__name__,
            "fetched": False,
        }


def _build_signals(url: str, metadata: dict[str, Any]) -> TextSignals:
    platform = _detect_platform(metadata.get("final_url") or url)
    query_metadata = _extract_query_metadata(url)
    fetched_title = str(metadata.get("title") or "")
    fetched_description = str(metadata.get("description") or "")
    fetched_usable = bool(metadata.get("fetched")) and not _is_low_value_title(fetched_title)
    url_derived_title = _extract_title_from_url(url)
    title = query_metadata["title"] or ("" if _is_low_value_title(fetched_title) else fetched_title) or url_derived_title or f"{platform} 内容链接"
    description = query_metadata["description"] or ("" if _is_low_value_title(fetched_title) else fetched_description)
    if query_metadata["title"]:
        metadata["title"] = query_metadata["title"]
    if query_metadata["description"]:
        metadata["description"] = query_metadata["description"]
    metadata["fetched"] = fetched_usable or bool(query_metadata["title"] or query_metadata["description"])
    metadata["source_type"] = (
        "page_metadata"
        if fetched_usable
        else "url_parameters"
        if query_metadata["title"] or query_metadata["description"]
        else "url_semantics"
    )
    if not fetched_usable and fetched_title:
        metadata["ignored_title"] = fetched_title
    parsed = urlparse(url if "://" in url else f"https://{url}")
    url_text = unquote(" ".join([parsed.netloc, parsed.path, parsed.query]))
    normalized_text = " ".join(part for part in [title, description, url_text] if part)
    tokens = _tokenize_text(normalized_text)
    metadata_confidence = 0.25
    if fetched_usable:
        metadata_confidence += 0.35
    if query_metadata["title"] or query_metadata["description"]:
        metadata_confidence += 0.25
    if title and title != f"{platform} 内容链接":
        metadata_confidence += 0.2
    if description:
        metadata_confidence += 0.12
    if metadata.get("image"):
        metadata_confidence += 0.08

    unique_chars = len(set(url))
    url_entropy = unique_chars / max(len(url), 1)
    return TextSignals(
        platform=platform,
        normalized_text=normalized_text,
        title=title[:120],
        description=description[:260],
        tokens=tokens,
        metadata_confidence=_clamp(metadata_confidence, 0.15, 1.0),
        has_cover=bool(metadata.get("image")),
        url_entropy=_clamp(url_entropy, 0.05, 1.0),
    )


def _infer_features(signals: TextSignals, url: str) -> dict[str, Any]:
    text = signals.normalized_text
    token_count = max(len(signals.tokens), 1)
    product_hits = _count_terms(text, PRODUCT_TERMS)
    hook_hits = _count_terms(text, HOOK_TERMS)
    proof_hits = _count_terms(text, PROOF_TERMS)
    cta_hits = _count_terms(text, CTA_TERMS)
    emotion_hits = _count_terms(text, EMOTION_TERMS)
    scene_hits = _count_terms(text, SCENE_TERMS)

    title_len = len(signals.title)
    description_len = len(signals.description)
    title_density = min(1.0, token_count / 18)
    title_compactness = 1.0 - min(abs(title_len - 28) / 72, 0.65)
    platform_bonus = 0.1 if signals.platform in {"腾讯视频", "QQ 空间", "小红书", "抖音"} else 0.0

    hook_strength = _clamp(0.22 + hook_hits * 0.15 + product_hits * 0.07 + title_compactness * 0.22 + platform_bonus, 0.18, 0.96)
    proof_strength = _clamp(0.2 + proof_hits * 0.16 + signals.metadata_confidence * 0.24 + (0.12 if signals.has_cover else 0), 0.16, 0.95)
    cta_strength = _clamp(0.18 + cta_hits * 0.18 + product_hits * 0.04 + scene_hits * 0.05, 0.12, 0.9)
    emotion_variance = _clamp(0.22 + emotion_hits * 0.13 + hook_hits * 0.07 + signals.url_entropy * 0.22, 0.18, 0.92)
    scene_transfer = _clamp(0.18 + scene_hits * 0.14 + product_hits * 0.06 + platform_bonus, 0.12, 0.9)
    content_density = _clamp(0.24 + title_density * 0.28 + min(description_len / 160, 1) * 0.18 + signals.metadata_confidence * 0.18, 0.16, 0.96)

    explanations = []
    if hook_hits:
        explanations.append(f"标题/描述命中 {hook_hits} 个 Hook 触发词")
    if proof_hits:
        explanations.append(f"内容文本包含 {proof_hits} 个证据型表达")
    if cta_hits:
        explanations.append(f"检测到 {cta_hits} 个转化动作词")
    if signals.has_cover:
        explanations.append("页面提供 OpenGraph 封面图，可用于视觉张力估计")
    if not metadata_has_enough_context(signals):
        explanations.append("外链元信息有限，系统切换到 URL 语义与平台先验特征")

    if not explanations:
        explanations.append("依据平台类型、URL 语义密度和内容先验生成基础画像")

    return {
        "platform": signals.platform,
        "title": signals.title,
        "description": signals.description,
        "title_length": title_len,
        "description_length": description_len,
        "token_count": token_count,
        "product_hits": product_hits,
        "hook_hits": hook_hits,
        "proof_hits": proof_hits,
        "cta_hits": cta_hits,
        "emotion_hits": emotion_hits,
        "scene_hits": scene_hits,
        "hook_strength": round(hook_strength, 3),
        "proof_strength": round(proof_strength, 3),
        "cta_strength": round(cta_strength, 3),
        "emotion_variance": round(emotion_variance, 3),
        "scene_transfer": round(scene_transfer, 3),
        "content_density": round(content_density, 3),
        "metadata_confidence": round(signals.metadata_confidence, 3),
        "has_cover": signals.has_cover,
        "explanations": explanations,
        "stable_seed": hashlib.sha256(url.encode("utf-8")).hexdigest()[:12],
    }


def metadata_has_enough_context(signals: TextSignals) -> bool:
    return signals.metadata_confidence >= 0.55 and (len(signals.title) >= 8 or len(signals.description) >= 20)


def _jitter(url: str, index: int, span: float = 4.0) -> float:
    return (_hash_unit(url, index) - 0.5) * span


def _score_radar(features: dict[str, Any], url: str) -> list[int]:
    hook = float(features["hook_strength"])
    proof = float(features["proof_strength"])
    cta = float(features["cta_strength"])
    emotion = float(features["emotion_variance"])
    density = float(features["content_density"])
    metadata = float(features["metadata_confidence"])
    has_cover = 1.0 if features["has_cover"] else 0.0

    visual = 48 + density * 21 + hook * 13 + metadata * 10 + has_cover * 8 + _jitter(url, 1)
    bgm_fit = 46 + emotion * 22 + density * 12 + metadata * 8 + _jitter(url, 2, 5.5)
    first3 = 42 + hook * 34 + density * 12 + min(features["hook_hits"], 3) * 4 + _jitter(url, 3)
    emotion_var = 44 + emotion * 31 + proof * 9 + min(features["emotion_hits"], 3) * 5 + _jitter(url, 4)
    hook_density = 40 + hook * 26 + cta * 11 + proof * 9 + min(features["product_hits"], 3) * 4 + _jitter(url, 5)

    return [_score(visual), _score(bgm_fit), _score(first3), _score(emotion_var), _score(hook_density)]


def _build_retention_curve(features: dict[str, Any], radar: list[int], url: str) -> list[float]:
    hook = float(features["hook_strength"])
    proof = float(features["proof_strength"])
    cta = float(features["cta_strength"])
    emotion = float(features["emotion_variance"])

    start = 96.5 + hook * 2.2
    final_floor = 31 + hook * 8 + cta * 7 + proof * 4
    decay = (start - final_floor) / 59
    proof_second = int(round(14 + proof * 9 + _jitter(url, 20, 4)))
    emotion_second = int(round(28 + emotion * 15 + _jitter(url, 21, 5)))
    cta_second = int(round(44 + cta * 8 + _jitter(url, 22, 4)))

    curve: list[float] = []
    for second in range(60):
        base = start - decay * second
        texture = math.sin(second / 3.7 + _hash_unit(url, 30) * math.pi) * 1.2
        proof_bump = math.exp(-((second - proof_second) ** 2) / 18) * (2.6 + proof * 3.2)
        emotion_bump = math.exp(-((second - emotion_second) ** 2) / 22) * (1.8 + emotion * 2.6)
        cta_bump = math.exp(-((second - cta_second) ** 2) / 16) * (1.3 + cta * 2.2)
        value = base + texture + proof_bump + emotion_bump + cta_bump
        curve.append(round(_clamp(value, 24, 99), 1))

    curve[0] = round(_clamp(start, 94, 99), 1)
    return curve


def _pick_product(features: dict[str, Any]) -> str:
    text = f"{features.get('title', '')} {features.get('description', '')}"
    for term in PRODUCT_TERMS:
        if term in text:
            return term
    if features["platform"] == "腾讯视频":
        return "内容选题"
    return "种草内容"


def _build_script_pair(features: dict[str, Any]) -> tuple[str, str]:
    product = _pick_product(features)
    platform = features["platform"]
    scene = "校园人群" if features["scene_hits"] else "目标用户"
    original = (
        f"今天想和大家分享一个最近看到的{product}。"
        f"这条链接来自{platform}，标题和描述里能提取出一些基础卖点。"
        "整体表达比较平铺，痛点、证据和行动指令没有被压缩到关键节点。"
        "如果你也感兴趣，可以先收藏一下，后面我会继续补充更多细节。"
    )

    optimized = (
        f"先别划走，如果你正在为{product}是否值得投入时间纠结，前 3 秒先看结论。"
        f"这条内容最强的点不是普通推荐，而是把{scene}的真实痛点、证据和行动路径放在同一条链路里。"
        "中段必须补上对比、场景或数据截图，让用户知道变化不是一句主观感受。"
        "结尾直接给出下一步动作：收藏、点击链接或进入评论区领取清单，不要把转化停在模糊建议。"
    )
    return original, optimized


def _build_script_diff(original: str, optimized: str, features: dict[str, Any]) -> list[dict[str, str]]:
    original_lines = split_sentences(original)
    optimized_lines = split_sentences(optimized)
    labels = ["Hook 后置", "证据不足", "场景缺失", "CTA 偏弱"]
    reasons = [
        "首句需要先给利益点和痛点，减少用户滑走概率。",
        "中段加入可验证证据，提升内容可信度。",
        "把泛泛推荐改成明确人群和场景，便于平台迁移。",
        "结尾改成直接行动指令，让转化路径更短。",
    ]

    rows = []
    for index in range(max(len(original_lines), len(optimized_lines))):
        rows.append(
            {
                "type": "replace",
                "issue_tag": labels[index % len(labels)],
                "original": original_lines[index] if index < len(original_lines) else "缺少明确补充句。",
                "optimized": optimized_lines[index] if index < len(optimized_lines) else optimized_lines[-1],
                "reason": reasons[index % len(reasons)],
            }
        )
    return rows


def split_sentences(text: str) -> list[str]:
    lines = re.split(r"(?<=[。！？!?])\s*", text.strip())
    return [line for line in lines if line]


def _build_interventions(features: dict[str, Any], radar: list[int], curve: list[float], url: str) -> list[dict[str, Any]]:
    proof_second = max(8, min(28, int(round(12 + features["proof_strength"] * 12 + _jitter(url, 41, 5)))))
    cta_second = max(36, min(55, int(round(43 + features["cta_strength"] * 9 + _jitter(url, 42, 5)))))
    valley_second = min(range(8, 46), key=lambda index: curve[index])

    return [
        {
            "second": 3,
            "title": "首屏 Hook 压缩",
            "description": f"前 3 秒留存评分 {radar[2]}，建议直接前置痛点和结果承诺。",
            "tone": "warning",
        },
        {
            "second": proof_second,
            "title": "证据密度补强",
            "description": f"证据强度 {round(features['proof_strength'] * 100)}%，建议插入对比、实拍或数据截图。",
            "tone": "primary",
        },
        {
            "second": cta_second if features["cta_strength"] >= 0.35 else valley_second,
            "title": "转化收口",
            "description": f"CTA 强度 {round(features['cta_strength'] * 100)}%，需要明确下一步动作。",
            "tone": "success",
        },
    ]


def _build_insight_cards(features: dict[str, Any], radar: list[int], curve: list[float]) -> list[dict[str, Any]]:
    rebound = max(curve[8:55]) - min(curve[8:55])
    return [
        {
            "label": "开场抓取效率",
            "value": f"Hook 命中 {features['hook_hits']} 次，标题长度 {features['title_length']}，前 3 秒评分 {radar[2]}。",
            "score": radar[2],
            "evidence": "依据：Hook 触发词、标题压缩度、平台先验权重。",
        },
        {
            "label": "内容证据强度",
            "value": f"证据词命中 {features['proof_hits']} 次，元信息置信度 {round(features['metadata_confidence'] * 100)}%。",
            "score": radar[0],
            "evidence": "依据：OpenGraph 标题/描述/封面与实测类关键词。",
        },
        {
            "label": "情绪波峰分布",
            "value": f"情绪波动评分 {radar[3]}，预测中段峰谷差 {rebound:.1f} 个百分点。",
            "score": radar[3],
            "evidence": "依据：情绪词、反差表达和 60 秒留存曲线形态。",
        },
        {
            "label": "转化收口效率",
            "value": f"CTA 命中 {features['cta_hits']} 次，Hook 密度评分 {radar[4]}。",
            "score": radar[4],
            "evidence": "依据：行动词、稀缺词和结尾转化位置。",
        },
    ]


def _build_evidence(features: dict[str, Any], metadata: dict[str, Any]) -> list[dict[str, Any]]:
    evidence = [
        {"label": "平台识别", "value": features["platform"], "confidence": 0.9 if features["platform"] != "未知平台" else 0.42},
        {"label": "标题样本", "value": features["title"] or "未读取到标题，使用 URL 语义解析", "confidence": features["metadata_confidence"]},
        {"label": "规则解释", "value": "；".join(features["explanations"][:3]), "confidence": 0.82},
    ]
    if metadata.get("image"):
        evidence.append({"label": "封面信号", "value": "检测到 OpenGraph 封面图", "confidence": 0.76})
    return evidence


def _build_explainable_payload(url: str, metadata: dict[str, Any], features: dict[str, Any]) -> dict[str, Any]:
    radar = _score_radar(features, url)
    curve = _build_retention_curve(features, radar, url)
    original, optimized = _build_script_pair(features)
    confidence = round(_clamp(0.45 + features["metadata_confidence"] * 0.35 + features["content_density"] * 0.18, 0.42, 0.94), 2)
    evidence_level = "元信息增强" if features["metadata_confidence"] >= 0.62 else "URL 语义解析"
    conversion_low = round(5 + features["hook_strength"] * 6 + features["cta_strength"] * 5)
    conversion_high = round(conversion_low + 4 + features["proof_strength"] * 4)
    enriched_metadata = {
        **metadata,
        "platform": features["platform"],
        "category": _pick_product(features),
        "duration": metadata.get("duration"),
    }

    return {
        "analyzed_url": url,
        "source": {
            "page_metadata": "metadata_rules",
            "url_parameters": "url_parameter_rules",
            "url_semantics": "url_rules",
        }.get(str(metadata.get("source_type")), "url_rules"),
        "model": "KOC-Engine Explainable Pipeline v1",
        "metadata": enriched_metadata,
        "features": features,
        "evidence": _build_evidence(features, metadata),
        "confidence": confidence,
        "evidence_level": evidence_level,
        "conversion_lift": {
            "low": conversion_low,
            "high": conversion_high,
            "label": f"+{conversion_low}% ~ +{conversion_high}%",
            "basis": "基于标题/描述/URL 命中特征估计，需通过 A/B Test 校准",
        },
        "radar_scores": radar,
        "retention_curve": curve,
        "original_script": original,
        "optimized_script": optimized,
        "script_diff": _build_script_diff(original, optimized, features),
        "insight_cards": _build_insight_cards(features, radar, curve),
        "interventions": _build_interventions(features, radar, curve, url),
    }


def _normalize_payload(payload: dict[str, Any], base: dict[str, Any], model: str) -> dict[str, Any]:
    merged = dict(base)
    for key in ("original_script", "optimized_script", "script_diff", "insight_cards"):
        if payload.get(key):
            merged[key] = payload[key]
    merged["source"] = "openai_enhanced"
    merged["model"] = f"{base['model']} + {model}"
    return merged


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip().removeprefix("```json").removesuffix("```").strip()
    return json.loads(cleaned)


def _call_model(base_payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    api_key, base_url, model = _resolve_model_settings()
    timeout_seconds = _resolve_timeout_seconds()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_seconds, max_retries=0)
    response = client.chat.completions.create(
        model=model,
        temperature=0.45,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "base_payload": base_payload,
                        "instruction": "只润色脚本文案、逐句 Diff 和 insight 表达，不要改动 radar_scores、retention_curve、interventions、features、metadata。",
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    )
    content = response.choices[0].message.content or "{}"
    return _extract_json(content), model


async def _optional_openai_enhance(base_payload: dict[str, Any]) -> dict[str, Any]:
    if os.getenv("KOC_ENGINE_ENABLE_OPENAI", "0") != "1":
        return base_payload

    try:
        raw_result, model = await asyncio.to_thread(_call_model, base_payload)
        return _normalize_payload(raw_result, base_payload, model)
    except Exception as exc:
        print(f"[KOC-Engine] openai enhancement skipped: {exc}")
        return base_payload


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "KOC-Engine API", "status": "ok", "engine": "explainable-v1"}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "explainable-v1"}


@app.post("/api/reverse-engineer")
async def reverse_engineer(payload: ReverseEngineerRequest) -> dict[str, Any]:
    url = _validate_content_url(payload.url)
    print(f"[KOC-Engine] explainable analysis start: {url}")

    metadata = await _fetch_page_metadata(url)
    signals = _build_signals(url, metadata)
    features = _infer_features(signals, url)
    base_payload = _build_explainable_payload(url, metadata, features)
    result = await _optional_openai_enhance(base_payload)

    print(
        "[KOC-Engine] analysis completed: "
        f"source={result.get('source')} confidence={result.get('confidence')}"
    )
    return result
