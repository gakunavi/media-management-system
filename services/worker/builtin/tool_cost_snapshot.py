#!/usr/bin/env python3
"""ツールの月額を月次で記録する（コスト推移の元データ）

★なぜ要るか
  「今いくら払っているか」は分かるが、**増えているのか減っているのか**が
  分からなかった。ツールは足すのは簡単で止めるのは忘れるので、
  合計は放っておくと単調に増える。

★過去は埋めない（§3）
  計測開始（このジョブの初回）より前の月は「未計測」であって0円ではない。
  遡って埋めると「先月まで無料だった」という嘘の推移になる。

★検討中・トライアルも記録する
  合計からは分けて出すが、**見込みとして把握しておかないと**
  「検討中のツールを全部入れたらいくらか」が判断できない。

毎日走らせてよい（当月の行を上書きする）。月をまたいだ時点で新しい行になる。
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
PERIOD = now_ts.strftime("%Y-%m")


def log(m: str) -> None:
    print(f"[tool_cost_snapshot] {m}", flush=True)


def normalize_dsn(url: str) -> str:
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    schema = q.pop("schema", None)
    if schema:
        q.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q, safe="-%"), p.fragment))


def main() -> int:
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute(
            'SELECT id, "businessId", name, "monthlyYen", state::text FROM "ToolSubscription"'
            " WHERE state <> 'stopped'"
        )
        rows = cur.fetchall()

        total = 0.0
        for tid, biz, name, yen, state in rows:
            cur.execute(
                """
                INSERT INTO "ToolCostMonthly"
                  ("id","businessId","period","toolId","monthlyYen","state","createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,%s::"ToolState",%s,%s)
                ON CONFLICT ("period","toolId") DO UPDATE SET
                  "monthlyYen"=EXCLUDED."monthlyYen","state"=EXCLUDED."state",
                  "updatedAt"=EXCLUDED."updatedAt"
                """,
                (f"tcm_{uuid.uuid4().hex}", biz, PERIOD, tid, yen, state, now_ts, now_ts),
            )
            if state == "active" and yen is not None:
                total += float(yen)
        conn.commit()

    log(f"{PERIOD}: {len(rows)}件を記録（契約中の固定月額 合計 ¥{total:,.0f}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
