# cowork への依頼・確認（2026-07-22 現在）

MMS 側の作業で解決したものを外し、**cowork でしか判断・対応できないもの**だけを残した。
上から優先順。

---

## A. 確認してほしいこと（回答だけでよい）

### A-1. スケジュールの生存確認【最優先】

Threads の2タスクは**登録だけが消えていた**。同じことが他でも起きていないか。

とくに `gsc-weekly-fetch` は止まっている疑いが濃い:

```
shared/gsc-data/daily/daily.json     最終 2026-07-13 12:14
shared/gsc-data/weekly-summary-2026-07-13.md
shared/gsc-data/timeseries.db        最終 2026-07-20 22:23   ← これだけ新しい
```

SKILL.md は `fetch_daily.py --days 90` → `ingest.py` の順。
**7/20 に timeseries.db だけ更新され daily.json が 7/13 のまま**なのはなぜか。

以下すべてについて「登録が生きているか・次回実行はいつか」を一覧で出してほしい:

```
aio-batch-cold / aio-batch-hot / aio-batch-warm
aio-biweekly-measurement
gsc-weekly-export / gsc-weekly-fetch
iriguchi-weekly-review
ml-pipeline-monthly-fetch
news-monitor-weekday-morning / news-weekly-summary-friday
prj028-weekly-evaluate
rakko-monthly-strategy
weekly-gsc-ga4-export-reminder
```

### A-2. 公式LINE のURLはどちらが正か

```
https://lin.ee/5NVLBXA
https://lin.ee/szd8e1x
```
MMS の `.env`（`MMS_LINK_DEST_LINE`）に入れる。両方生きているなら用途の違いも。

### A-3. 代理店へ配布URLをどう案内したか

MMS が代理店LPを取り込んだ結果（直近30日）:

```
訪問 189 / 問い合わせ 1 / 稼働コード 7

コード無し 152  ← 全体の80%。唯一の問い合わせ1件もコード無し
AG-0001     13   最終15日前
AG-0062      8   最終12日前
AG-0088      6   最終12日前
AG-0087      4   最終14日前
AG-0096      3   最終 4日前
AG-0100      2   最終 8日前
AG-0074      1   最終12日前
```

**8割がコード無し＝どの代理店の貢献か分からない。** 原因の候補:

- 代理店がドメイン直打ちで案内している
- URLは配ったがコード付きで共有されていない（口頭・名刺など）
- LP側がコード付きURLをコード無しへリダイレクトしている

3つ目なら LP 側の実装問題なので、まずそこを確認してほしい。

### A-4. `lp_form_submit` が0件の理由

診断LPに30日で5人が到達し、送信イベントが**1件も発火していない**。

- 5人が全員離脱したのか
- イベント自体が壊れているのか

CF7 フォームID 601652 の送信計測が生きているか確認してほしい。
**壊れているなら CVR 0% は「LPが悪い」ではなく「測れていない」**で、
LPをどう直しても永久に効果が測れない。

---

## B. 対応してほしいこと

### B-1. 診断LPのABCテストを畳んで1本にする

MMS が GA4 を直接読んで分かった実測（直近30日）:

```
                実人数   イベント数
diagnosis-a       1人        1
diagnosis-b       4人       11    ← 11イベントは4人の再訪
diagnosis-c       0人        0
              ─────────────────
              合計 5人       12

lp_form_submit … 30日間で0件
最後の到達    … 2026-07-11
記事PV 1,179 → LP到達 5人（到達率 0.42%・目安0.5%未満）
```

勝者判定は「各パターン 到達100・送信10」。月5人を3分割している限り
**構造的に満たされない**。MMS は「いまのペース（1日0.2人）だと
残り295人に約1770日かかります」と表示している。

設計書 §3.7.0 が既に明文化していた:

> CVR 1% 想定で有意差を検出するには、各群で数百〜数千セッションが必要。
> **月38訪問では、A/Bテストを回しても何ヶ月経っても結論が出ない。**
>
> | 今（LP訪問 〜100/月） | ①定性 ②**大きく変えて before/after** ③クラスタ単位 |
> | 先（1,000+/月） | ⑤ LP/CTA の A/Bテスト |

設計時の想定は月38訪問。**実測はその1/7の月5人**。

**依頼**

1. `lp-link-inject.py` の振り分けJS（`ROTATION_JS`）を廃し、LPを1本に固定
   - どれを残すかは**データでは決められない**（1人・4人・0人は差ではなく偶然）。
     デザイン意図で選んでほしい。判断材料が無ければ a（イラスト・初出）
2. `lp-ab-weekly-report.py` を before/after 型に組み替え
   - パターン別の勝敗判定をやめ、「LPを大きく変えた前後28日」で比較
3. **記事側の導線を先に直す**（到達率 0.42% < 目安 0.5%）
   - LPを何本にしても、記事から人が来なければ母数は増えない

### B-2. `lp-ab-weekly-report.py` の集計軸（Threads送客を始める前に）

Threads から診断LPへ送客する。リンクは
`https://collect.asset-support.co.jp/r/lp/{投稿ID}`（MMS が `?from=threads` を付与）。

