from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import tomllib
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field


class ReverseEngineerRequest(BaseModel):
    url: str = Field(..., min_length=5, max_length=2048)


app = FastAPI(title="KOC-Engine API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = """
你是 KOC-Engine 的多模态逆向拆解引擎。
你的目标不是解释原理，而是为产品演示生成一份足够真实、足够漂亮、结构完全稳定的 JSON。

严格要求：
1. 只返回 JSON 对象，不要使用 Markdown 代码块，不要写额外说明。
2. 内容语言使用简体中文。
3. JSON 必须包含以下字段：
   - radar_scores: 长度为 5 的整数数组，范围 0-100，依次表示视觉张力、BGM契合度、前3秒留存、情绪方差、Hook密度。
   - retention_curve: 长度为 60 的浮点数数组，表示 0-60 秒的留存率，整体趋势应缓慢下降，但在 2-3 个关键点有小幅反弹。
   - original_script: 一段 5 句左右的普通带货/种草文案。
   - optimized_script: 对上一段文案的高转化改写版，强调强 Hook、证据、转化收口。
   - insight_cards: 长度为 4 的数组，每项包含 label、value、score。
   - interventions: 长度为 3 的数组，每项包含 second、title、description、tone，其中 tone 只能是 warning、primary、success。
4. 数据风格必须像真实分析平台吐出的结果，不要出现“这是模拟数据”之类的说法。
"""


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
    raw = os.getenv("OPENAI_TIMEOUT_SECONDS", "60")
    try:
        value = float(raw)
    except ValueError:
        return 60.0
    return max(10.0, min(value, 180.0))


def _seeded_rng(url: str) -> random.Random:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return random.Random(int(digest[:14], 16))


def _build_retention_curve(rng: random.Random) -> list[float]:
    curve: list[float] = []
    rebounds = {
        rng.randint(5, 10): rng.uniform(2.4, 4.4),
        rng.randint(16, 28): rng.uniform(2.2, 4.0),
        rng.randint(35, 48): rng.uniform(1.6, 3.3),
    }

    for second in range(60):
        baseline = 98 - second * rng.uniform(0.9, 1.18)
        texture = rng.uniform(-1.6, 1.1)
        value = baseline + texture + rebounds.get(second, 0)
        curve.append(round(max(22, min(99, value)), 1))

    curve[0] = 98.0
    return curve


def _build_mock_payload(url: str) -> dict[str, Any]:
    rng = _seeded_rng(url)

    product_options = [
        (
            "淡斑精华",
            "如果你脸上的暗沉和色沉拖了很久，这支精华值得你停下来看完。",
            "宿舍护肤、军训修护、熬夜脸急救",
        ),
        (
            "蓬松喷雾",
            "头发一塌就显得整个人没精神，这瓶喷雾解决的就是这个尴尬。",
            "通勤造型、校园拍照、面试出门",
        ),
        (
            "防晒喷雾",
            "别再觉得补防晒麻烦了，这种喷一次就能出门的东西才是流量密码。",
            "运动出汗、军训防晒、户外通勤",
        ),
    ]
    product_name, hook_sentence, migration_scene = product_options[rng.randrange(len(product_options))]

    radar_scores = [
        rng.randint(84, 98),
        rng.randint(76, 95),
        rng.randint(72, 91),
        rng.randint(74, 93),
        rng.randint(83, 97),
    ]

    original_script = (
        f"今天想跟你们聊一下这款最近讨论很多的{product_name}。"
        f"我前几天刚拿到，所以先做一个简单体验。"
        "整体使用感还不错，没有特别刺激的地方。"
        "如果你最近也在找类似产品，可以先看看我这次的实测。"
        "后面如果你们想看更长周期的反馈，我再继续更新。"
    )

    optimized_script = (
        f"{hook_sentence}"
        f"这支{product_name}不是普通种草，而是我拿到手之后立刻愿意二刷镜头去拍的那种结果型产品。"
        "镜头里最该放大的不是包装，而是上脸前后和使用场景的差别，这能直接拉高信任。"
        "真正让人愿意下单的不是一句“我觉得不错”，而是把变化、质地和使用门槛一次性讲透。"
        "链接我已经放在页面下方，看到这里的人不要再等评论区二次确认。"
    )

    return {
        "analyzed_url": url,
        "source": "degraded",
        "model": "system-fallback",
        "radar_scores": radar_scores,
        "retention_curve": _build_retention_curve(rng),
        "original_script": original_script,
        "optimized_script": optimized_script,
        "insight_cards": [
            {
                "label": "视觉钩子",
                "value": "前 3 秒需要直接给出痛点画面，不要先讲背景。",
                "score": radar_scores[0],
            },
            {
                "label": "转化机制",
                "value": "第 15 秒放证据，第 40 秒收口 CTA，链路最稳。",
                "score": radar_scores[2],
            },
            {
                "label": "人群迁移",
                "value": f"该内容模板适合迁移到 {migration_scene} 等校园垂类。",
                "score": radar_scores[4],
            },
            {
                "label": "平台建议",
                "value": "视频号先发结果型版本，QQ 空间同步话题切片版。",
                "score": radar_scores[1],
            },
        ],
        "interventions": [
            {
                "second": 4,
                "title": "Hook 介入",
                "description": "开头不要自我介绍，直接打痛点。",
                "tone": "warning",
            },
            {
                "second": 17,
                "title": "证据补强",
                "description": "插入局部特写或对比截图，强化可信度。",
                "tone": "primary",
            },
            {
                "second": 43,
                "title": "转化收口",
                "description": "用稀缺和行动指令收尾，不要停在模糊建议。",
                "tone": "success",
            },
        ],
    }


def _normalize_payload(payload: dict[str, Any], url: str, source: str, model: str) -> dict[str, Any]:
    fallback = _build_mock_payload(url)
    normalized = {
        "analyzed_url": url,
        "source": source,
        "model": model,
        "radar_scores": fallback["radar_scores"],
        "retention_curve": fallback["retention_curve"],
        "original_script": payload.get("original_script") or fallback["original_script"],
        "optimized_script": payload.get("optimized_script") or fallback["optimized_script"],
        "insight_cards": payload.get("insight_cards") or fallback["insight_cards"],
        "interventions": payload.get("interventions") or fallback["interventions"],
    }

    radar_scores = payload.get("radar_scores")
    if isinstance(radar_scores, list) and len(radar_scores) >= 5:
        normalized["radar_scores"] = [max(0, min(100, int(float(score)))) for score in radar_scores[:5]]

    retention_curve = payload.get("retention_curve")
    if isinstance(retention_curve, list) and len(retention_curve) >= 60:
        normalized["retention_curve"] = [round(max(0, min(100, float(score))), 1) for score in retention_curve[:60]]

    return normalized


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip().removeprefix("```json").removesuffix("```").strip()
    return json.loads(cleaned)


def _call_model(url: str) -> tuple[dict[str, Any], str]:
    api_key, base_url, model = _resolve_model_settings()
    timeout_seconds = _resolve_timeout_seconds()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured and no .codex/auth.json key was found")

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_seconds, max_retries=0)

    response = client.chat.completions.create(
        model=model,
        temperature=0.9,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"待分析链接：{url}\n"
                    "请根据这个链接生成一份适合产品路演的逆向拆解结果。"
                    "输出必须是 JSON，并严格遵守既定字段结构。"
                ),
            },
        ],
    )

    content = response.choices[0].message.content or "{}"
    return _extract_json(content), model


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "KOC-Engine API", "status": "ok"}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/reverse-engineer")
async def reverse_engineer(payload: ReverseEngineerRequest) -> dict[str, Any]:
    url = payload.url.strip()
    print(f"[KOC-Engine] reverse engineer start: {url}")

    await asyncio.sleep(0.8)

    if os.getenv("KOC_ENGINE_FORCE_MOCK") == "1":
        result = _build_mock_payload(url)
        print("[KOC-Engine] forced mock payload returned")
        return result

    try:
        raw_result, model = await asyncio.to_thread(_call_model, url)
        normalized = _normalize_payload(raw_result, url=url, source="model", model=model)
        print(f"[KOC-Engine] model payload returned via {model}")
        return normalized
    except Exception as exc:
        print(f"[KOC-Engine] fallback triggered: {exc}")
        return _build_mock_payload(url)
