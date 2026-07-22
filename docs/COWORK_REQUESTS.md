# cowork への依頼・確認（2026-07-22 時点）

MMS 側の点検で見つかったもの、および MMS が cowork の出力に依存している箇所の一覧。
Threads の2タスク再登録は完了済みなので、それ以外を扱う。

---

## 1【最優先】GSC/PVの取り込みが 7/13 で止まっている

MMS の指標鮮度チェックで検出。**全ジョブが success のまま、データだけが止まっていた。**

```
pv           1,579行  最終 2026-07-13  通常1日間隔 → 9日更新なし
pv_lifetime    145行  最終 2026-07-13
weekly_clicks / weekly_ctr / weekly_impressions /
weekly_lifetime_pv / weekly_pv / weekly_pv7 / weekly_rank
             各572行  最終 2026-07-13  通常7日間隔
```

cowork 側の状況（MMS から見えた範囲）:

```
shared/gsc-data/daily/daily.json          最終更新 2026-07-13 12:14
shared/gsc-data/weekly-summary-2026-07-13.md
shared/gsc-data/timeseries.db             最終更新 2026-07-20 22:23  ← これだけ新しい
```

`gsc-weekly-fetch` の SKILL.md には
`fetch_daily.py --days 90` → `ingest.py` の順が書かれている。

**聞きたいこと**

- Q1-1. `gsc-weekly-fetch` のスケジュールは今も登録されているか。次回実行はいつか。
  （Threads の2タスクは登録だけが消えていた。同じことが起きていないか）
- Q1-2. 7/20 に `timeseries.db` だけ更新され `daily.json` が 7/13 のままなのはなぜか。
  途中で失敗しているのか、別タスクが timeseries.db を触っているのか。
- Q1-3. `pv` / `weekly_*` を MMS のDBへ書き込んでいるのはどのタスク・どのスクリプトか。
  `.claude/scripts/` を検索しても MMS_DATABASE_URL を使うものが見つからなかった。
- Q1-4. 他のスケジュールも登録が生きているか一覧で出してほしい。
  aio-batch-cold / hot / warm、aio-biweekly-measurement、gsc-weekly-export、
  gsc-weekly-fetch、iriguchi-weekly-review、ml-pipeline-monthly-fetch、
  news-monitor-weekday-morning、news-weekly-summary-friday、
  prj028-weekly-evaluate、rakko-monthly-strategy、weekly-gsc-ga4-export-reminder

**判断してほしいこと**

- Q1-5. `weekly_*` 6指標（計3,300行）は MMS のどの画面からも読まれていない。
  週次PDCAの入力として使うか、書き込みを止めるか、保留か。
  使うなら「何を判断するための数字か」を教えてほしい。日次の clicks/position とは
  別に週次を持つ理由が MMS 側から読み取れない。

---

## 2 診断LPのABCレポートが Threads 流入で壊れる

`.claude/scripts/lp-ab-weekly-report.py` の修正依頼。

**背景**: Threads から診断LPへ送客を始める。リンクは
`https://collect.asset-support.co.jp/r/lp/{投稿ID}` で、MMS が
a/b/c を一様ランダムに選び `?from=threads` を付けて飛ばす。

**問題**: 同スクリプトは `Dimension(name="pagePath")` で集計している。
GA4 の `pagePath` は**クエリ文字列を含まない**ため、`?from=threads` を付けても
記事経由と同じ数字に混ざる。

```
現状     CTR = LP到達数 ÷ 記事PV
Threads後 CTR = (記事経由 + Threads経由) ÷ 記事PV   ← 分子だけ増える
```

結果、CTR が実態より高く出て、診断ロジック1番「クリック率が低い → 記事側ボタンが
改善点」が**永久に発火しなくなる**。勝者判定（view≥100 & submit≥10）も
経路混合の数字になる。

**修正内容**

1. `pagePath` → `pagePathPlusQueryString`（または pagePath + sessionSource 併用）
2. 記事→LP の CTR は `from=media-article` のみを分子にする
3. `from=threads` を別行でレポートする（母数が違うので記事経由と混ぜない）
4. 勝者判定の view≥100 / submit≥10 は経路別に数える

---

## 3 Threads の送客導線の戦略設計

