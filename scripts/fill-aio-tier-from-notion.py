#!/usr/bin/env python3
"""Notion の AIO Tier を MMS に埋める（移行の穴埋め・1回限り）

★突合キーは URL。記事IDは使わない。
  MMS 側で ID を改番したため、Notion の ART-006 は MMS では
  LEGACY-chushokigyo-keiei-kyouka-zeisei であり、MMS には別の ART-006 が居る。
  IDで書き込むと **別の記事に Tier が付く**。

★上書きしない。MMS が none の行だけ埋める。
  MMS 側で後から手を入れた値を Notion の古い値で潰さないため。
  食い違い（両方に値があって違う）が出たら報告して止める。

★既定は dry-run。--apply を付けたときだけ書き込む。

使い方:
  NOTION_TOKEN=... MMS_DATABASE_URL=... python3 fill-aio-tier-from-notion.py [--apply]
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"
DSID = os.environ.get(
    "NOTION_DB_ARTICLE_PERFORMANCE_DSID", "02e3cf05-c0f7-43ab-82b0-daebd2696a8b"
)
VALID_TIERS = ("hot", "warm", "cold", "none")


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


def notion_post(path: str, token: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{NOTION_API}/{path}",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def prop_text(props: dict, name: str) -> str:
    p = props.get(name)
    if not p:
        return ""
    t = p.get("type")
    if t == "select":
        return (p.get("select") or {}).get("name", "")
    if t == "url":
        return p.get("url") or ""
    if t == "date":
        return ((p.get("date") or {}).get("start") or "")
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in p.get("rich_text", []))
    if t == "title":
        return "".join(x.get("plain_text", "") for x in p.get("title", []))
    return ""


def main() -> int:
    apply = "--apply" in sys.argv
    token = os.environ.get("NOTION_TOKEN", "").strip()
    dsn = os.environ.get("MMS_DATABASE_URL", "").strip()
    if not token or not dsn:
        log("★NOTION_TOKEN / MMS_DATABASE_URL が要ります")
        return 1

    rows: list[dict] = []
    cursor = None
    while True:
        body: dict = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        data = notion_post(f"data_sources/{DSID}/query", token, body)
        rows.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")

    want: dict[str, dict[str, str]] = {}
    for r in rows:
        p = r.get("properties", {})
        url = prop_text(p, "公開URL").strip()
        tier = prop_text(p, "AIO Tier").strip().lower()
        if not url or tier not in VALID_TIERS or tier == "none":
            continue
        want[norm_url(url)] = {
            "tier": tier,
            "articleId": prop_text(p, "記事ID").strip(),
            "tierUpdatedAt": prop_text(p, "AIO Tier更新日").strip(),
            "note": prop_text(p, "AIOメモ").strip(),
        }

    filled: list[tuple[str, str]] = []
    conflicts: list[tuple[str, str, str]] = []

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute(
            'SELECT id, "externalId", "aioTier"::text, url FROM "ContentItem" '
            "WHERE url IS NOT NULL AND url <> ''"
        )
        for cid, eid, tier, url in cur.fetchall():
            w = want.get(norm_url(url))
            if not w:
                continue
            cur_tier = tier or "none"
            if cur_tier == w["tier"]:
                continue
            if cur_tier != "none":
                # ★両方に値があって違う。どちらが正か機械では決められないので触らない
                conflicts.append((eid or cid, cur_tier, w["tier"]))
                continue
            filled.append((eid or cid, w["tier"]))
            if apply:
                cur.execute(
                    'UPDATE "ContentItem" SET "aioTier"=%s::"AioTier", "aioTracked"=true, '
                    '"aioTierUpdatedAt"=COALESCE(%s::timestamp, now()), '
                    '"aioNote"=COALESCE(NULLIF(%s,\'\'), "aioNote"), "updatedAt"=now() '
                    "WHERE id=%s",
                    (w["tier"], w["tierUpdatedAt"] or None, w["note"], cid),
                )
        if apply:
            conn.commit()

    log(f"{'適用' if apply else 'dry-run'}: 埋める対象 {len(filled)}件 / 食い違い {len(conflicts)}件")
    for eid, t in filled:
        log(f"  {eid}  none → {t}")
    if conflicts:
        log("")
        log("★食い違い（両方に値がある）— 触っていない。人が決める:")
        for eid, mv, nv in conflicts:
            log(f"  {eid}  MMS={mv} / Notion={nv}")
    if not apply and filled:
        log("")
        log("→ 書き込むには --apply を付けて再実行")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
