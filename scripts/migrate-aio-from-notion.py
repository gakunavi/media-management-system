#!/usr/bin/env python3
"""Notion AIO計測DB → MMS ContentMetric（1回限りの移行）

★何を移すか
  Notion の AIO計測DB は「プロンプト × モデル × 試行」の生ログ 3353行。
  MMS が必要とするのは記事ごとの引用率なので、記事×計測日に集約する。
  応答本文は移さない（Notion にアーカイブとして残る）。

★rate を保存せず hits と trials を保存する
  §16.5「母数が足りなければ判定不能」。rate だけ持つと、
  1試行1ヒットの 100% と 30試行30ヒットの 100% が同じ値になる。
  hits と trials があれば rate は導出でき、信頼度も判断できる。

★突合キーは URL。target_art（記事ID）ではない
  MMS 側で ID を改番したため、Notion の ART-006 は MMS では
  LEGACY-chushokigyo-keiei-kyouka-zeisei であり、MMS には別の ART-006 が居る。
  IDで結ぶと **別の記事に AIO 実績が付く**。

★既定は dry-run。--apply で書き込む。
"""

from __future__ import annotations

import collections
import json
import os
import sys
import urllib.request
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"
DS_ARTICLE = "02e3cf05-c0f7-43ab-82b0-daebd2696a8b"  # 記事パフォーマンス管理DB
DS_AIO = "7b6c100f-ae0b-4b4e-9f0f-3572bfc206c5"  # AIO引用率 計測DB

# 計測モデル名 → metric の接尾辞。
# ★実データに実在する値（2026-07-23 確認）:
#     chatgpt 1929 / Gemini 1382 / gpt-4o-mini 42
#   比較は小文字化してから行う（Notion 側で表記が揺れている）。
#   知らないモデルは総計にだけ入れ、末尾で件数を報告する
#   （黙って落とすとエンジン別の内訳が静かに欠ける）。
ENGINE_SUFFIX = {
    "chatgpt": "chatgpt",
    "gpt-4o": "chatgpt",
    "gpt-4o-mini": "chatgpt",
    "gpt-4o-search": "chatgpt",
    "gemini": "gemini",
    "gemini-2.0-flash": "gemini",
    "gemini-2.5-flash": "gemini",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def norm_url(u: str) -> str:
    return u.strip().lower().replace("http://", "https://").rstrip("/")


def query_all(dsid: str, token: str) -> list[dict]:
    rows: list[dict] = []
    cursor = None
    while True:
        body: dict = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        req = urllib.request.Request(
            f"{NOTION_API}/data_sources/{dsid}/query",
            data=json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode())
        rows.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return rows


def txt(props: dict, name: str) -> str:
    p = props.get(name) or {}
    t = p.get("type")
    if t == "title":
        return "".join(x.get("plain_text", "") for x in p.get("title", []))
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in p.get("rich_text", []))
    if t == "select":
        return (p.get("select") or {}).get("name", "") or ""
    if t == "url":
        return p.get("url") or ""
    if t == "date":
        return ((p.get("date") or {}).get("start") or "")
    return ""


def flag(props: dict, name: str) -> bool:
    p = props.get(name) or {}
    if p.get("type") == "checkbox":
        return bool(p.get("checkbox"))
    # select / rich_text で「○」「hit」等が入る場合に備える
    v = txt(props, name).strip().lower()
    return v in ("○", "o", "yes", "true", "hit", "1")


