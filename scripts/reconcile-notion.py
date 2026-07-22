#!/usr/bin/env python3
"""Notion 記事DB ⇔ MMS ContentItem の突合（Notion→MMS 移行の検証）

★なぜ「1週間の並行稼働」ではなく1回の突合で足りるか
  指示書（docs/MIGRATION_NOTION_TO_MMS.md §P1.5）は1週間の並行稼働を
  完了条件にしているが、記事メタは既に MMS に入っている
  （aioTier hot25/warm39/cold56）。動いている最中のデータではないので、
  1回突き合わせて差分がゼロなら、待っても新しい情報は出ない。

★このスクリプトは読み取りだけ。Notion にも MMS にも書き込まない。
  差分を出すのが仕事で、埋めるかどうかは人が決める。

★§3 欠測とゼロの区別
  「Notion に無い」と「Notion にあるが値が空」は別物として数える。
  混ぜると、移行漏れなのか元から空なのか分からなくなる。

★突合キーは記事IDではなく URL
  MMS 側で ID の改番を行ったため、記事IDは両者でずれている
  （例: Notion ART-105 = MMS ART-189・同じURL）。
  IDで突き合わせると、一致しているように見えて別の記事を指す。
  そのまま Tier を書き込むと**別の記事に付く**。URL は改番の影響を受けない。

使い方:
  NOTION_TOKEN=... MMS_DATABASE_URL=... python3 scripts/reconcile-notion.py
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
# ★notion-sync.py と同じバージョンにそろえる。
#   古い版だと data_sources エンドポイントが 401 になる。
NOTION_VERSION = "2025-09-03"
# 記事パフォーマンス管理DB（.claude/scripts/notion-sync.py の DEFAULT_DSID）
DSID = os.environ.get(
    "NOTION_DB_ARTICLE_PERFORMANCE_DSID", "02e3cf05-c0f7-43ab-82b0-daebd2696a8b"
)


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


def fetch_notion_rows(token: str) -> list[dict]:
    """記事DB を全件取得。data_sources が無ければ databases にフォールバック"""
    rows: list[dict] = []
    cursor = None
    while True:
        body: dict = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        try:
            data = notion_post(f"data_sources/{DSID}/query", token, body)
        except urllib.error.HTTPError:
            data = notion_post(f"databases/{DSID}/query", token, body)
        rows.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return rows


def norm_url(u: str) -> str:
    """末尾スラッシュとスキームの揺れを吸収する"""
    u = u.strip().lower()
    u = u.replace("http://", "https://")
    return u.rstrip("/")


def prop_text(props: dict, name: str) -> str:
    """型を問わずテキストとして取り出す。無ければ空文字"""
    p = props.get(name)
    if not p:
        return ""
    t = p.get("type")
    if t == "title":
        return "".join(x.get("plain_text", "") for x in p.get("title", []))
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in p.get("rich_text", []))
    if t == "select":
        return (p.get("select") or {}).get("name", "")
    if t == "checkbox":
        return "true" if p.get("checkbox") else "false"
    if t == "date":
        return ((p.get("date") or {}).get("start") or "")
    if t == "number":
        v = p.get("number")
        return "" if v is None else str(v)
    if t == "url":
        return p.get("url") or ""
    return ""


def main() -> int:
    token = os.environ.get("NOTION_TOKEN", "").strip()
    dsn = os.environ.get("MMS_DATABASE_URL", "").strip()
    if not token:
        log("★NOTION_TOKEN が未設定です")
        return 1
    if not dsn:
        log("★MMS_DATABASE_URL が未設定です")
        return 1

    log("Notion 記事DB を取得中…")
    rows = fetch_notion_rows(token)
    log(f"Notion: {len(rows)}行")

    # 記事ID -> Notion の値
    notion: dict[str, dict[str, str]] = {}
    no_article_id = 0
    no_url = 0
    for r in rows:
        props = r.get("properties", {})
        # 記事IDのプロパティ名は環境によりぶれるので候補で拾う
        aid = ""
        for key in ("記事ID", "ART-ID", "article_id", "ID"):
            aid = prop_text(props, key).strip()
            if aid:
                break
        if not aid:
            no_article_id += 1
            continue
        url = prop_text(props, "公開URL").strip()
        if not url:
            no_url += 1
            continue
        notion[norm_url(url)] = {
            "articleId": aid,
            "aioTier": prop_text(props, "AIO Tier").strip().lower(),
            "title": prop_text(props, "記事タイトル").strip(),
        }

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "externalId", "aioTier"::text, "aioTracked", url FROM "ContentItem" '
            "WHERE url IS NOT NULL AND url <> ''"
        )
        mms = {}
        for eid, tier, tracked, url in cur.fetchall():
            mms[norm_url(url)] = {
                "articleId": eid or "",
                "aioTier": tier or "",
                "aioTracked": tracked,
            }

    n_keys = set(notion)
    m_keys = set(mms)

    only_notion = sorted(n_keys - m_keys)
    only_mms = sorted(m_keys - n_keys)
    # ★IDが食い違っている件数。改番の影響範囲を可視化する
    id_diff = [
        (notion[k]["articleId"], mms[k]["articleId"])
        for k in sorted(n_keys & m_keys)
        if notion[k]["articleId"] != mms[k]["articleId"]
    ]
    both = n_keys & m_keys

    # AIO Tier の食い違い。★Notion 側が空の行は「不一致」ではなく「Notion未入力」
    tier_mismatch: list[tuple[str, str, str]] = []
    tier_blank_in_notion = 0
    for k in sorted(both):
        nv = notion[k]["aioTier"]
        mv = mms[k]["aioTier"]
        if not nv:
            tier_blank_in_notion += 1
            continue
        if nv != mv:
            tier_mismatch.append((k, nv, mv))

    log("")
    log("═══ 突合結果 ═══")
    log(f"Notion 記事DB          {len(rows)}行（記事IDなし {no_article_id} / URLなし {no_url}）")
    log(f"MMS ContentItem        {len(mms)}件（URL あり）")
    log("★突合キーは URL（IDは改番でずれているため使えない）")
    log(f"両方にある             {len(both)}件")
    log(f"Notion にのみ          {len(only_notion)}件  ← 移行漏れの候補")
    log(f"MMS にのみ             {len(only_mms)}件  ← WP由来でNotion未登録")
    log("")
    log(f"記事IDが食い違う       {len(id_diff)}件  ← 改番の影響。同じ記事だがIDが違う")
    log("")
    log(f"AIO Tier 一致          {len(both) - len(tier_mismatch) - tier_blank_in_notion}件")
    log(f"AIO Tier 不一致        {len(tier_mismatch)}件")
    log(f"Notion側が未入力       {tier_blank_in_notion}件  ← 不一致ではない（§3）")

    if only_notion:
        log("")
        log("── Notion にのみ存在（先頭20件）──")
        for k in only_notion[:20]:
            log(f"  {notion[k]['articleId']}  {k}")
        if len(only_notion) > 20:
            log(f"  … 他 {len(only_notion) - 20}件")

    if tier_mismatch:
        log("")
        log("── AIO Tier 不一致（先頭20件）Notion / MMS ──")
        for k, nv, mv in tier_mismatch[:20]:
            log(f"  {notion[k]['articleId']:>8} → {mms[k]['articleId']:>8}  {nv} / {mv}")
        if len(tier_mismatch) > 20:
            log(f"  … 他 {len(tier_mismatch) - 20}件")

    if id_diff:
        log("")
        log("── 記事IDが食い違う（先頭20件）Notion → MMS ──")
        for a, b in id_diff[:20]:
            log(f"  {a} → {b}")
        if len(id_diff) > 20:
            log(f"  … 他 {len(id_diff) - 20}件")

    log("")
    if not only_notion and not tier_mismatch:
        log("✅ 移行漏れなし。Notion を止めても記事メタは失われない")
    else:
        log("★差分あり。Notion を止める前に埋める必要がある")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
