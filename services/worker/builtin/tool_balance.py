#!/usr/bin/env python3
"""ツールの残高を自動取得する（ToolSubscription.balance）

★なぜ要るか
  2026-07-21、DataForSEO の残高が $0.137 まで枯渇し、週次のSERP取得が
  途中で止まる状態になっていた。誰も残高を見ていなかったのが原因。
  API で取れるものは自動で取り込み、段7で警告する。

★対象は vendorKey を持つツールだけ。手入力のツールには触らない。
  取得できなかった場合は **前回値を残す**（0で上書きしない）。
  0にすると「残高ゼロ」という誤った警告が出て、本物の枯渇と区別できなくなる。

環境変数:
  MMS_DATAFORSEO_LOGIN / MMS_DATAFORSEO_PASSWORD
  MMS_DATABASE_URL
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")


def to_db(dt: datetime) -> datetime:
    """aware な日時を **UTC の naive** に直す。

    ★2026-07-22 に発覚した不整合の対処。
      Prisma は UTC を `timestamp without time zone` の列に書き、読むときも
      UTC として解釈して表示時に JST へ直す。
      一方 psycopg が aware な日時を渡すと、Postgres がセッションの
      TimeZone（Asia/Tokyo）で naive に変換するため **JST が入る**。
      同じ列に UTC と JST が混ざり、Prisma 側で 9時間ずれた値になる。
      日付境界をまたぐ行では集計日が1日ずれる。
    """
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def log(msg: str) -> None:
    print(f"[tool_balance] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def fetch_dataforseo() -> tuple[float, str]:
    login = os.environ.get("MMS_DATAFORSEO_LOGIN", "").strip()
    pw = os.environ.get("MMS_DATAFORSEO_PASSWORD", "").strip()
    if not (login and pw):
        raise RuntimeError("MMS_DATAFORSEO_LOGIN / MMS_DATAFORSEO_PASSWORD が未設定です")

    auth = base64.b64encode(f"{login}:{pw}".encode()).decode()
    req = urllib.request.Request(
        "https://api.dataforseo.com/v3/appendix/user_data",
        headers={"Authorization": f"Basic {auth}", "User-Agent": "MMS-tool-balance/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # ★認証情報は例外メッセージに載せない
        raise RuntimeError(f"DataForSEO HTTP {e.code}: {e.read().decode()[:200]}") from e

    money = (body.get("tasks") or [{}])[0].get("result", [{}])[0].get("money") or {}
    balance = money.get("balance")
    if balance is None:
        raise RuntimeError("応答に balance が含まれていません")
    return float(balance), "USD"


# vendorKey → 取得関数
FETCHERS = {"dataforseo": fetch_dataforseo}


def main() -> int:
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    now = datetime.now(JST)
    updated = failed = 0

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT id, name, "vendorKey" FROM "ToolSubscription" '
            "WHERE \"vendorKey\" IS NOT NULL AND state <> 'stopped'"
        )
        rows = cur.fetchall()
        if not rows:
            log("残高を自動取得する対象がありません（vendorKey 未設定）")
            return 0

        for tid, name, key in rows:
            fetcher = FETCHERS.get(key)
            if not fetcher:
                log(f"★{name}: vendorKey='{key}' に対応する取得処理がありません")
                failed += 1
                continue
            try:
                balance, currency = fetcher()
            except Exception as e:  # noqa: BLE001
                # ★失敗しても前回値を残す。0で上書きすると偽の枯渇警告が出る
                log(f"★{name}: 取得失敗（前回値を維持）: {e}")
                failed += 1
                continue

            cur.execute(
                'UPDATE "ToolSubscription" SET "balance"=%s, "balanceCurrency"=%s, '
                '"balanceCheckedAt"=%s, "updatedAt"=%s WHERE id=%s',
                (balance, currency, to_db(now), to_db(now), tid),
            )
            updated += 1
            log(f"{name}: {balance} {currency}")

        conn.commit()

    log(f"完了: 更新 {updated}件 / 失敗 {failed}件")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
