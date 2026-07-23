#!/usr/bin/env python3
"""記事に「読者」と「内容の型」を一括で付ける（P4.9 改訂版）

★2026-07-23 の訂正
  最初 budgetTier（高/中/低）を記事に付けたが、これは誤りだった。
  budgetTier は**商談相手の予算**を表す区分で、記事から読者の予算規模は決まらない。
  同じ外貨両替機（350万/台）の記事を、1台買う人も数千万分買う人も読む。
  実際、唯一の成約（480万＝ML 240万×2台）は定義上「中」なのに、
  その記事を「高」と分類していた。**実測1件が分類を否定していた。**

  記事について確実に言えるのは「**誰に向けて・何を書いたか**」だけ。
  金額はリード側（Lead.budgetTier）で商談時に聞いて入れる。

★何が分かるようになるか
  ・法人向け記事と個人事業主向け記事で、PV・クリックの伸びを分けて見る
  ・どの型（商材／比較／制度／時事…）が送客・問い合わせに効くか
  実測（2026-07-23）では唯一の成約が「主力5商材の比較」＝comparison から出ている。

★方針（docs/PHASES.md §9.4.2）
  **ルール＋一括処理＋人の承認**。159記事をAIが1本ずつ判定しない。
★判定できないものは埋めない（§3）。推測で埋めると分析が嘘になる。

使い方:
  python3 scripts/tag-content-axes.py            # dry-run
  python3 scripts/tag-content-axes.py --apply    # 書き込む
  python3 scripts/tag-content-axes.py --csv      # 全件をCSVで確認
"""

from __future__ import annotations

import os
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

# ── 読者（audience）────────────────────────────────────
#
# ★複数持てる。「法人にも個人事業主にも効く記事」が実在する（税制改正など）。
#   both は「どちらでもない」ではなく「どちらも読む」。

# 個人事業主に固有の語（法人には出てこない）
SOLE_WORDS = [
    "個人事業主", "フリーランス", "青色申告", "白色申告", "確定申告",
    "小規模企業共済", "iDeCo", "イデコ", "自宅按分", "e-Tax",
]
# 法人に固有の語
CORP_WORDS = [
    "法人", "中小企業", "役員", "決算", "経営者", "株式", "自社株", "事業承継",
    "経営強化税制", "即時償却", "特別償却", "税額控除", "投資促進税制",
    "研究開発税制", "賃上げ促進税制", "オペレーティングリース", "オペリース",
    "GPU", "AIサーバー", "データセンター", "外貨両替機", "IoT", "EV充電",
    "DXポータル", "航空機", "船舶", "コンテナ", "重機", "設備投資",
    "経営セーフティ共済", "倒産防止共済", "中退共", "特退共", "社宅",
    "スタートアップ", "医療法人", "クリニック", "建設業", "SaaS",
]
# 税理士・代理店向け（商材の買い手ではない）
PARTNER_WORDS = ["税理士向け", "会計事務所", "紹介代理店", "顧問先", "パートナー向け", "提案フロー"]

# ── 内容の型（contentFormat）──────────────────────────
#
# ★上から順に評価し、最初に当たったものを採る。
#   risk を先に見る理由: 「外貨両替機 リスク」は商材の記事だが、
#   読者は買う直前で不安を潰しに来ている。product に落とすと打ち手を誤る。

FORMAT_RULES: list[tuple[str, str, list[str]]] = [
    (
        "risk",
        "リスク・失敗・否認",
        ["リスク", "否認", "失敗", "倒産", "破産", "民事再生", "トラブル", "落とし穴",
         "デメリット", "逆効果", "業者選び", "税務調査", "注意"],
    ),
    (
        "comparison",
        "選択肢を比べる",
        ["比較", "選び方", "どっち", "違い", "使い分け", " vs ", "選ぶ", "最適解", "優先順位", "判断軸"],
    ),
    (
        "case_study",
        "事例・インタビュー",
        ["事例", "実例", "インタビュー", "の全貌", "の真相", "事案"],
    ),
    (
        "news",
        "時事・法改正",
        ["速報", "改正", "大綱", "施行", "2027年", "2029年", "全体像", "ニュース", "詳報", "今後の見通し"],
    ),
    (
        "howto",
        "実務手順",
        ["手順", "申請", "手続き", "書き方", "チェックリスト", "テンプレ", "ひな形",
         "フロー", "対応", "スケジュール", "計算方法", "やり方", "整備", "シミュレーション", "設計"],
    ),
    (
        "product",
        "特定商材の解説",
        ["GPU", "AIサーバー", "外貨両替機", "IoTビーコン", "IoT自販機", "EV充電", "DXポータル",
         "データセンター", "航空機", "オペレーティングリース", "オペリース", "法人保険",
         "太陽光", "暗号資産", "ストックオプション", "耐用年数", "サーバー", "パソコン",
         "ネットワーク機器", "ソフトウェア", "クラウド"],
    ),
    (
        "system",
        "税制・制度の解説",
        ["税制", "特例", "控除", "共済", "とは", "制度", "通達", "ルール", "仕組み",
         "完全ガイド", "解説", "経費", "節税"],
    ),
]


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


def decode_entities(s: str) -> str:
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    return s.replace("&amp;", "&")


def parse_pg_array(v) -> list[str]:
    """Postgres の配列を Python のリストにする。文字列で返ることがある"""
    if v is None:
        return []
    if isinstance(v, list):
        return [x for x in v if x]
    s = str(v).strip()
    if s.startswith("{") and s.endswith("}"):
        s = s[1:-1]
    return [x.strip().strip('"') for x in s.split(",") if x.strip()]