同スクリプトは `Dimension(name="pagePath")` で集計しているが、
**GA4 の `pagePath` はクエリ文字列を含まない**。このままだと Threads 経由が
記事経由と同じ数字に混ざり、CTR の分子だけが増えて
「記事側ボタンは問題なし」と誤判定する（診断ロジック1番が発火しなくなる）。

1. `pagePath` → `pagePathPlusQueryString`（または sessionSource 併用）
2. 記事→LP の CTR は `from=media-article` のみを分子にする
3. `from=threads` は別行で出す（母数が違うので混ぜない）

### B-3. Threads の送客導線の戦略設計

投稿583本すべてで `article_link` が空。導線が存在しない。

**決めてほしいこと**

1. どのフォーマットにリンクを載せるか（全部には載せない・石井さん判断）
2. 週88本のうち何本をリンク付きにするか。**まず10〜15本（12〜17%）から**
3. 3つの遷移先の使い分け（soken / lp / line）
4. CTA文言（YMYL・景表法に触れない範囲）
5. リンク付き投稿はリーチが絞られる可能性。A/Bで検証するか比率固定か

**MMS の実データからの制約**

- 載せる型は**情報提供型を優先**: チェックリスト・結論ファースト・比較型
- **質問型・あるある型は避ける**。返信/投稿が 0.94・0.78 で1・2位。
  返信こそ唯一機能しているDM導線で、リンクで会話を切らない
- 同一フォーマット内でリンク有無を混ぜる。特定の型に固めると
  「リンクの影響」と「型の影響」が分離できない

**技術仕様（決定済み）**

```
article_link 列に入れる形式:
  https://collect.asset-support.co.jp/r/{遷移先}/{投稿ID}
  遷移先: soken / lp / line     投稿ID: その行の id 列（THR-xxx）
例: https://collect.asset-support.co.jp/r/line/THR-601

・utm_* と ?from=threads は MMS が自動付与。書かない
・診断LPの振り分けも MMS が行う。個別URLを書かない
・クローラのプレビュー踏みは除外済み
・MMS が投稿単位でクリックを記録し /threads の「送客」列に出る
```

### B-4. 日次タスクの直接書き込み枠（対応済みなら確認だけ）

MMS の自動割当は 07/08/10/11/13/14/15/16/17/18/20/21/22 時。
Step3 ヒット即応と Step4 木曜差し込みは **09:00 / 12:00 / 19:00 のみ**を使うこと。
11:00・15:00・21:00 に書くと同時刻に2本入り、1回のトリガーで両方投稿される。

---

## C. 判断してほしいこと

### C-1. `weekly_*` 6指標をどうするか

MMS に 3,300行（各572行）あるが、**どの画面からも読まれていない**。
最終更新 2026-07-13。

- 使う → 「何を判断するための数字か」を教えてほしい。
  日次の clicks/position とは別に週次を持つ理由が MMS 側から読み取れない
- 止める → 書き込み元を止める
- 保留 → 「未使用」表示のまま残す（いまの状態）

### C-2. media.db コンソールの縮退

MMS 側で以下を持つようにしたので、重複範囲がかなり減った。
2週間後の縮退判断の材料にしてほしい。

| コンソールのタブ | MMS |
|---|---|
| 記事一覧 | `/content` |
| サイト全体 日次推移 | ダッシュボード「日次推移」（表示・クリック・PV・掲載順位） |
| 記事別 日次推移 | 未（MMS に無い。必要なら作る） |
| PV 日次推移 | ダッシュボード（GA4直結・毎日07:30） |
| 検索クエリ Top200 | `/keywords`（`KeywordRanking` 1,000行） |
| 診断LP ファネル | `/lp` |
| 代理店LP | `/lp`（配布コード別・毎日07:15取り込み） |
| PDCA intervention | `/experiments`（手動記録も可・28日後自動判定） |

**残る差分は「記事別 日次推移」だけ。** これが要るなら MMS に作る。

---

## D. MMS が cowork の出力に依存している箇所（変更時は事前連絡がほしい）

| MMS のジョブ | 読んでいるもの | 実行 |
|---|---|---|
| dm-log-import-daily | `.../agency-recruitment/dm-log.md` | 毎日10:00 |
| rakko-import-daily | `shared/keywords/rakko-exports/<YYYY-MM>/<kw>/` | 毎日05:00 |
| agency-lp-import-daily | `tools/media-console/agency_lp_sources.json` → 各LPの export.php | 毎日07:15 |
| threads-sync-daily | Threads GAS Web App | 毎日06:30 |
| queue-refill-daily | Threads GAS のシート（draft → pending） | 毎日05:00 |

**dm-log.md** は MMS の唯一のDM情報源。列順と判定4語
（有効 / 有効候補 / 保留 / 無効）を変えないこと。

---

## E. 解決済み（もう依頼不要）

| 元の依頼 | どうしたか |
|---|---|
| PV が7/13で止まっている | MMS が GA4 を直接読む（`ga4-fetch-daily` 毎日07:30）。Notion 経由をやめた |
| GA4 ファネルデータを MMS へ | 同上。`funnel/*.json` 経由は不要になった |
| `pv` を MMS に書くタスクの特定 | 不要。MMS が自前で取る |
| intervention の二重管理 | MMS を正とし、記録の入口も `/experiments` に移した |
| 代理店LPのデータ | MMS が export.php を直接取得（PIIは保存しない） |