**現状**: 投稿583本すべてで `article_link` が空。導線が存在しない。
代理店募集とDMはプロフ経由で機能しているが、LP送客・LINE送客はゼロから作る。

**決めてほしいこと**

1. どのフォーマットにリンクを載せるか（全部には載せない・石井さん判断）
2. 週88本のうち何本をリンク付きにするか。**まず10〜15本（12〜17%）から**
3. 3つの遷移先の使い分け（soken=節税総研 / lp=診断LP / line=公式LINE）
4. CTA文言（YMYL・景表法に触れない範囲）
5. リンク付き投稿はリーチが絞られる可能性がある。A/Bで検証するか、比率を固定するか

**設計の制約（MMS の実データから）**

- リンクを載せる型は**情報提供型を優先**: チェックリスト・結論ファースト・比較型
- **質問型・あるある型は避ける**。返信/投稿が 0.78・0.94 で1・2位であり、
  返信こそが唯一機能しているDM導線。リンクで会話を切らない
- 同一フォーマット内でリンク有無を混ぜること。特定の型に固めると
  「リンクの影響」と「型の影響」が分離できなくなる

**技術仕様（決定済み）**

```
article_link 列に入れる形式:
  https://collect.asset-support.co.jp/r/{遷移先}/{投稿ID}
  遷移先: soken / lp / line
  投稿ID: その行の id 列（THR-xxx）
例: https://collect.asset-support.co.jp/r/line/THR-601

・utm_source/medium/campaign と ?from=threads は MMS が自動付与。書かない
・診断LPの a/b/c 振り分けも MMS が行う。個別URLを書かない
・クローラのプレビュー踏みは除外済み（送客に数えない）
・MMS が投稿単位でクリックを記録し、/threads の「送客」列に出る
```

---

## 4 公式LINE のURLが2つある

cowork のファイル内に2つ見つかった。どちらが現行か。

```
https://lin.ee/5NVLBXA
https://lin.ee/szd8e1x
```

MMS の `.env`（`MMS_LINK_DEST_LINE`）に入れる。両方生きているなら用途の違いも。

---

## 5 MMS が cowork の出力に依存している箇所（棚卸し）

MMS は以下を**読み取り専用**で参照している。パスやフォーマットを変えるときは
MMS 側も直す必要があるので、変更予定があれば事前に知らせてほしい。

| MMS のジョブ | 読んでいるもの | 実行時刻 |
|---|---|---|
| dm-log-import-daily | `sns-account-create/children/setsuzei-soken/05-sales/agency-recruitment/dm-log.md` | 毎日10:00 |
| rakko-import-daily | `shared/keywords/rakko-exports/<YYYY-MM>/<kw>/` | 毎日05:00 |
| threads-sync-daily | Threads GAS Web App（`action=top_posts` / `account` / `stats`） | 毎日06:30 |
| queue-refill-daily | Threads GAS のシート（draft → pending） | 毎日05:00 |

**特に dm-log.md** は MMS の唯一のDM情報源。表の列順と判定4語
（有効 / 有効候補 / 保留 / 無効）を変えないこと。

- Q5-1. 上記以外に、MMS が読むべきなのに読めていない cowork の出力はあるか。
  GA4 のファネルデータ（`shared/gsc-data/funnel/`）は MMS に入っていない。
  これは MMS 側で持つべきか、cowork 側で完結させるべきか。

---

## 6 補足: MMS 側で今日入れた検知

同じ事故を繰り返さないために入れた。cowork 側で重複して見る必要はない。

| 検知 | 内容 | 通知 |
|---|---|---|
| 指標の鮮度 | 履歴から更新間隔を推定し、3倍を超えたら警告 | 毎朝09:30 Slack |
| Insights の回収停止 | 直近2週の未計測率10%で黄・30%で赤 | 同上 |
| 投稿キューの残数 | 残13本で赤・39本で黄 | 同上 |
| 配信停止 | 最終投稿からの経過日数 | 同上 |
| ツール残高 | DataForSEO 等の枯渇 | 同上 |

★1つ目は「ジョブが緑でもデータが入っていない」を捕まえるもの。
今回の `pv` 9日停止はこれで見つかった。
