#!/usr/bin/env python3
"""cowork から受け取った台帳（クラスタ・メインKW・最終更新日）を MMS に取り込む

★なぜ人が決めた値を正にするか（2026-07-23 の訂正）
  先に GSC 実測から mainKeyword を49本に入れたが、**順序が逆だった**。
  `art-kw-map.yaml` / `media.db` には人が決めた main_kw が既にあり、
  クラスタも `pillar-plan.md` 等で管理されていた。MMS へ移行されていなかっただけ。

  実測を正にすると「狙いと実測のズレ」が消える。ズレこそがリライト対象なので、
    狙い = ここで入れる値（ContentItem.mainKeywordId / KeywordAssignment(main)）
    実測 = ContentQuery（GSC page×query・別テーブルなのでそのまま残る）
  の2本立てにする。

★入れないものは入れない（§3）
  ・鮮度階層は CSV で**全行空**だった＝どこにも記録が無い。ここでは触らない
  ・クラスタ「不明」の63本は空のまま残す
  ・MMS に無い記事（未公開・計画のみ）は作らない

★未来日付を lastReviewedAt にしない
  CSV の「最終更新日」に本日より後の日付が4件あった（ART-103/104/105/106）。
  これを最終レビュー日にすると `nextReviewDue` が未来から更に先になり、
  **その記事は永久に見直し対象にならない**。除外して件数を出す。

使い方:
  python3 scripts/import-cluster-kw.py <csv>            # dry-run
  python3 scripts/import-cluster-kw.py <csv> --apply    # 書き込む
"""

from __future__ import annotations

import csv
import os
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)
TODAY = now_ts.date()

COL_ID = "ART番号"
COL_CLUSTER = "クラスタ名"
COL_ROLE = "役割"
COL_KW = "メインKW(運用値=config/MMS)"
COL_FRESH = "鮮度階層"
COL_REVIEWED = "最終更新日(参考)"
COL_STATE = "状態"


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


def nid(p: str) -> str:
    return f"{p}_{uuid.uuid4().hex}"


def slugify(s: str, prefix: str) -> str:
    """slug を作る。**必ず名前のハッシュを付ける**。

    ★2026-07-23 の事故
      日本語名を ASCII 化すると別々のクラスタが同じ slug に潰れる。
        「事業承継・退職金 Cluster」→ "cluster"
        「事例・インタビュー Cluster」→ "cluster"          ← 衝突
        「C柱 外貨両替機リスク Cluster(PRJ-020)」→ "c-cluster-prj-020"
        「C柱 法人保険リスク Cluster(PRJ-020)」  → "c-cluster-prj-020"  ← 衝突
      `ON CONFLICT (businessId, slug) DO UPDATE` と組み合わさり、
      **17クラスタが14に減り、所属記事が別のクラスタに付いた**（黙って壊れた）。
      名前が違えば slug も違う、を構造で保証する。
    """
    base = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    h = uuid.uuid5(uuid.NAMESPACE_URL, s).hex[:8]
    return f"{base[:50]}-{h}" if base else f"{prefix}-{h}"


def pillar_type(cluster_name: str) -> str:
    """PillarType は NOT NULL なので必ず決める。

    ★推測を最小にする。名前に「C柱」と書いてあるものだけ C_risk にし、
      残りは A_standard に倒す。「税制改正 横串」を B_news にしたくなるが、
      中身は制度解説（インボイス2029・電帳法）が主で速報ではない。
      名前から確実に言えないものを分類すると、後の打ち手を誤る。
    """
    return "C_risk" if "C柱" in cluster_name else "A_standard"


