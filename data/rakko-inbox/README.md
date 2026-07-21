# rakko-inbox — ラッコキーワードのエクスポート置き場

ラッコキーワードは**このプランではAPIが使えない**ため、cowork が Chrome を
自動操作して取得したファイルをここに置き、MMS が取り込む。

> ★ブラウザ自動操作を MMS 側に持ち込まない。既に動いている仕組みと二重になり、
>   かつ画面変更で壊れやすい部分を2箇所抱えることになる。MMS は「置かれた
>   ファイルを読む」ことに徹する。

## 置くもの

```
data/rakko-inbox/rakkokeyword_suggestKeywords_<KW>_<日付>_<時刻>.json
```

サジェストのエクスポート（JSON）。ファイル名は変えなくてよい。
中の `data.query.keyword` から対象KWを判別する。

## 取り込み

```bash
docker compose exec worker python builtin/rakko_import.py --dry-run   # 確認のみ
docker compose exec worker python builtin/rakko_import.py
```

取り込み済みファイルは `processed/` へ移動する（再取り込みを防ぐ）。

## 対応していないもの

`rakko_cooccurrence.csv` / `rakko_headings.csv` は**どのKWのものか
ファイルからは判別できない**（ファイル名にKWが入らず、中身にも無い）。
誤ったKWに紐付けると分析が静かに壊れるため、現状は取り込まない。
取り込むにはファイル名にKWを含める運用が必要。
