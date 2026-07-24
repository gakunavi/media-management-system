#!/usr/bin/env python3
"""ロードマップの各Phaseが本当に動いているかを実データで判定する

★なぜ要るか（2026-07-24・石井さんの指摘）
  「開発は完了か」と聞かれて「完了」と答えたが誤りだった。
  `docs/PHASES.md` のロードマップは59行あるのに**完了/未完了を記録する列が無く**、
  整合チェック（docs/check-consistency.sh）もフェーズの進捗を見ていなかった。
  そのため「画面が動いている＝完成」と読み違えた。

★判定は宣言ではなく実データで行う（今日の url_health と同じ考え方）
  「実装した」と書いてあっても、そのモデルに1行も入っていなければ
  動いていない。逆に画面が無くてもデータが入っていれば計測は生きている。
  **チェックボックスを人が更新する方式にはしない**（更新されなくなるため）。

判定:
  done     … 担当モデルすべてに実データがある
  partial  … 一部にある
  empty    … 全部0件（＝未着手か、動いていない）
  n/a      … 担当モデルが特定できない（インフラ・ドキュメント系）

使い方:
  python3 scripts/phase-status.py            # 一覧
  python3 scripts/phase-status.py --empty    # 動いていないものだけ
  python3 scripts/phase-status.py --md       # PHASES.md に貼る表を出す
"""

from __future__ import annotations

import os
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

# ★worker コンテナから動かすときはリポジトリが無いので、パスを渡せるようにする
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHASES = os.environ.get("MMS_PHASES_MD") or os.path.join(ROOT, "docs", "PHASES.md")

# ★モデルを持たない（データで判定できない）Phase。
#   ここに入れるのは「実装物がDBに現れない」ものだけ。判定不能を done と偽らない。
NO_MODEL_HINT = ("全82m", "—", "")


def normalize_dsn(url: str) -> str:
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    schema = q.pop("schema", None)
    if schema:
        q.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q, safe="-%"), p.fragment))


def parse_rows() -> list[dict]:
    out = []
    for line in open(PHASES, encoding="utf-8").read().split("\n"):
        m = re.match(r"^\|\s*(\d+)\s*\|\s*\*\*(P[0-9.a-z-]+)\*\*\s*\|", line)
        if not m:
            continue
        cells = [c.strip() for c in line.split("|")]
        # | # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
        if len(cells) < 9:
            continue
        models = [
            x.strip()
            for x in re.split(r"[/／]", cells[6])
            if re.fullmatch(r"[A-Z][A-Za-z]+", x.strip())
        ]
        out.append(
            {
                "no": int(m.group(1)),
                "phase": m.group(2),
                "title": re.sub(r"\*\*|`", "", cells[3])[:52],
                "models": models,
                "criteria": re.sub(r"\*\*|`", "", cells[7])[:80],
            }
        )
    return out


def main() -> int:
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    rows = parse_rows()
    wanted = sorted({m for r in rows for m in r["models"]})

    counts: dict[str, int] = {}
    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
        )
        exists = {t for (t,) in cur.fetchall()}
        for m in wanted:
            if m not in exists:
                counts[m] = -1  # テーブルすら無い
                continue
            cur.execute(f'SELECT COUNT(*) FROM "{m}"')
            counts[m] = cur.fetchone()[0]

    def status(r: dict) -> str:
        if not r["models"]:
            return "n/a"
        vals = [counts.get(m, -1) for m in r["models"]]
        if all(v > 0 for v in vals):
            return "done"
        if any(v > 0 for v in vals):
            return "partial"
        return "empty"

    only_empty = "--empty" in sys.argv
    as_md = "--md" in sys.argv

    tally: dict[str, int] = {}
    lines = []
    for r in rows:
        st = status(r)
        tally[st] = tally.get(st, 0) + 1
        if only_empty and st != "empty":
            continue
        missing = [m for m in r["models"] if counts.get(m, -1) <= 0]
        mark = {"done": "✅", "partial": "🟡", "empty": "❌", "n/a": "—"}[st]
        if as_md:
            lines.append(
                f"| {r['phase']} | {mark} {st} | {r['title']} | "
                f"{'・'.join(missing) if missing else '—'} |"
            )
        else:
            lines.append(
                f"{mark} {r['phase']:<8} {r['title'][:40]:<42} "
                + (f"未投入: {', '.join(missing[:4])}" if missing else "")
            )

    if as_md:
        print("| Phase | 状態 | 内容 | データが無いモデル |")
        print("|---|---|---|---|")
    print("\n".join(lines))
    print()
    print(
        f"合計 {len(rows)}  ✅done {tally.get('done',0)}  "
        f"🟡partial {tally.get('partial',0)}  ❌empty {tally.get('empty',0)}  "
        f"—n/a {tally.get('n/a',0)}"
    )
    print("★empty は「未着手」か「実装したが動いていない」のどちらか。区別は人が見る")
    return 0


if __name__ == "__main__":
    sys.exit(main())