def main() -> int:
    apply = "--apply" in sys.argv
    token = os.environ.get("NOTION_TOKEN", "").strip()
    dsn = os.environ.get("MMS_DATABASE_URL", "").strip()
    if not token or not dsn:
        log("★NOTION_TOKEN / MMS_DATABASE_URL が要ります")
        return 1

    log("Notion を取得中…")
    articles = query_all(DS_ARTICLE, token)
    aio = query_all(DS_AIO, token)
    log(f"記事DB {len(articles)}行 / AIO計測DB {len(aio)}行")

    # 記事ID -> URL（Notion 内で閉じた対応）
    id2url = {}
    for r in articles:
        p = r["properties"]
        aid = txt(p, "記事ID").strip()
        u = txt(p, "公開URL").strip()
        if aid and u:
            id2url[aid] = norm_url(u)

    # URL -> MMS の ContentItem.id
    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute(
            'SELECT id, "externalId", url FROM "ContentItem" '
            "WHERE url IS NOT NULL AND url <> ''"
        )
        url2mms = {norm_url(u): (cid, eid) for cid, eid, u in cur.fetchall()}

        # (contentItemId, date, metric) -> 値
        agg: dict[tuple[str, str, str], float] = collections.defaultdict(float)
        skipped_any = 0
        skipped_nomap = collections.Counter()
        used_articles = set()
        dates = collections.Counter()
        unknown_models = collections.Counter()
        total_hits = 0.0

        for r in aio:
            p = r["properties"]
            art = txt(p, "target_art").strip()
            date = txt(p, "計測日").strip()[:10]
            if not date:
                continue
            if not art or art == "any":
                # ★記事を特定できない行。記事別の指標には入れられない
                skipped_any += 1
                continue
            u = id2url.get(art)
            hit = url2mms.get(u) if u else None
            if not hit:
                skipped_nomap[art] += 1
                continue
            cid, eid = hit
            used_articles.add(eid)
            dates[date[:7]] += 1

            model = txt(p, "計測モデル").strip().lower()
            suffix = ENGINE_SUFFIX.get(model)
            if not suffix:
                unknown_models[model or "(空)"] += 1
            is_hit = 1.0 if flag(p, "ヒット") else 0.0
            total_hits += is_hit

            # ★1行 = 1試行。trials は行数で数える
            agg[(cid, date, "aio_trials")] += 1.0
            agg[(cid, date, "aio_hits")] += is_hit
            if suffix:
                agg[(cid, date, f"aio_trials_{suffix}")] += 1.0
                agg[(cid, date, f"aio_hits_{suffix}")] += is_hit

        log("")
        log(f"集約後 {len(agg)}行（記事 {len(used_articles)}本）")
        log(f"  記事を特定できない行（target_art=any）: {skipped_any}  ← 記事別には入れない")
        if skipped_nomap:
            log(f"  MMS に対応が無い記事: {sum(skipped_nomap.values())}行 "
                f"{dict(list(skipped_nomap.items())[:5])}")
        for m, n in sorted(dates.items()):
            log(f"  {m}: {n}試行")
        log(f"  ヒット合計: {int(total_hits)}")
        if unknown_models:
            log(f"  ★未知の計測モデル（総計にのみ計上）: {dict(unknown_models)}")

        if apply:
            for (cid, date, metric), value in agg.items():
                cur.execute(
                    'INSERT INTO "ContentMetric"(id,"contentItemId",metric,value,date,'
                    '"createdAt","updatedAt") '
                    "VALUES (gen_random_uuid()::text,%s,%s,%s,%s::date,now(),now()) "
                    'ON CONFLICT ("contentItemId",metric,date) DO UPDATE SET '
                    'value=EXCLUDED.value, "updatedAt"=now()',
                    (cid, metric, value, date),
                )
            # 計測開始の記録（§3: 0 と未計測を区別する）
            first = min(d for (_, d, _) in agg) if agg else None
            for metric in ("aio_trials", "aio_hits"):
                cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', (metric,))
                if cur.fetchone():
                    continue
                cur.execute(
                    'INSERT INTO "MeasurementCoverage"(id,metric,"startedAt",method,note,'
                    '"createdAt","updatedAt") '
                    "VALUES (gen_random_uuid()::text,%s,%s::timestamp,%s,%s,now(),now())",
                    (metric, first, "notion_aio_migration",
                     "Notion AIO計測DB から移行（2026-05〜2026-06）"),
                )
            conn.commit()
            log("")
            log(f"✅ {len(agg)}行を書き込みました")
        else:
            log("")
            log("→ 書き込むには --apply を付けて再実行")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
