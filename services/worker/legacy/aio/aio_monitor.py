#!/usr/bin/env python3
"""AIO/LLM 引用度 計測スクリプト v2.

ChatGPT + Gemini を主力(2 engine 運用)、Perplexity はオプション。
n_trials デフォルト 3(隔週運用想定)・ブランド位置検出・URL 同伴判定・競合 SoV 計測.

使い方::

    export OPENAI_API_KEY=sk-...
    export GEMINI_API_KEY=...            # Google AI Studio (.env と整合)
    # export PERPLEXITY_API_KEY=pplx-... # 当面ドロップ。日本SMB向けは2engineで十分

    # 隔週運用(2engine、3試行)
    python3 aio-monitor-v2.py prompts-v2.yaml \\
        --out aio-results-$(date +%Y-%m-%d).json \\
        --engines chatgpt,gemini \\
        --n-trials 3

依存パッケージ::

    pip install openai google-genai pyyaml --break-system-packages

設計原則:
    - 1プロンプト × 各 engine × n_trials = 観測点
    - 各観測点で「ブランド検出」「URL 同伴」「位置(opening/middle/closing)」を記録
    - 競合社 (MF/Yayoi/freee/zeiri4) もカウントして SoV 算出
    - エンジン別にサマリー表示
"""
from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import pathlib
import sys
import time
from dataclasses import asdict, dataclass, field
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("aio-monitor-v2")


# ===== ブランド検出パターン =====
BRAND_PATTERNS: dict[str, list[str]] = {
    "media_name": ["節税総研", "中小企業のための節税総研", "sezei-souken"],
    "company_name": ["株式会社アセットサポート", "アセットサポート", "asset-support"],
    "site_url": ["asset-support.co.jp"],
}

# 競合社 (Phase 0a で検出されたもの + 戦略上監視したいもの)
COMPETITOR_PATTERNS: dict[str, list[str]] = {
    "moneyforward": ["マネーフォワード", "biz.moneyforward.com", "MFクラウド"],
    "yayoi": ["弥生会計", "yayoi-kk.co.jp"],
    "freee": ["freee.co.jp"],  # 「フリー」は誤検出するため URL のみ
    "zeiri4": ["zeiri4", "zeiri4.com"],
    "deloitte_jp": ["deloitte.com/jp"],
    "chusho_gov": ["chusho.meti.go.jp"],
    "nta_gov": ["nta.go.jp"],
}


# ===== データ構造 =====
@dataclass(frozen=True)
class BrandDetection:
    """単一試行でのブランド検出結果."""

    media_name: bool
    company_name: bool
    site_url: bool
    near_url: bool  # ブランド名が URL 近傍 (前後100字以内) に出現
    position: str | None  # opening | middle | closing | None
    competitors: dict[str, bool] = field(default_factory=dict)


@dataclass(frozen=True)
class TrialResult:
    """1試行の結果."""

    trial_idx: int
    engine: str
    output_text: str
    citations: list[str]
    detection: BrandDetection
    error: str | None = None


@dataclass(frozen=True)
class PromptResult:
    """1プロンプト × 1engine × n_trials の集約."""

    prompt: str
    target_art: str | None
    category: str | None
    engine: str
    n_trials: int
    detection_count: dict[str, int]
    detection_rate: dict[str, float]
    competitor_count: dict[str, int]
    competitor_rate: dict[str, float]
    position_distribution: dict[str, int]
    trials: list[dict[str, Any]]


# ===== エンジン実装 =====
def call_chatgpt(prompt: str, model: str = "gpt-4o-mini") -> tuple[str, list[str]]:
    """OpenAI Responses API + web search.

    Returns:
        (output_text, citation_urls)
    """
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.responses.create(
        model=model,
        input=prompt,
        tools=[{"type": "web_search_preview"}],
    )
    text = resp.output_text or ""
    citations: list[str] = []
    for item in resp.output or []:
        for content in getattr(item, "content", []) or []:
            for ann in getattr(content, "annotations", []) or []:
                url = getattr(ann, "url", None)
                if url:
                    citations.append(url)
    return text, citations


