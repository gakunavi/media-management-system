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

★変動費（前払い/従量）は残高の減りから積む（2026-07-24 追加）
  DataForSEO・OpenAI には「月額」が無いので、固定費だけ見ていると
  **使った分が一切見えない**。前回見た残高より減っていれば、その差が消費。
  補充（残高が増える）のときは消費0として残高だけ更新する。
  ★円換算は MMS_USD_JPY（既定150）。**為替は仮定**なので原単位も必ず残し、
    画面にもレートを出す。1つの数字に丸めると後から検証できない。

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
# ★為替は仮定。画面にも出して、実額とズレたら直せるようにする
USD_JPY = float(os.environ.get("MMS_USD_JPY") or 150)


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
            'SELECT id, "businessId", name, "monthlyYen", state::text, balance, "balanceCurrency"'
            ' FROM "ToolSubscription" WHERE state <> \'stopped\''
        )
        rows = cur.fetchall()

        fixed_total = 0.0
        var_total = 0.0
        for tid, biz, name, yen, state, balance, ccy in rows:
            # ── 変動費: 前回見た残高からの減りを積む ──
            cur.execute(
                'SELECT "variableAmount", "balanceSnapshot" FROM "ToolCostMonthly"'
                ' WHERE period=%s AND "toolId"=%s',
                (PERIOD, tid),
            )
            prev = cur.fetchone()
            used = float(prev[0]) if prev and prev[0] is not None else 0.0
            last_bal = float(prev[1]) if prev and prev[1] is not None else None

            if balance is not None:
                b = float(balance)
                if last_bal is not None and b < last_bal:
                    # ★減った分だけが消費。増えた（補充した）ときは足さない
                    used += last_bal - b
                last_bal = b

            var_yen = round(used * USD_JPY, 2) if (ccy or "").upper() == "USD" and used else (
                round(used, 2) if used else None
            )

            cur.execute(
                """
                INSERT INTO "ToolCostMonthly"
                  ("id","businessId","period","toolId","monthlyYen","state",
                   "variableYen","variableAmount","variableCurrency","balanceSnapshot",
                   "createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,%s::"ToolState",%s,%s,%s,%s,%s,%s)
                ON CONFLICT ("period","toolId") DO UPDATE SET
                  "monthlyYen"=EXCLUDED."monthlyYen","state"=EXCLUDED."state",
                  "variableYen"=EXCLUDED."variableYen",
                  "variableAmount"=EXCLUDED."variableAmount",
                  "variableCurrency"=EXCLUDED."variableCurrency",
                  "balanceSnapshot"=EXCLUDED."balanceSnapshot",
                  "updatedAt"=EXCLUDED."updatedAt"
                """,
                (f"tcm_{uuid.uuid4().hex}", biz, PERIOD, tid, yen, state,
                 var_yen, used or None, ccy, last_bal, now_ts, now_ts),
            )
            if state == "active":
                if yen is not None:
                    fixed_total += float(yen)
                if var_yen:
                    var_total += var_yen
        conn.commit()

    log(
        f"{PERIOD}: {len(rows)}件を記録"
        f"（固定 ¥{fixed_total:,.0f} / 変動 ¥{var_total:,.0f}・為替 ¥{USD_JPY:.0f}/$）"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
