#!/usr/bin/env python3
"""AIO引用率の計測（Notion 廃止に伴い MMS へ移設・2026-07-23）

★何をするか
  1. MMS の ContentItem から対象記事を選ぶ（aioTracked=true AND aioTier=指定）
  2. legacy/aio/prompts.yaml をその記事に絞る
  3. legacy/aio/aio_monitor.py を呼んで ChatGPT / Gemini に質問する
  4. 結果を ContentMetric に記録する（aio_trials / aio_hits ＋エンジン別）
  5. Tier を昇降格する

★aio_monitor.py は書き直さない（§6 既存資産）
  API を叩いて結果を返すだけで Notion に依存していない。
  そのまま legacy として置き、subprocess で呼ぶ。

★rate ではなく hits と trials を保存する
  §16.5「母数が足りなければ判定不能」。rate だけ持つと
  1試行1ヒットの 100% と 30試行30ヒットの 100% が区別できない。

★Tier の意味（旧 CLAUDE.md §16 AIO計測スキーム）
    Hot  engines=chatgpt,gemini  n_trials=3  週次
    Warm engines=chatgpt,gemini  n_trials=3  隔週
    Cold engines=chatgpt         n_trials=1  月次

環境変数:
  MMS_DATABASE_URL / OPENAI_API_KEY / GEMINI_API_KEY（か GOOGLE_API_KEY）
  MMS_WORKER_LEGACY_DIR … 既定 /app/legacy

使い方:
  python3 aio_run.py --tier hot
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

LEGACY_DIR = Path(os.environ.get("MMS_WORKER_LEGACY_DIR", "/app/legacy"))
AIO_DIR = LEGACY_DIR / "aio"

TIER_PARAMS = {
    "hot": {"engines": "chatgpt,gemini", "n_trials": 3},
    "warm": {"engines": "chatgpt,gemini", "n_trials": 3},
    "cold": {"engines": "chatgpt", "n_trials": 1},
}

ENGINE_SUFFIX = {
    "chatgpt": "chatgpt",
    "gpt-4o": "chatgpt",
    "gpt-4o-mini": "chatgpt",
    "gemini": "gemini",
    "gemini-2.5-flash": "gemini",
}

# ★昇降格の閾値（旧 aio-promote-demote.py の方針を踏襲）
#   直近の試行が少ないうちは動かさない。§16.5 母数が足りなければ判定不能。
MIN_TRIALS_TO_JUDGE = 20
PROMOTE_RATE = 0.05   # 5%以上ヒット → 1段上げる
DEMOTE_RATE = 0.0     # 一度もヒットしない → 1段下げる
LOOKBACK_DAYS = 60


def log(msg: str) -> None:
    print(f"[aio_run] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def use_utc(conn) -> None:
    with conn.cursor() as c:
        c.execute("SET TIME ZONE 'UTC'")


def load_prompts(targets: set[str]) -> list[dict]:
    """対象記事のプロンプトだけ返す。yaml が無ければ空"""
    import yaml  # worker イメージに入っている

    path = AIO_DIR / "prompts.yaml"
    if not path.exists():
        log(f"★プロンプト定義がありません: {path}")
        return []
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or []
    return [p for p in data if str(p.get("target_art") or "") in targets]


def run_monitor(prompts: list[dict], engines: str, n_trials: int) -> list[dict]:
    """legacy の aio_monitor.py を呼ぶ。結果 JSON を返す"""
    script = AIO_DIR / "aio_monitor.py"
    if not script.exists():
        raise RuntimeError(f"aio_monitor.py がありません: {script}")

    with tempfile.TemporaryDirectory() as td:
        pin = Path(td) / "prompts.yaml"
        pout = Path(td) / "out.json"
        import yaml

        with open(pin, "w", encoding="utf-8") as f:
            yaml.safe_dump(prompts, f, allow_unicode=True, sort_keys=False)

        # ★引数は aio_monitor.py の実装に合わせる（prompts は位置引数）
        cmd = [
            sys.executable, str(script),
            str(pin),
            "--out", str(pout),
            "--engines", engines,
            "--n-trials", str(n_trials),
        ]
        log(f"計測開始: {len(prompts)}プロンプト × {engines} × {n_trials}回")
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if r.returncode != 0:
            raise RuntimeError(
                f"aio_monitor.py が失敗（rc={r.returncode}）: {r.stderr[-500:]}"
            )
        if not pout.exists():
            raise RuntimeError("aio_monitor.py が出力を作りませんでした")
        with open(pout, encoding="utf-8") as f:
            data = json.load(f)
    return data.get("results", []) if isinstance(data, dict) else data


def promote_demote(cur, tier: str) -> list[tuple[str, str, str]]:
    """直近の実績で Tier を1段だけ動かす。判定できないものは触らない"""
    order = ["cold", "warm", "hot"]
    cur.execute(
        """
        SELECT c.id, c."externalId", c."aioTier"::text,
               COALESCE(SUM(m.value) FILTER (WHERE m.metric='aio_trials'),0) AS trials,
               COALESCE(SUM(m.value) FILTER (WHERE m.metric='aio_hits'),0)   AS hits
        FROM "ContentItem" c
        LEFT JOIN "ContentMetric" m
          ON m."contentItemId"=c.id
         AND m.metric IN ('aio_trials','aio_hits')
         AND m.date >= (CURRENT_DATE - %s::int)
        WHERE c."aioTracked" = true AND c."aioTier"::text = %s
        GROUP BY c.id, c."externalId", c."aioTier"
        """,
        (LOOKBACK_DAYS, tier),
    )
    moves: list[tuple[str, str, str]] = []
    for cid, eid, cur_tier, trials, hits in cur.fetchall():
        if trials < MIN_TRIALS_TO_JUDGE:
            # ★母数が足りない。判定不能であって「成果ゼロ」ではない（§16.5）
            continue
        rate = hits / trials if trials else 0.0
        i = order.index(cur_tier)
        new = cur_tier
        if rate > PROMOTE_RATE and i < len(order) - 1:
            new = order[i + 1]
        elif rate <= DEMOTE_RATE and i > 0:
            new = order[i - 1]
        if new == cur_tier:
            continue
        cur.execute(
            'UPDATE "ContentItem" SET "aioTier"=%s::"AioTier", "aioTierUpdatedAt"=now(), '
            '"aioNote"=%s, "updatedAt"=now() WHERE id=%s',
            (new, f"[aio_run] {cur_tier}→{new}（直近{LOOKBACK_DAYS}日 {int(hits)}/{int(trials)}）", cid),
        )
        moves.append((eid, cur_tier, new))
    return moves


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", required=True, choices=("hot", "warm", "cold"))
    ap.add_argument("--dry-run", action="store_true", help="対象の抽出だけして計測しない")
    args = ap.parse_args()

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    params = TIER_PARAMS[args.tier]
    today = datetime.now(timezone.utc).date().isoformat()

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        use_utc(conn)
        cur.execute(
            'SELECT id, "externalId" FROM "ContentItem" '
            'WHERE "aioTracked" = true AND "aioTier"::text = %s',
            (args.tier,),
        )
        rows = cur.fetchall()
        by_ext = {eid: cid for cid, eid in rows if eid}
        log(f"{args.tier}: 対象記事 {len(by_ext)}本")
        if not by_ext:
            log("対象なし。終了")
            return 0

        prompts = load_prompts(set(by_ext))
        log(f"該当プロンプト {len(prompts)}件")
        if not prompts:
            log("★プロンプトが1件も該当しません。prompts.yaml の target_art を確認してください")
            return 0

        if args.dry_run:
            log("dry-run のためここで終了")
            return 0

        results = run_monitor(prompts, params["engines"], params["n_trials"])
        log(f"結果 {len(results)}件")

        # (contentItemId, metric) -> 値
        #
        # ★出力は「1プロンプト × 1エンジン × n_trials」の集約で、
        #   個々の試行は results[].trials[] に入っている。試行単位で数える。
        #
        # ★ヒットの定義は notion-sync-aio.py と同じにする（4項目のいずれか）:
        #     media_name / company_name / site_url / near_url
        #   ここを変えると移行前後で数字が繋がらなくなる。
        #
        # ★API が失敗した試行は数に入れない。
        #   失敗を hit=false として入れると偽の0%が昇降格判定を汚す
        #   （notion-sync-aio.py が既定で除外していた理由と同じ）。
        agg: dict[tuple[str, str], float] = collections.defaultdict(float)
        unknown = collections.Counter()
        errors = 0
        for r in results:
            art = str(r.get("target_art") or "")
            cid = by_ext.get(art)
            if not cid:
                continue
            engine = str(r.get("engine") or "").lower()
            suffix = ENGINE_SUFFIX.get(engine)
            if not suffix:
                unknown[engine or "(空)"] += 1
            for tr in r.get("trials") or []:
                if tr.get("error"):
                    errors += 1
                    continue
                d = tr.get("detection") or {}
                hit = 1.0 if (
                    d.get("media_name") or d.get("company_name")
                    or d.get("site_url") or d.get("near_url")
                ) else 0.0
                agg[(cid, "aio_trials")] += 1.0
                agg[(cid, "aio_hits")] += hit
                if suffix:
                    agg[(cid, f"aio_trials_{suffix}")] += 1.0
                    agg[(cid, f"aio_hits_{suffix}")] += hit

        for (cid, metric), value in agg.items():
            cur.execute(
                'INSERT INTO "ContentMetric"(id,"contentItemId",metric,value,date,'
                '"createdAt","updatedAt") '
                "VALUES (gen_random_uuid()::text,%s,%s,%s,%s::date,now(),now()) "
                'ON CONFLICT ("contentItemId",metric,date) DO UPDATE SET '
                'value=EXCLUDED.value, "updatedAt"=now()',
                (cid, metric, value, today),
            )

        for metric in ("aio_trials", "aio_hits"):
            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', (metric,))
            if cur.fetchone():
                continue
            cur.execute(
                'INSERT INTO "MeasurementCoverage"(id,metric,"startedAt",method,note,'
                '"createdAt","updatedAt") VALUES (gen_random_uuid()::text,%s,now(),%s,%s,now(),now())',
                (metric, "aio_run", "MMS worker が ChatGPT / Gemini に質問して計測"),
            )
        conn.commit()

        if unknown:
            log(f"★未知のエンジン（総計にのみ計上）: {dict(unknown)}")
        if errors:
            log(f"★API失敗のため除外した試行: {errors}")

        moves = promote_demote(cur, args.tier)
        conn.commit()
        for eid, a, b in moves:
            log(f"  Tier {a}→{b}: {eid}")

    trials = sum(v for (_, m), v in agg.items() if m == "aio_trials")
    hits = sum(v for (_, m), v in agg.items() if m == "aio_hits")
    log(f"完了: {int(trials)}試行 / {int(hits)}ヒット / Tier変更 {len(moves)}件")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