def has_any(text: str, words: list[str]) -> str | None:
    low = text.lower()
    for w in words:
        if w.lower() in low:
            return w
    return None


def decide_audience(title: str, category: str | None) -> tuple[list[str], str]:
    t = decode_entities(title)
    ctx = f"{t} {category or ''}"

    partner = has_any(ctx, PARTNER_WORDS)
    if partner:
        return ["partner"], f"パートナー向け（「{partner}」）"

    sole = has_any(ctx, SOLE_WORDS)
    corp = has_any(ctx, CORP_WORDS)

    if sole and corp:
        # ★両方の語が出る記事は、実際に両方が読む（例: 少額減価償却の個人事業主ガイド）
        return ["both"], f"両方の語（「{sole}」「{corp}」）"
    if sole:
        return ["sole_proprietor"], f"個人事業主固有（「{sole}」）"
    if corp:
        return ["corporate"], f"法人固有（「{corp}」）"

    # ★税制改正・法改正は読者を選ばない。ここが最初の分類で40件残った原因だった
    if has_any(ctx, ["税制改正", "改正", "大綱", "施行", "課税", "インボイス", "電子帳簿"]):
        return ["both"], "制度・法改正（読者を選ばない）"
    return [], "判定不能"


def decide_format(title: str) -> tuple[str | None, str]:
    t = decode_entities(title)
    for value, why, words in FORMAT_RULES:
        w = has_any(t, words)
        if w:
            return value, f"{why}（「{w}」）"
    return None, "判定不能"


AUD_LABEL = {
    "corporate": "法人向け",
    "sole_proprietor": "個人事業主向け",
    "both": "両方",
    "partner": "パートナー向け",
}
FMT_LABEL = {
    "product": "商材",
    "comparison": "比較",
    "system": "制度",
    "news": "時事",
    "howto": "実務",
    "risk": "リスク",
    "case_study": "事例",
}


def main() -> int:
    apply_changes = "--apply" in sys.argv
    force = "--force" in sys.argv
    as_csv = "--csv" in sys.argv

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT id, "externalId", title, category, audience, "contentFormat"
               FROM "ContentItem" WHERE type IN ('article','article_unlinked')
               ORDER BY "externalId" """
        )
        rows = cur.fetchall()

        aud_stats: dict[str, int] = {}
        fmt_stats: dict[str, int] = {}
        changes = []
        undecided = []

        if as_csv:
            print("externalId,audience,audience_why,format,format_why,title")

        for cid, ext, title, category, raw_aud, cur_fmt in rows:
            # ★psycopg は未知の enum 配列を "{a,b}" の文字列で返すことがある。
            #   list() すると1文字ずつに割れる（実際 ['{','}'] になった）
            cur_aud = parse_pg_array(raw_aud)
            aud, a_why = decide_audience(title, category)
            fmt, f_why = decide_format(title)

            keep_aud = bool(cur_aud) and not force
            keep_fmt = cur_fmt is not None and not force
            new_aud = cur_aud if keep_aud else aud
            new_fmt = cur_fmt if keep_fmt else fmt

            key_a = "/".join(AUD_LABEL.get(a, a) for a in new_aud) or "（未判定）"
            aud_stats[key_a] = aud_stats.get(key_a, 0) + 1
            key_f = FMT_LABEL.get(new_fmt or "", "（未判定）")
            fmt_stats[key_f] = fmt_stats.get(key_f, 0) + 1

            if not aud or fmt is None:
                undecided.append(
                    f"  {ext}  読者={a_why} / 型={f_why}  {decode_entities(title)[:52]}"
                )

            if as_csv:
                safe = decode_entities(title).replace('"', "'")
                print(f'{ext},{"|".join(new_aud)},"{a_why}",{new_fmt or ""},"{f_why}","{safe}"')

            if cur_aud != new_aud or cur_fmt != new_fmt:
                changes.append((cid, new_aud, new_fmt))

        if as_csv:
            return 0

        log(f"対象記事: {len(rows)}件")
        log("")
        log("── 読者（audience）──")
        for k, n in sorted(aud_stats.items(), key=lambda x: -x[1]):
            log(f"  {k:16} {n:4}件  {'█' * (n * 40 // max(1, len(rows)))}")
        log("")
        log("── 内容の型（contentFormat）──")
        for k, n in sorted(fmt_stats.items(), key=lambda x: -x[1]):
            log(f"  {k:10} {n:4}件  {'█' * (n * 40 // max(1, len(rows)))}")

        if undecided:
            log("")
            log(f"── ★判定できなかったもの（{len(undecided)}件・空のまま残す）──")
            for line in undecided[:15]:
                log(line)
            if len(undecided) > 15:
                log(f"  … 他 {len(undecided) - 15}件")

        log("")
        log(f"変更対象: {len(changes)}件")
        if not apply_changes:
            log("★これは dry-run です。--apply で書き込みます。")
            return 0

        for cid, aud, fmt in changes:
            cur.execute(
                'UPDATE "ContentItem" SET audience=%s::"ContentAudience"[], '
                '"contentFormat"=%s::"ContentFormat", "updatedAt"=now() WHERE id=%s',
                (aud, fmt, cid),
            )
        conn.commit()
        log(f"✅ {len(changes)}件を更新しました")

    return 0


if __name__ == "__main__":
    sys.exit(main())
