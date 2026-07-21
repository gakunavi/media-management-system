#!/usr/bin/env python3
"""Threads 投稿実績の同期（GAS Web App から **pull** する）

★設計変更（当初案からの転換）
  当初は「GAS が MMS の /api/ingest/threads へ push」する想定だった。
  しかし GAS 側（Api.gs）に既に API_KEY 認証つきの Web App API があるため、
  **MMS から pull する**方が優れている:

    - GAS のコードを一切変更しなくてよい
    - MMS を外部公開しなくてよい（Cloudflare Tunnel 不要）。通信は MMS → GAS の一方向
    - 取りこぼしても次回まとめて取り直せる（push だと再送実装が要る）

  取得したデータは既存の /api/ingest/threads に HMAC 署名つきで投げ直す。
  ContentItem / ContentMetric / MeasurementCoverage の書き込み規約を
  受口に一本化するため（ロジックを二重に持たない）。

環境変数:
  MMS_THREADS_GAS_URL      … GAS ウェブアプリの /exec URL
  MMS_THREADS_GAS_KEY      … GAS スクリプトプロパティの API_KEY と同じ値
  MMS_THREADS_ACCOUNT_REF  … アカウント識別子（既定 setsuzei_masa）
  MMS_INGEST_SECRET        … /api/ingest/threads の HMAC 共有鍵
  MMS_WEB_INTERNAL_URL     … worker から見た web（compose 内は http://web:3000）

使い方:
  docker compose exec worker python builtin/threads_sync.py
  docker compose exec worker python builtin/threads_sync.py --probe   # 疎通と項目名の確認のみ
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlencode

# GAS 側の1リクエスト上限。シートが数千行に育っても取り切れる値
GAS_FETCH_LIMIT = 5000
# 受口 (/api/ingest/threads) の MAX_POSTS=500 に対する余裕を見た分割数
CHUNK = 200
# GAS の Web App は長いと 20〜30 秒かかることがある
GAS_TIMEOUT = 120

METRIC_KEYS = ("views", "likes", "replies", "reposts", "quotes", "shares")

# ── フォーマット表記ゆれの吸収 ──────────────────────────────
# 運用の途中でラベルを変えた結果、同一フォーマットが2つの名前に割れていた。
# 集計が分断されると「投稿数が多いフォーマット」の評価を誤る。
#
# ★統合するのは「同じものを別表記で書いただけ」に限る。
#   修飾語がついたもの（例: 質問型アンケート / ストーリー実例）は
#   別フォーマットの可能性があるため**触らない**。統合は情報を失う操作で、
#   後から分け直せない。判断は運用側に委ねる。
FORMAT_ALIASES: dict[str, str] = {
    # 表記スタイルの違いのみ（2026-05-18 に Good/Bad へ統一されたが旧表記が残存）
    "good-bad": "Good/Bad",
    "good/bad": "Good/Bad",
}

# 「hayakuchi コンボ1」〜「hayakuchi コンボ7」（2026-05-07〜09 のみ）は
# 「早口」のローマ字表記。接頭辞で一括して寄せる
FORMAT_ALIAS_PREFIXES: tuple[tuple[str, str], ...] = (
    ("hayakuchi", "早口"),
)


def normalize_format(fmt: str) -> str:
    s = str(fmt or "").strip()
    if not s:
        return s
    exact = FORMAT_ALIASES.get(s.lower())
    if exact:
        return exact
    for prefix, canonical in FORMAT_ALIAS_PREFIXES:
        if s.lower().startswith(prefix):
            return canonical
    return s

# GAS 側の項目名が camelCase / snake_case どちらで返ってきても拾えるようにする。
# （Api.gs を書き換えずに使うための保険。キーは小文字化し _ を除いて突合する）
FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "id": ("id",),
    "postId": ("postid", "threadspostid", "mediaid"),
    "text": ("text", "body", "content"),
    "target": ("target",),
    "coreMessage": ("coremessage", "core"),
    "scheduledAt": ("scheduledat", "scheduled"),
    "postedAt": ("postedat", "posted"),
    "status": ("status",),
    "articleLink": ("articlelink", "link", "url"),
    "notes": ("notes", "note", "memo"),
}


def log(msg: str) -> None:
    print(f"[threads_sync] {msg}", flush=True)


def norm_key(k: str) -> str:
    return str(k).replace("_", "").replace("-", "").strip().lower()


def pick(row: dict, aliases: tuple[str, ...]):
    """正規化したキーで最初に見つかった値を返す（未設定なら None）"""
    normalized = {norm_key(k): v for k, v in row.items()}
    for a in aliases:
        v = normalized.get(a)
        if v not in (None, ""):
            return v
    return None


def to_jst_iso(v):
    """GAS が返す "2026-06-22 13:07" にタイムゾーンを補って ISO8601 にする。

    ★これを省くと受口側の new Date() が **UTC として解釈**し、
      22時台の投稿が翌日の実績として記録される（§3 日次集計がずれる）。
      シートの時刻は JST なので +09:00 を明示する。
    """
    s = str(v).strip()
    if not s:
        return None
    # 既にタイムゾーンや T 区切りを持つ ISO 文字列はそのまま通す
    if "T" in s or s.endswith("Z") or re.search(r"[+-]\d{2}:?\d{2}$", s):
        return s
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$", s)
    if not m:
        return s  # 想定外の形式は受口側の解釈に委ねる（不正なら null になる）
    y, mo, d, h, mi, sec = m.groups()
    return (
        f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
        f"T{int(h):02d}:{mi}:{sec or '00'}+09:00"
    )


def to_num(v):
    """'1,234' や '' も安全に数値化する。数値でなければ None"""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def gas_fetch_account() -> list[dict]:
    """フォロワー数の日次履歴を取る（§2454 SnsAccountHealth の元データ）。

    ★Api.gs に action=account を足していない古いデプロイでは 400 が返る。
      その場合は空で続行する。ここで落として投稿の同期まで止めるのは筋が悪い。
    """
    try:
        payload = gas_fetch("account")
    except RuntimeError as e:
        log(f"★アカウント指標を取得できません（Api.gs の再デプロイが必要かも）: {e}")
        return []
    rows = payload.get("account") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        d = str(r.get("date") or "").strip()
        n = to_num(r.get("followers_count"))
        # ★0 や欠損は捨てる。フォロワー0人という誤った履歴を残さない（§3）
        if d and n:
            out.append({"date": d, "followers_count": int(n)})
    return out


def gas_fetch(action: str) -> dict:
    base = os.environ.get("MMS_THREADS_GAS_URL", "").strip()
    key = os.environ.get("MMS_THREADS_GAS_KEY", "").strip()
    if not base or not key:
        raise RuntimeError(
            "MMS_THREADS_GAS_URL / MMS_THREADS_GAS_KEY が未設定です（.env を確認してください）"
        )

    url = f"{base}?{urlencode({'action': action, 'key': key, 'limit': GAS_FETCH_LIMIT})}"
    req = urllib.request.Request(url, headers={"User-Agent": "MMS-threads-sync/1.0"})
    try:
        # GAS の /exec は script.googleusercontent.com へ 302 する。追随が必須
        with urllib.request.urlopen(req, timeout=GAS_TIMEOUT) as r:
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GAS HTTP {e.code}: {e.read().decode()[:300]}") from e

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # ★API_KEY 不一致やデプロイのアクセス設定ミスだと HTML のログイン画面が返る。
        #   その場合ここに落ちるので、生の先頭を出して原因を分かるようにする
        raise RuntimeError(
            f"GAS の応答が JSON ではありません（先頭300字）: {raw[:300]}"
        ) from e


def extract_rows(payload) -> list[dict]:
    """応答のどこに配列があるかは action によって違う。辞書の配列を探し当てる"""
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if not isinstance(payload, dict):
        return []
    for k in ("posts", "data", "rows", "items", "result", "top_posts"):
        v = payload.get(k)
        if isinstance(v, list) and (not v or isinstance(v[0], dict)):
            return [r for r in v if isinstance(r, dict)]
    # 明示キーが無ければ、辞書の配列になっている最初の値を採用する
    for v in payload.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return [r for r in v if isinstance(r, dict)]
    return []


def to_ingest_post(row: dict) -> dict | None:
    ext_id = pick(row, FIELD_ALIASES["id"])
    if not ext_id:
        return None  # id が無い行は受口側でも skip されるので送らない

    post: dict = {"id": str(ext_id)}
    for field, aliases in FIELD_ALIASES.items():
        if field == "id":
            continue
        v = pick(row, aliases)
        if v is None:
            continue
        if field in ("postedAt", "scheduledAt"):
            v = to_jst_iso(v)
            if v is None:
                continue
        post[field] = str(v)

    # ★action=top_posts は posted 行しか返さないが status 列を含まない。
    #   省くと受口が "unknown" として記録してしまうため明示する
    post.setdefault("status", "posted")

    # GAS 側が notes から算出済みの format（"あるある型" 等）を残す。
    # これが無いとフォーマット別の効果比較（§13.4-④）ができない
    fmt = pick(row, ("format",))
    if fmt and "notes" not in post:
        post["notes"] = normalize_format(fmt)

    # ── 指標（§3「欠測とゼロの区別」）──
    # ★GAS 側がまだ Insights を回収していない行も、top_posts は 0 を並べて返す。
    #   それをそのまま保存すると「未計測」が「0だった」として記録され、
    #   平均を下振れさせてフォーマット評価を誤らせる。実際に190件がそうなっていた。
    metrics = {}
    for m in METRIC_KEYS:
        n = to_num(pick(row, (m,)))
        if n is not None:
            metrics[m] = n

    if not is_measured(row, metrics):
        return post  # metrics を付けない＝ContentMetric に行を作らない＝未計測のまま

    post["metrics"] = metrics
    return post


def is_measured(row: dict, metrics: dict) -> bool:
    """この行の Insights が実際に回収済みか。

    判定は2段階:
      ① insights_updated_at があればそれが正（Api.gs に1行足せばこちらが効く）
      ② 無い場合は「全指標が0」を未計測とみなす
         Threads は自分の閲覧も views に入るため、公開済みで views=0 は
         実質ありえない。0 が並ぶ行は「まだ取っていない」か「投稿が削除済み」。
         どちらも「測れていない」なので記録しないのが正しい。
    """
    stamp = pick(row, ("insightsupdatedat", "insightsupdated"))
    if stamp is not None:
        return True
    if any(k in {norm_key(x) for x in row} for k in ("insightsupdatedat", "insightsupdated")):
        return False  # 項目はあるが空＝明確に未計測
    return any(v for v in metrics.values())


def post_to_ingest(posts: list[dict], account_ref: str, account: list[dict] | None = None) -> dict:
    secret = os.environ.get("MMS_INGEST_SECRET", "")
    if not secret:
        raise RuntimeError("MMS_INGEST_SECRET が未設定です（受口が 503 を返します）")
    base = os.environ.get("MMS_WEB_INTERNAL_URL", "http://web:3000").rstrip("/")

    payload = {"accountRef": account_ref, "posts": posts}
    if account:
        payload["account"] = account
    body = json.dumps(payload, ensure_ascii=False)
    ts = str(int(time.time()))
    sig = hmac.new(
        secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256
    ).hexdigest()

    req = urllib.request.Request(
        f"{base}/api/ingest/threads",
        data=body.encode(),
        headers={
            "Content-Type": "application/json",
            "X-MMS-Timestamp": ts,
            "X-MMS-Signature": sig,
            "User-Agent": "MMS-threads-sync/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ingest HTTP {e.code}: {e.read().decode()[:300]}") from e


def main() -> int:
    probe = "--probe" in sys.argv
    account_ref = os.environ.get("MMS_THREADS_ACCOUNT_REF", "setsuzei_masa").strip()

    # top_posts は views 等のインサイトを含む（list は含まない場合がある）
    payload = gas_fetch("top_posts")
    rows = extract_rows(payload)
    log(f"GAS から {len(rows)} 行を取得")

    if not rows:
        log("★0行でした。GAS 側の action=top_posts が想定と違う可能性があります")
        log(f"  応答のキー: {list(payload)[:10] if isinstance(payload, dict) else type(payload)}")
        return 1

    if probe:
        log("--probe: 先頭1件の生データと変換結果だけ出して終了します")
        log("  生: " + json.dumps(rows[0], ensure_ascii=False)[:600])
        log("  変換後: " + json.dumps(to_ingest_post(rows[0]), ensure_ascii=False)[:600])
        return 0

    posts = [p for p in (to_ingest_post(r) for r in rows) if p]
    with_metrics = sum(1 for p in posts if p.get("metrics"))
    log(f"送信対象 {len(posts)} 件（うちインサイトあり {with_metrics} 件）")

    account = gas_fetch_account()
    log(f"フォロワー数の履歴 {len(account)}日分")

    upserted = metrics = skipped = account_days = 0
    for i in range(0, len(posts), CHUNK):
        chunk = posts[i : i + CHUNK]
        # ★アカウント指標は最後のチャンクにだけ載せる。投稿を全部入れてから
        #   計算しないと、その日の平均viewsが未取り込みの投稿を欠いた値になる
        is_last = i + CHUNK >= len(posts)
        res = post_to_ingest(chunk, account_ref, account if is_last else None)
        if not res.get("ok"):
            raise RuntimeError(f"ingest が失敗を返しました: {res}")
        upserted += res.get("upserted", 0)
        metrics += res.get("metrics", 0)
        skipped += res.get("skipped", 0)
        account_days += res.get("accountDays", 0)
        log(f"  {i + len(chunk)}/{len(posts)} 送信済み")

    log(
        f"完了: 投稿 {upserted} 件 / 指標 {metrics} 行 / スキップ {skipped} 件 / "
        f"アカウント指標 {account_days} 日分"
    )
    if with_metrics == 0:
        # ★§3 規約「欠測とゼロの区別」。0 を書くのではなく未計測として警告する
        log("★インサイトが1件も取れていません。GAS 側 Insights.gs の収集を確認してください")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