def parse_day(v: str) -> date | None:
    v = (v or "").strip()
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply_changes = "--apply" in sys.argv
    if not args:
        raise RuntimeError("CSV のパスを渡してください")

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with open(args[0], encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if (r.get(COL_ID) or "").strip()]
    log(f"CSV: {len(rows)}行")

    if any((r.get(COL_FRESH) or "").strip() for r in rows):
        log("★鮮度階層に値が入っています。このスクリプトは鮮度を扱いません（別途対応）")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute(
            'SELECT "externalId", id, "channelId" FROM "ContentItem" '
            "WHERE type IN ('article','article_unlinked')"
        )
        items = {e: (i, c) for e, i, c in cur.fetchall()}

        cur.execute(
            'SELECT id FROM "Business" WHERE slug=%s',
            (os.environ.get("MMS_DEFAULT_BUSINESS_SLUG") or "tax-saving-agency",),
        )
        biz = cur.fetchone()
        if not biz:
            raise RuntimeError("Business が見つかりません")
        business_id = biz[0]

        # ── 突合 ──
        matched = [r for r in rows if r[COL_ID].strip() in items]
        missing = [r for r in rows if r[COL_ID].strip() not in items]
        log(f"MMS と照合できた: {len(matched)}本 ／ MMS に無い: {len(missing)}本")
        if missing:
            unpub = [r for r in missing if "未公開" in (r.get(COL_STATE) or "")]
            log(f"  うち「未公開/計画のみ」: {len(unpub)}本（記事が存在しないので作らない）")
            other = [r[COL_ID] for r in missing if r not in unpub]
            if other:
                log(f"  ★状態が未公開でないのに MMS に無い: {other}")

        # ── 1. クラスタ ──
        clusters: dict[str, list[dict]] = {}
        for r in matched:
            name = (r[COL_CLUSTER] or "").strip()
            if not name or name == "不明":
                continue
            clusters.setdefault(name, []).append(r)
        unknown = [r for r in matched if (r[COL_CLUSTER] or "").strip() in ("", "不明")]

        log("")
        log(f"── クラスタ {len(clusters)}個 / 所属 {sum(len(v) for v in clusters.values())}本 ──")
        no_pillar = []
        for name, members in sorted(clusters.items(), key=lambda x: -len(x[1])):
            pil = [m[COL_ID].strip() for m in members if (m[COL_ROLE] or "").strip() == "Pillar"]
            if not pil:
                no_pillar.append(name)
            log(f"  {len(members):3}本  {name:44} Pillar={','.join(pil) or '★なし'}  {pillar_type(name)}")
        log(f"★クラスタ未定（空のまま残す）: {len(unknown)}本")
        if no_pillar:
            log(f"★Pillar が指定されていないクラスタ {len(no_pillar)}個 → state=pillar_missing")

        # ── 2. メインKW ──
        by_kw: dict[str, list[dict]] = {}
        for r in matched:
            kw = (r[COL_KW] or "").strip()
            if kw:
                by_kw.setdefault(kw, []).append(r)
        dups = {k: v for k, v in by_kw.items() if len(v) > 1}

        log("")
        log(f"── メインKW {len(by_kw)}語 / {sum(len(v) for v in by_kw.values())}本 ──")
        if dups:
            log(f"★同じKWを狙う記事が複数ある（＝設計上のカニバリ）{len(dups)}語:")
            for k, v in sorted(dups.items(), key=lambda x: -len(x[1])):
                log(f"    「{k}」 → {', '.join(m[COL_ID].strip() for m in v)}")
            log("    ★ContentItem.mainKeywordId は**全記事に**入れる（狙いは狙いとして残す）。")
            log("      KeywordAssignment(main) は1記事のみ（一意制約）。実測クリックの多い方を採る。")

        # ── 3. 最終レビュー日 ──
        reviewed, future, unparsed = [], [], []
        for r in matched:
            raw = (r[COL_REVIEWED] or "").strip()
            if not raw:
                continue
            d = parse_day(raw)
            if d is None:
                unparsed.append((r[COL_ID].strip(), raw))
            elif d > TODAY:
                future.append((r[COL_ID].strip(), raw))
            else:
                reviewed.append((r[COL_ID].strip(), d))
        log("")
        log(f"── 最終レビュー日 {len(reviewed)}本 ──")
        if future:
            log(f"★本日({TODAY})より後の日付 {len(future)}件 → **入れない**")
            for a, v in future:
                log(f"    {a}  {v}")
            log("    理由: 未来日を基準にすると次回見直し期限も未来になり、永久に督促されない")
        if unparsed:
            log(f"★日付として読めない {len(unparsed)}件 → 入れない: {unparsed}")

        if not apply_changes:
            log("")
            log("★これは dry-run です。--apply で書き込みます。")
            return 0

        # ══ 書き込み ══
        # 実測クリック（カニバリの勝者判定に使う）
        cur.execute(
            'SELECT "contentItemId", SUM(clicks) FROM "ContentQuery" GROUP BY 1'
        )
        clicks = dict(cur.fetchall())

        cur.execute('SELECT keyword, id FROM "Keyword" WHERE "businessId"=%s', (business_id,))
        kw_ids = {k: i for k, i in cur.fetchall()}

        n_kw_new = 0
        winners: dict[str, str] = {}  # keyword -> contentItemId
        for kw, group in by_kw.items():
            kid = kw_ids.get(kw)
            if not kid:
                kid = nid("kw")
                cur.execute(
                    'INSERT INTO "Keyword" ("id","businessId","keyword","slug","createdAt","updatedAt")'
                    ' VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT ("businessId","keyword") DO NOTHING',
                    (kid, business_id, kw, slugify(kw, "kw"), now_ts, now_ts),
                )
                if cur.rowcount == 0:
                    cur.execute(
                        'SELECT id FROM "Keyword" WHERE "businessId"=%s AND keyword=%s',
                        (business_id, kw),
                    )
                    kid = cur.fetchone()[0]
                else:
                    n_kw_new += 1
                kw_ids[kw] = kid

            # ★狙いは全記事に残す
            for m in group:
                cid = items[m[COL_ID].strip()][0]
                cur.execute(
                    'UPDATE "ContentItem" SET "mainKeywordId"=%s, "updatedAt"=%s WHERE id=%s',
                    (kid, now_ts, cid),
                )
            # main は1本だけ（実測クリックの多い順・同数なら公開済み優先・最後はID順）
            best = max(
                group,
                key=lambda m: (
                    clicks.get(items[m[COL_ID].strip()][0], 0),
                    "publish" in (m.get(COL_STATE) or ""),
                    m[COL_ID].strip(),
                ),
            )
            bid = items[best[COL_ID].strip()][0]
            winners[kw] = best[COL_ID].strip()
            cur.execute(
                'INSERT INTO "KeywordAssignment" ("id","keywordId","contentItemId","role","createdAt","updatedAt")'
                " VALUES (%s,%s,%s,'main',%s,%s)"
                ' ON CONFLICT ("keywordId","role")'
                ' DO UPDATE SET "contentItemId"=EXCLUDED."contentItemId","updatedAt"=EXCLUDED."updatedAt"',
                (nid("ka"), kid, bid, now_ts, now_ts),
            )

        # クラスタ
        n_cluster, n_member = 0, 0
        for name, members in clusters.items():
            pil = [m for m in members if (m[COL_ROLE] or "").strip() == "Pillar"]
            pillar_cid = items[pil[0][COL_ID].strip()][0] if pil else None
            state = "healthy" if pil else "pillar_missing"
            slug = slugify(name, "cluster")
            cur.execute(
                'INSERT INTO "TopicCluster"'
                ' ("id","businessId","name","slug","pillarContentId","pillarType","state","createdAt","updatedAt")'
                " VALUES (%s,%s,%s,%s,%s,%s::\"PillarType\",%s::\"ClusterState\",%s,%s)"
                ' ON CONFLICT ("businessId","slug") DO UPDATE SET'
                ' "name"=EXCLUDED."name","pillarContentId"=EXCLUDED."pillarContentId",'
                ' "state"=EXCLUDED."state","updatedAt"=EXCLUDED."updatedAt" RETURNING id',
                (nid("tc"), business_id, name, slug, pillar_cid, pillar_type(name), state, now_ts, now_ts),
            )
            tcid = cur.fetchone()[0]
            n_cluster += 1
            for m in members:
                cid = items[m[COL_ID].strip()][0]
                # ★Pillar と明記されたものだけ primary。空欄は secondary（＝ハブではない）。
                #   空欄を primary に昇格させない（誰がハブかは書いてある通りにする）
                role = "primary" if (m[COL_ROLE] or "").strip() == "Pillar" else "secondary"
                cur.execute(
                    'INSERT INTO "ContentCluster" ("id","contentItemId","clusterId","role","createdAt","updatedAt")'
                    " VALUES (%s,%s,%s,%s::\"ClusterRole\",%s,%s)"
                    ' ON CONFLICT ("contentItemId","clusterId")'
                    ' DO UPDATE SET "role"=EXCLUDED."role","updatedAt"=EXCLUDED."updatedAt"',
                    (nid("cc"), cid, tcid, role, now_ts, now_ts),
                )
                n_member += 1

        # 最終レビュー日
        for ext, d in reviewed:
            cur.execute(
                'UPDATE "ContentItem" SET "lastReviewedAt"=%s, "updatedAt"=%s WHERE id=%s',
                (datetime(d.year, d.month, d.day, tzinfo=JST), now_ts, items[ext][0]),
            )

        conn.commit()
        log("")
        log(f"✅ クラスタ {n_cluster}個 / 所属 {n_member}本")
        log(f"✅ メインKW（狙い） {sum(len(v) for v in by_kw.values())}本（Keyword 新規 {n_kw_new}語）")
        log(f"✅ 最終レビュー日 {len(reviewed)}本")
        log(f"★鮮度階層は CSV が全行空だったため触っていない（0本）")

    return 0


if __name__ == "__main__":
    sys.exit(main())
