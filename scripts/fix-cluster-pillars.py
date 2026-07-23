#!/usr/bin/env python3
"""クラスタのピラー紐付けを cowork 回答（2026-07-23）どおりに直す

★前回の取り込みが誤っていた点
  CSV では ART-006/007/008 が「制度・法人節税 総合Pillar」という1つのクラスタに
  束ねられていたが、cowork によればこれは**CSV作成時の便宜的グルーピング**で、
  設計上の正は `art-kw-map.yaml` の notes:

      ART-006 → P1 即時償却 Pillar   （実体は ART-142・006は301で統合済み）
      ART-007 → P2 法人節税 Pillar
      ART-008 → P3 決算対策 Pillar

  つまり「ピラーが5クラスタで欠けている」と読んでいたが、**3つは実在していて
  紐付けが外れていただけ**だった。束ねを解体して正しい親に付け直す。

★「ピラーが無い」は2種類ある
  ・P1〜P3      … 紐付けが外れていた（今回直す）
  ・横串 2つ    … **設計上そもそも置かない**（クラスタ横断のためPillar-Cluster構造ではない）
  state だけでは区別できないので note に理由を残す。
  区別しないと、直す必要の無いものを直そうとする。

★ART-006 はクラスタから外す
  タイトルもURLも無いプレースホルダで、被リンク0は 301 で ART-142 へ移譲済みだから。
  ピラーに据えると「被リンク0のピラー」という誤った像になる。

使い方:
  python3 scripts/fix-cluster-pillars.py            # dry-run
  python3 scripts/fix-cluster-pillars.py --apply
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)
SRC = "cowork 回答 2026-07-23（art-kw-map.yaml notes が設計上の正）"

# クラスタ名 → (ピラーの externalId, note)
PILLARS: dict[str, tuple[str | None, str]] = {
    "P1 即時償却 Cluster": (
        "ART-142",
        f"ピラー=ART-142。設計上は ART-006 だが 301 で ART-142 へ統合済み（被リンク12本を集約）。{SRC}",
    ),
    "P2 法人節税 Cluster": ("ART-007", f"ピラー=ART-007（法人節税の完全ガイド）。{SRC}"),
    "P3 決算対策 Cluster": ("ART-008", f"ピラー=ART-008（決算対策 完全ガイド）。{SRC}"),
    "税制改正 横串": (
        None,
        f"★ピラーを置かないのが設計。横串＝クラスタ横断で Pillar-Cluster 構造ではない。{SRC}",
    ),
    "税制改正・制度 横串": (
        None,
        f"★ピラーを置かないのが設計。横串＝クラスタ横断で Pillar-Cluster 構造ではない。{SRC}",
    ),
}

# 解体するクラスタ（CSV作成時の便宜的グルーピングで、設計上の単位ではない）
DISSOLVE = "制度・法人節税 総合Pillar"
# 解体後の行き先。ART-006 はどこにも入れない（統合済みプレースホルダ）
REHOME = {"ART-007": "P2 法人節税 Cluster", "ART-008": "P3 決算対策 Cluster"}
DROP = ["ART-006"]


def log(m: str) -> None:
    print(m, flush=True)


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


def main() -> int:
    apply_changes = "--apply" in sys.argv
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute('SELECT "externalId", id FROM "ContentItem"')
        items = dict(cur.fetchall())
        cur.execute('SELECT name, id FROM "TopicCluster"')
        clusters = dict(cur.fetchall())

        missing = [n for n in PILLARS if n not in clusters]
        if missing:
            log(f"★クラスタが見つかりません: {missing}")
            return 1

        log("── ピラーを紐付ける ──")
        plan = []
        for name, (ext, note) in PILLARS.items():
            if ext is None:
                log(f"  {name:24} ピラー無し（設計どおり）")
                plan.append((clusters[name], None, "healthy", note))
                continue
            if ext not in items:
                log(f"  {name:24} ★{ext} が MMS に無い → 見送り")
                continue
            log(f"  {name:24} ← {ext}")
            plan.append((clusters[name], items[ext], "healthy", note))

        log("")
        log(f"── 「{DISSOLVE}」を解体する ──")
        for ext, dest in REHOME.items():
            log(f"  {ext} → {dest}（primary）")
        for ext in DROP:
            log(f"  {ext} → どのクラスタにも入れない（統合済みプレースホルダ・被リンクは301で移譲）")

        if not apply_changes:
            log("")
            log("★これは dry-run です。--apply で書き込みます。")
            return 0

        # 1. 解体対象のメンバーを外す
        cur.execute(
            'DELETE FROM "ContentCluster" WHERE "clusterId"=%s', (clusters[DISSOLVE],)
        )
        removed = cur.rowcount
        # 2. 行き先へ入れ直す（primary）
        moved = 0
        for ext, dest in REHOME.items():
            if ext not in items or dest not in clusters:
                continue
            cur.execute(
                'INSERT INTO "ContentCluster" ("id","contentItemId","clusterId","role","createdAt","updatedAt")'
                " VALUES (%s,%s,%s,'primary',%s,%s)"
                ' ON CONFLICT ("contentItemId","clusterId")'
                ' DO UPDATE SET role=\'primary\', "updatedAt"=EXCLUDED."updatedAt"',
                (nid("cc"), items[ext], clusters[dest], now_ts, now_ts),
            )
            moved += 1
        # 3. ART-142 は既に別クラスタ（不明）に居ないので P1 へ入れる
        if "ART-142" in items and "P1 即時償却 Cluster" in clusters:
            cur.execute(
                'INSERT INTO "ContentCluster" ("id","contentItemId","clusterId","role","createdAt","updatedAt")'
                " VALUES (%s,%s,%s,'primary',%s,%s)"
                ' ON CONFLICT ("contentItemId","clusterId")'
                ' DO UPDATE SET role=\'primary\', "updatedAt"=EXCLUDED."updatedAt"',
                (nid("cc"), items["ART-142"], clusters["P1 即時償却 Cluster"], now_ts, now_ts),
            )
            moved += 1
        # 4. 空になったクラスタを消す
        cur.execute('DELETE FROM "TopicCluster" WHERE id=%s', (clusters[DISSOLVE],))
        # 5. ピラーと note を書く
        for cid, pillar_cid, state, note in plan:
            cur.execute(
                'UPDATE "TopicCluster" SET "pillarContentId"=%s, state=%s::"ClusterState",'
                ' note=%s, "updatedAt"=%s WHERE id=%s',
                (pillar_cid, state, note, now_ts, cid),
            )
        conn.commit()

        log("")
        log(f"✅ 解体 {removed}本を外し、{moved}本を正しいクラスタへ（primary）")
        log(f"✅ ピラーと理由を {len(plan)}クラスタに記録")

    return 0


if __name__ == "__main__":
    sys.exit(main())
