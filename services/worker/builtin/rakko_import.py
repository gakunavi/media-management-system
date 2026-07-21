#!/usr/bin/env python3
"""ラッコキーワードのエクスポートを取り込む（設計書 §3-8 KWリサーチ・§13.3）

★なぜファイル取り込みなのか
  ラッコキーワードは現行プランで API が使えず、cowork が Chrome を自動操作して
  ファイルを取得している。MMS 側にもブラウザ自動操作を持つと、同じ仕組みを
  二重に抱えたうえ、画面変更で壊れる箇所が2つになる。MMS は「置かれた
  ファイルを読む」ことに徹する。

埋まるもの:
  - Keyword.volume / difficulty / cpc … 現在360KW全てが未取得
  - KeywordVolume                      … 月次のボリューム（source=rakko）
  - KeywordResearch                    … サジェスト全件（90日鮮度・§13.3）

★実測で分かったこと（2026-07-21）
  MMS の360KWは GSC の**実際の検索クエリ**由来、ラッコの270KWは**サジェスト**
  由来で、**集合が1件も重ならなかった**（空白を除いて突合しても0件）。
  「既存KWを補強する」という当初の想定では何も埋まらない。
  ラッコの価値は補強ではなく**発見**（候補の供給）側にある。

★サジェスト270件は自動登録しない。
  そのまま登録すると追跡対象が 360→数千に膨れ、SERP取得
  （$0.0006/KW/週）のコストも比例して増える。採否は費用対効果の判断。
  ただし**調査対象KW（query.keyword）だけは登録する**。運用者が明示的に
  そのKWを調べた＝スコープ内であることが行動で示されているため。

使い方:
  docker compose exec worker python builtin/rakko_import.py --dry-run
  docker compose exec worker python builtin/rakko_import.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
INBOX = Path(os.environ.get("MMS_RAKKO_INBOX", "/app/rakko-inbox"))
PROCESSED = INBOX / "processed"

# §13.3「90日鮮度 → 30日前に自動再取得」
RESEARCH_TTL_DAYS = 90


def log(msg: str) -> None:
    print(f"[rakko_import] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def nid(p: str) -> str:
    return f"{p}_{uuid.uuid4().hex}"


def slugify(s: str) -> str:
    """Keyword.slug 用。日本語は残し、空白と記号だけ潰す"""
    out = []
    for ch in str(s or "").strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")[:80] or "kw"


def norm_kw(s: str) -> str:
    """KW照合用の正規化。全角空白と連続空白を吸収する。

    ★ラッコは「法人 節税」、MMS側は「法人　節税」のように空白が揺れる。
      揺れたまま突合すると、既存KWに値が入らず「未取得のまま」になる。
    """
    return " ".join(str(s or "").replace("　", " ").split()).lower()


def parse_suggest(path: Path) -> dict | None:
    """サジェストのエクスポートを読む。想定外の形なら None（黙って0件にしない）"""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        log(f"★読めません {path.name}: {e}")
        return None

    meta = raw.get("meta") or {}
    if meta.get("exportType") != "suggestKeywords":
        log(f"  スキップ {path.name}: exportType={meta.get('exportType')}（未対応）")
        return None

    data = raw.get("data") or {}
    query = (data.get("query") or {}).get("keyword")
    items = data.get("items") or []
    if not query or not isinstance(items, list):
        log(f"★{path.name}: query.keyword または items がありません")
        return None

    parsed = []
    for it in items:
        if not isinstance(it, dict):
            continue
        kw = it.get("keyword")
        if not kw:
            continue
        m = it.get("metrics") or {}
        parsed.append(
            {
                "keyword": kw,
                "volume": to_int(m.get("searchVolume")),
                "difficulty": to_int(m.get("seoDifficulty")),
                "cpc": to_float(m.get("cpc")),
                "competition": to_int(m.get("competition")),
                "suggestClass": it.get("suggestClass"),
            }
        )

    return {
        "queryKeyword": query,
        "exportedDate": meta.get("exportedDate"),
        "items": parsed,
        "file": path.name,
    }


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main() -> int:
    dry = "--dry-run" in sys.argv
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")
    if not INBOX.is_dir():
        log(f"受け口がありません: {INBOX}")
        return 1

    files = sorted(p for p in INBOX.glob("*.json") if p.is_file())
    if not files:
        log(f"取り込むファイルがありません（{INBOX}）")
        return 0
    log(f"{len(files)}ファイルを検出")

    exports = [e for e in (parse_suggest(p) for p in files) if e]
    if not exports:
        log("取り込めるエクスポートがありませんでした")
        return 1

    slug = os.environ.get("MMS_DEFAULT_BUSINESS_SLUG", "tax-saving-agency")
    now = datetime.now(JST)
    month = now.strftime("%Y-%m")
    expires = now + timedelta(days=RESEARCH_TTL_DAYS)

    updated = volumes = researches = 0
    new_candidates: dict[str, dict] = {}

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute('SELECT id FROM "Business" WHERE slug=%s', (slug,))
        got = cur.fetchone()
        if not got:
            raise RuntimeError(f"Business({slug}) がありません")
        business_id = got[0]

        cur.execute('SELECT id, keyword FROM "Keyword" WHERE "businessId"=%s', (business_id,))
        existing = {norm_kw(k): kid for kid, k in cur.fetchall()}
        log(f"既存キーワード {len(existing)}件")

        for ex in exports:
            log(f"── {ex['file']}（対象KW: {ex['queryKeyword']} / {len(ex['items'])}件）")

            for it in ex["items"]:
                kid = existing.get(norm_kw(it["keyword"]))
                if not kid:
                    # ★自動登録しない。候補として集めるだけ
                    prev = new_candidates.get(it["keyword"])
                    if prev is None or (it["volume"] or 0) > (prev["volume"] or 0):
                        new_candidates[it["keyword"]] = it
                    continue

                if dry:
                    updated += 1
                    continue

                cur.execute(
                    'UPDATE "Keyword" SET "volume"=COALESCE(%s,"volume"), '
                    '"difficulty"=COALESCE(%s,"difficulty"), "cpc"=COALESCE(%s,"cpc"), '
                    '"updatedAt"=%s WHERE id=%s',
                    (it["volume"], it["difficulty"], it["cpc"], now, kid),
                )
                updated += 1

                if it["volume"] is not None:
                    cur.execute(
                        """
                        INSERT INTO "KeywordVolume"
                          ("id","keywordId","month","volume","source","createdAt","updatedAt")
                        VALUES (%s,%s,%s,%s,'rakko',%s,%s)
                        ON CONFLICT ("keywordId","month","source")
                        DO UPDATE SET "volume"=EXCLUDED."volume", "updatedAt"=EXCLUDED."updatedAt"
                        """,
                        (nid("kv"), kid, month, it["volume"], now, now),
                    )
                    volumes += 1

            # ── 調査対象KW自体は登録する（1件だけ。270件は登録しない）──
            qid = existing.get(norm_kw(ex["queryKeyword"]))
            if not qid and not dry:
                seed = next(
                    (i for i in ex["items"] if norm_kw(i["keyword"]) == norm_kw(ex["queryKeyword"])),
                    {},
                )
                qid = nid("kw")
                cur.execute(
                    """
                    INSERT INTO "Keyword"
                      ("id","businessId","keyword","slug","volume","difficulty","cpc",
                       "budgetTier","productFit","createdAt","updatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s,%s,'unknown','{}',%s,%s)
                    ON CONFLICT ("businessId","keyword") DO NOTHING
                    """,
                    (
                        qid, business_id, ex["queryKeyword"], slugify(ex["queryKeyword"]),
                        seed.get("volume"), seed.get("difficulty"), seed.get("cpc"), now, now,
                    ),
                )
                cur.execute(
                    'SELECT id FROM "Keyword" WHERE "businessId"=%s AND keyword=%s',
                    (business_id, ex["queryKeyword"]),
                )
                row = cur.fetchone()
                qid = row[0] if row else None
                if qid:
                    existing[norm_kw(ex["queryKeyword"])] = qid
                    log(f"  調査対象KW「{ex['queryKeyword']}」を新規登録")

            if qid and not dry:
                cur.execute(
                    """
                    INSERT INTO "KeywordResearch"
                      ("id","keywordId","fetchedAt","source","expiresAt","suggests",
                       "createdAt","updatedAt")
                    VALUES (%s,%s,%s,'rakko',%s,%s,%s,%s)
                    """,
                    (nid("kr"), qid, now, expires, json.dumps(ex["items"], ensure_ascii=False), now, now),
                )
                researches += 1
            elif not qid and dry:
                log(f"  [dry-run] 調査対象KW「{ex['queryKeyword']}」を新規登録する予定")

        if not dry:
            conn.commit()

    # ── 取り込み済みを退避（再取り込みを防ぐ）──
    if not dry:
        PROCESSED.mkdir(exist_ok=True)
        for p in files:
            try:
                shutil.move(str(p), str(PROCESSED / p.name))
            except OSError as e:
                log(f"★移動できません {p.name}: {e}")

    log(
        f"{'[dry-run] ' if dry else ''}完了: 既存KWを更新 {updated}件 / "
        f"月次ボリューム {volumes}件 / リサーチ保存 {researches}件"
    )

    if new_candidates:
        top = sorted(new_candidates.values(), key=lambda x: -(x["volume"] or 0))[:15]
        log(f"★未登録の候補 {len(new_candidates)}件（自動登録はしない）。ボリューム上位:")
        for c in top:
            log(f"    {c['keyword']}  vol={c['volume']} 難易度={c['difficulty']}")
        log("  追跡対象を増やすとSERP取得コストも比例して増える。採否は運用判断")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