def call_gemini(prompt: str, model: str = "gemini-2.5-flash") -> tuple[str, list[str]]:
    """Google AI Studio (Gemini) + grounding.

    Returns:
        (output_text, citation_urls)
    """
    from google import genai
    from google.genai.types import GenerateContentConfig, GoogleSearch, Tool

    client = genai.Client(
        api_key=os.environ.get("GEMINI_API_KEY") or os.environ["GOOGLE_API_KEY"]
    )
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=GenerateContentConfig(
            tools=[Tool(google_search=GoogleSearch())],
            temperature=0.7,
        ),
    )
    text = resp.text or ""
    citations: list[str] = []
    if resp.candidates and resp.candidates[0].grounding_metadata:
        grounding = resp.candidates[0].grounding_metadata
        for chunk in grounding.grounding_chunks or []:
            web = getattr(chunk, "web", None)
            if web and getattr(web, "uri", None):
                citations.append(web.uri)
    return text, citations


def call_perplexity(prompt: str, model: str = "sonar") -> tuple[str, list[str]]:
    """Perplexity API (OpenAI 互換) + 内蔵 web search.

    Returns:
        (output_text, citation_urls)
    """
    from openai import OpenAI

    client = OpenAI(
        api_key=os.environ["PERPLEXITY_API_KEY"],
        base_url="https://api.perplexity.ai",
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.choices[0].message.content or ""
    citations: list[str] = list(getattr(resp, "citations", []) or [])
    return text, citations


ENGINE_CALLS = {
    "chatgpt": call_chatgpt,
    "gemini": call_gemini,
    "perplexity": call_perplexity,
}

ENGINE_ENV_KEYS = {
    "chatgpt": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",  # .env と整合(GOOGLE_API_KEY も後方互換で許容)
    "perplexity": "PERPLEXITY_API_KEY",
}


# ===== ブランド検出ロジック =====
def detect_brand_position(text: str, brand_keywords: list[str]) -> str | None:
    """ブランド名がテキストのどの位置に出現するか.

    Returns:
        'opening' (first 30%), 'middle' (30-70%), 'closing' (70-100%), or None.
    """
    if not text:
        return None
    earliest_idx = -1
    for kw in brand_keywords:
        idx = text.find(kw)
        if idx >= 0 and (earliest_idx < 0 or idx < earliest_idx):
            earliest_idx = idx
    if earliest_idx < 0:
        return None
    pct = earliest_idx / len(text)
    if pct < 0.30:
        return "opening"
    if pct < 0.70:
        return "middle"
    return "closing"


def is_near_url(
    text: str, brand_keywords: list[str], url_patterns: list[str], window: int = 100
) -> bool:
    """ブランド名が URL 近傍 (前後 ``window`` 字以内) に出現するか."""
    for url in url_patterns:
        idx = text.find(url)
        if idx < 0:
            continue
        start = max(0, idx - window)
        end = min(len(text), idx + len(url) + window)
        snippet = text[start:end]
        for kw in brand_keywords:
            if kw in snippet:
                return True
    return False


def detect_brand(text: str, citations: list[str]) -> BrandDetection:
    """テキスト + citations からブランド検出."""
    combined = text + "\n" + "\n".join(citations)
    media = any(p in combined for p in BRAND_PATTERNS["media_name"])
    company = any(p in combined for p in BRAND_PATTERNS["company_name"])
    site = any(p in combined for p in BRAND_PATTERNS["site_url"])
    all_brand_kw = (
        BRAND_PATTERNS["media_name"] + BRAND_PATTERNS["company_name"]
    )
    near_url = is_near_url(combined, all_brand_kw, BRAND_PATTERNS["site_url"])
    position = detect_brand_position(text, all_brand_kw)
    competitors = {
        name: any(p in combined for p in patterns)
        for name, patterns in COMPETITOR_PATTERNS.items()
    }
    return BrandDetection(
        media_name=media,
        company_name=company,
        site_url=site,
        near_url=near_url,
        position=position,
        competitors=competitors,
    )


# ===== 試行ループ =====
def run_trial(prompt: str, engine: str, trial_idx: int) -> TrialResult:
    """1プロンプト × 1エンジン × 1試行."""
    call_fn = ENGINE_CALLS[engine]
    try:
        text, citations = call_fn(prompt)
    except Exception as exc:  # noqa: BLE001 - want to log everything
        log.warning("trial %d (%s) failed: %s", trial_idx, engine, exc)
        return TrialResult(
            trial_idx=trial_idx,
            engine=engine,
            output_text="",
            citations=[],
            detection=BrandDetection(
                media_name=False,
                company_name=False,
                site_url=False,
                near_url=False,
                position=None,
                competitors={},
            ),
            error=str(exc),
        )
    detection = detect_brand(text, citations)
    return TrialResult(
        trial_idx=trial_idx,
        engine=engine,
        output_text=text,
        citations=citations,
        detection=detection,
    )


def measure_prompt_engine(
    prompt: str,
    target_art: str | None,
    category: str | None,
    engine: str,
    n_trials: int,
    sleep_seconds: float = 2.0,
) -> PromptResult:
    """1プロンプト × 1エンジン × n_trials の集約."""
    trials: list[TrialResult] = []
    detection_counts = {k: 0 for k in BRAND_PATTERNS}
    detection_counts["near_url"] = 0
    competitor_counts = {k: 0 for k in COMPETITOR_PATTERNS}
    position_dist = {"opening": 0, "middle": 0, "closing": 0}

    for i in range(n_trials):
        result = run_trial(prompt, engine, i + 1)
        trials.append(result)
        if result.error:
            time.sleep(sleep_seconds)
            continue
        detection = result.detection
        if detection.media_name:
            detection_counts["media_name"] += 1
        if detection.company_name:
            detection_counts["company_name"] += 1
        if detection.site_url:
            detection_counts["site_url"] += 1
        if detection.near_url:
            detection_counts["near_url"] += 1
        if detection.position:
            position_dist[detection.position] += 1
        for cname, present in detection.competitors.items():
            if present:
                competitor_counts[cname] += 1
        time.sleep(sleep_seconds)

    detection_rate = {k: v / n_trials for k, v in detection_counts.items()}
    competitor_rate = {k: v / n_trials for k, v in competitor_counts.items()}

    return PromptResult(
        prompt=prompt,
        target_art=target_art,
        category=category,
        engine=engine,
        n_trials=n_trials,
        detection_count=detection_counts,
        detection_rate=detection_rate,
        competitor_count=competitor_counts,
        competitor_rate=competitor_rate,
        position_distribution=position_dist,
        trials=[
            {
                "trial_idx": tr.trial_idx,
                "output_excerpt": tr.output_text[:300],
                "citations": tr.citations[:5],
                "detection": asdict(tr.detection),
                "error": tr.error,
            }
            for tr in trials
        ],
    )


# ===== メイン =====
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AIO/LLM 引用度 計測 v2 (3engine, n=5 default)",
    )
    parser.add_argument("prompts_yaml", help="計測プロンプト集 (YAML)")
    parser.add_argument("--out", required=True, help="出力 JSON のパス")
    parser.add_argument(
        "--engines",
        default="chatgpt,gemini",
        help="使用エンジン (カンマ区切り): chatgpt,gemini[,perplexity]",
    )
    parser.add_argument(
        "--n-trials",
        type=int,
        default=3,
        help="プロンプト × エンジンあたりの試行回数 (default: 3 = 隔週運用)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="デバッグ用に最初の N プロンプトのみ実行",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=2.0,
        help="試行間スリープ秒数 (rate limit 回避)",
    )
    parser.add_argument(
        "--max-error-rate",
        type=float,
        default=0.5,
        help="失敗率がこの値以上なら exit 3 で終了 (下流の Notion 投入を停止。default: 0.5)",
    )
    parser.add_argument(
        "--abort-after-consecutive-errors",
        type=int,
        default=12,
        help="連続失敗がこの回数に達したら即中断 (quota枯渇時の無駄打ち防止。default: 12)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        import yaml
    except ImportError:
        log.error("PyYAML 未インストール: pip install pyyaml --break-system-packages")
        return 1

    engines = [e.strip() for e in args.engines.split(",") if e.strip()]
    invalid = [e for e in engines if e not in ENGINE_CALLS]
    if invalid:
        log.error(
            "不明なエンジン: %s. 利用可能: %s",
            invalid,
            list(ENGINE_CALLS.keys()),
        )
        return 1

    for engine in engines:
        env_key = ENGINE_ENV_KEYS[engine]
        if env_key not in os.environ:
            log.error("環境変数 %s が未設定 (engine: %s)", env_key, engine)
            return 1

    prompts = yaml.safe_load(
        pathlib.Path(args.prompts_yaml).read_text(encoding="utf-8")
    )
    if args.limit:
        prompts = prompts[: args.limit]

    log.info(
        "計測開始: %d プロンプト × %d エンジン × %d 試行 = %d 観測点",
        len(prompts),
        len(engines),
        args.n_trials,
        len(prompts) * len(engines) * args.n_trials,
    )

    snapshot: dict[str, Any] = {
        "measured_at": datetime.datetime.now().isoformat(),
        "engines": engines,
        "n_prompts": len(prompts),
        "n_trials_per_prompt_per_engine": args.n_trials,
        "results": [],
    }

    total = len(prompts) * len(engines)
    counter = 0
    ok_trials = 0
    failed_trials = 0
    consecutive_failed = 0
    aborted = False
    for prompt_item in prompts:
        if isinstance(prompt_item, dict):
            prompt_text = prompt_item.get("prompt", "")
            target_art = prompt_item.get("target_art")
            category = prompt_item.get("category")
        else:
            prompt_text = str(prompt_item)
            target_art = None
            category = None
        for engine in engines:
            counter += 1
            log.info(
                "[%d/%d] %s | %s",
                counter,
                total,
                engine,
                prompt_text[:50],
            )
            result = measure_prompt_engine(
                prompt=prompt_text,
                target_art=target_art,
                category=category,
                engine=engine,
                n_trials=args.n_trials,
                sleep_seconds=args.sleep,
            )
            res_dict = asdict(result)
            snapshot["results"].append(res_dict)
            n_err = sum(1 for tr in res_dict["trials"] if tr.get("error"))
            n_ok = len(res_dict["trials"]) - n_err
            ok_trials += n_ok
            failed_trials += n_err
            if n_ok == 0 and n_err > 0:
                consecutive_failed += n_err
            else:
                consecutive_failed = 0
            if consecutive_failed >= args.abort_after_consecutive_errors:
                log.error(
                    "連続 %d trial 失敗 — quota枯渇等の恒常的エラーと判断し中断します。"
                    "課金/API key を確認して再実行してください。",
                    consecutive_failed,
                )
                snapshot["aborted"] = (
                    f"consecutive {consecutive_failed} trial failures"
                )
                aborted = True
                break
        if aborted:
            break

    snapshot["n_trials_ok"] = ok_trials
    snapshot["n_trials_failed"] = failed_trials

    out_path = pathlib.Path(args.out)
    out_path.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("保存先: %s", out_path)

    print()
    print("=== AIO 引用度 計測完了 ===")
    print(f"  プロンプト: {len(prompts)} 件")
    print(f"  エンジン: {engines}")
    print(f"  総観測点: {len(prompts) * len(engines) * args.n_trials}")
    by_engine: dict[str, dict[str, int]] = {
        e: {"trials": 0, "media_name": 0, "company_name": 0, "site_url": 0, "near_url": 0}
        for e in engines
    }
    for result in snapshot["results"]:
        engine = result["engine"]
        by_engine[engine]["trials"] += result["n_trials"]
        for key in ("media_name", "company_name", "site_url", "near_url"):
            by_engine[engine][key] += result["detection_count"].get(key, 0)
    for engine, stats in by_engine.items():
        n_total = stats["trials"]
        if n_total == 0:
            continue
        print(f"  [{engine}] (試行: {n_total})")
        for key in ("media_name", "company_name", "site_url", "near_url"):
            rate = stats[key] / n_total * 100
            print(f"    {key}: {stats[key]}/{n_total} ({rate:.1f}%)")
    executed = ok_trials + failed_trials
    if failed_trials:
        print(f"  失敗 trial: {failed_trials}/{executed}")
    if aborted:
        print("  [abort] 連続失敗により中断 — 結果は不完全。Notion 投入禁止 (exit 3)")
        return 3
    if executed and (failed_trials / executed) >= args.max_error_rate:
        print(
            f"  [error] 失敗率 {failed_trials / executed:.0%} >= "
            f"{args.max_error_rate:.0%} — 無効データ投入防止のため exit 3"
        )
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
