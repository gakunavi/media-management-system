# cowork への依頼・確認（2026-07-22 深夜・最終）

**依頼はすべて完了した。** 以下は完了記録と、実測で確認した内容。
以降の依頼が出たら追記する。

---

## 完了したもの

| 項目 | 結果 |
|---|---|
| **A-1 スケジュール停止** | ✅ 原因＝7/13にUIから手動無効化（承認プロンプト洪水と同時実行上限3が引き金）。承認権限の追加・cron分散・11タスク再有効化まで完了 |
| **A-2 公式LINE のURL** | ✅ `/r/line/<設置場所>` の計測リンクに置換。生 `lin.ee` は全ページ0件 |
| **A-3 代理店LPのコード消失** | ✅ `sessionStorage` → `localStorage` + Cookie 90日 |
| **A-4 診断LPの送信計測** | ✅ CF7 6.x は `wpcf7mailsent` を投げない。`wpcf7submit` へ修正 |
| **B-4 日次タスクの書き込み枠** | ✅ 09:00 / 12:00 / 19:00 に限定 |
| **#2 テーマの生 lin.ee 19箇所** | ✅ 設置場所別の計測リンクに置換 |
| **#3 フォーム転送＋段2ファネル** | ✅ プラグイン `mms-connector`。実送信で確認（下記） |
| **#5 診断LPをBに集約** | ✅ 158本。記事本文のLINEも計測経由に |
| **#6 レポート改修** | ✅ before/after 型＋経路分離 |
| **#7 Threads 送客導線のURL形式** | ✅ MMS 仕様に修正 |
| **`article_id` メタ** | ✅ 162本充填。`wp-publish.py` も恒久対応 |

---

## #3 の実測記録（2026-07-22 23:45）

`/contact/?from=media` から「パートナー提携をご検討の方」を選び、
興味商材2つをチェックして実送信した結果。

```
Lead.type        agency                       ← 代理店候補として起票
interestProduct  {外貨両替機,GPUサーバー}      要素数 2
Slack            🔵 代理店候補の問い合わせが入りました
                 区分: 代理店候補
                 興味商材: 外貨両替機 / GPUサーバー
```

**判定のしかた**（次に確認するときも同じ）:

| 見るところ | 正常 | 異常 |
|---|---|---|
| タイトル | 🔵 代理店候補 | 🔴 直客（＝`customerType` が来ていない） |
| 興味商材の区切り | `/`（配列で届いた） | `,`（1文字列に潰れている） |

### この配線で見つけて直した欠陥

| 欠陥 | 影響 | 直した側 |
|---|---|---|
| `Lead.sessionId` の FK 違反で 500 | 問い合わせが丸ごと消える。例外なので無音 | MMS |
| 拒否・例外で通知が鳴らない | 消えたことに気づけない | MMS |
| CTA位置が null 化されて消滅 | 位置別の効き目が永久に出ない | MMS |
| 未知のCTA位置を黙って捨てる | 集計が静かに欠ける | MMS |
| `customer_type` が `interestProduct` に混入 | 代理店候補が営業に流れ、両方の歩留まりの分母が壊れる | cowork |
| `implode` で商材が1文字列化 | 商材別集計が壊れる | cowork |

### 相互に起きた「実装を読まずに仕様を書いた」ミス

| 誰 | 内容 |
|---|---|
| MMS側 | フォームの仕様書に `contactName` / `sourceType` / `sourceUrl` / `note` と書いて渡した。これは Prisma のカラム名で API の契約ではない。`route.ts` も `INTEGRATIONS.md` も読まず `schema.prisma` から書き起こしたため。cowork が実測で潰さなければ全件 400 のままだった |
| cowork側 | `Cta` に7行登録すれば `ctaId` が繋がると提案した。`Cta.id` は cuid・`contentItemId` 必須で "hero" は存在しえない。MMS が実装を読んで指摘 |

**合意**: ドキュメントより実装、推測より実測。

---

## A-1 スケジュール停止の原因と再発防止 — ✅ 対応済み

> 以下は調査記録。同じことが再発したときの調べ方として残す。

### 原因：アプリの不具合ではなく、UIからの手動無効化

`~/Library/Logs/Claude/main3.log` に記録が残っていた。

```
2026-07-13 12:20:59〜12:21:30 の31秒間に12件を順次 disabled
  CoworkScheduledTasksApi.updateScheduledTaskStatus（UIからの操作API）
  間隔は1〜6秒とばらつく（自動処理なら同一秒に集中する）
  12:21:29 gsc-weekly-fetch を Enabled → 12:21:30 Disabled（押し間違いの訂正）
```

### なぜ止めることになったか（直前11分）

```
12:07:55  [ScheduledTasks] Reset（アプリ再起動）
12:09:00  4本が同時起動 → global_limit (active=3, limit=3) で待ち
12:13:00  iriguchi がようやく起動（4分待ち）
12:13〜16 Not auto-approving "mcp__google-sheets__get_sheet_data"
          Not auto-approving "mcp__apple-events__reminders_tasks"
          → rule(s) not in stored approvals → 都度 decision=once で手動承認
12:20:59  全部無効化を開始
```

**MCPツールが承認リストに無く、動くたびに手動承認を求めていた。**

### enabled 状態の保存場所

```
~/Library/Application Support/Claude/local-agent-mode-sessions/
  97c32ace-…/66a9cc56-…/scheduled-tasks.json
```
`~/Documents/Claude/Scheduled/` には SKILL.md しか無く enabled は持たない。
だから「SKILL.md は残っているのに登録だけ消えた」ように見えた。

### 依頼（対応済み・2026-07-22）

1. 各タスクの `approvedPermissions` に不足MCPを追加（最低 `mcp__google-sheets` / `mcp__apple-events`）
2. cron をずらす（同時実行上限3本。現状 7:00 / 8:00 / 9:00 に集中）
3. そのうえで11本を再有効化

★threads の2本は 7/22 に作り直して有効化済み。触らないこと。

---

## 計測されていない送客を埋める（ゴールに直結）— ✅ 対応済み

MMS の「送客 × 受け皿」マトリクスは実測 **5/13**。
HP・メディア・記事からの送客がほぼ全部「未計測」で、
PV 4,556 があるのに**そこから何人がどの受け皿へ向かったかが分からない**。
増やす対象が測れていないので、増えたかどうかも判定できない。

### 1. サイトの `lin.ee` 生リンクを置換（3マスが埋まる）

```
変更前: https://lin.ee/5NVLBXA
変更後: https://collect.asset-support.co.jp/r/line/{設置場所}

{設置場所} は英数字と - _ のみ・40文字以内。設置箇所ごとに変える
例: site-header / site-footer / article-cta / article-inline
    contact-page / category-page
```
対象は `/media/` 9箇所・`/contact/` 7箇所ほか（テーマ全体）。

- MMS が設置場所別にクリックを記録する（どのCTAが効いたかが出る）
- utm と `?from=site` は MMS が自動付与。書かない
- クローラのプレビュー踏みは除外済み
- 遷移先は MMS 側で管理するので `lin.ee` を直接書く必要は無い

### 2. HPの問い合わせフォームを計測可能にする（3マスが埋まる）

MMS の受口 `/api/ingest/form` は稼働中。WordPress から呼ぶ。HMAC-SHA256 署名が要る。
あわせて段2ファネル（CTA表示 → CTAクリック → フォーム到達 → 送信）も計測する。

**1と2で 5/13 → 11/13 になる。**

---

## その他の依頼 — ✅ すべて対応済み

### 3. 代理店LP の `sessionStorage` → `localStorage` + Cookie（30〜90日）

LP訪問189のうち152（80%）がコード無しで、どの代理店の貢献か識別できていない。
配布済みコードのうち6件が7日以上流入なし。

### 4. 診断LPを1本（B・写真）に集約

石井さん判断。`lp-link-inject.py` の `ROTATION_JS` を廃し、既存記事のリンクを B に寄せる。
A-4 が直ったので集約後は送信が正しく計測される。
**「壊れていた期間」と「直った後」を混ぜないよう集約日を記録すること。**

あわせて記事側の導線も直す（LP到達率 0.42% < 目安 0.5%）。
LPを1本にしても記事から人が来なければ判定母数は増えない。

### 5. `lp-ab-weekly-report.py` を before/after 型 ＋ 経路分離に

1. パターン別の勝敗判定をやめ「LPを大きく変えた前後28日」の比較に
2. `pagePath` → `pagePathPlusQueryString`（`.split("?")[0]` を削除）
3. 記事→LP の CTR は `from=media-article` のみを分子に
4. `from=threads` / `from=site` を別行で出す（母数が違うので混ぜない）
5. 分母の記事PVを「LPリンクを持つ記事」に限定（現状 `/media/` 全部を合算しており、
   Threads送客が始まると分子だけ増えて CTR が実態以上に良く見える）

### 6. Threads の送客導線を SKILL.md に反映

cowork の提案どおり採用。

- 型: チェックリスト・結論ファースト・比較型の3つ
- 本数: 週88本のうち12本（3型 × 4本）
- 遷移先: `line` 6本 / `soken` 4本 / `lp` 2本
- A/B: 同一フォーマット内でリンク有無を混ぜる

```
article_link 列: https://collect.asset-support.co.jp/r/{soken|lp|line}/{THR-xxx}
utm・?from・LP振り分けは MMS が自動付与。書かない
```

★`line` 6本には計測上の限界がある。`lin.ee` へのリダイレクトまでは MMS が数えるが、
その先の友だち追加は測れない（LINE の follow イベントに経路情報が入らない。公式FAQに明記）。
「LINEに送った人数」までしか出ないので、友だち追加数と突き合わせて判断すること。

### 7. 片付け

- `weekly_*` 6指標は**廃止**（移管不要）。MMS の `evaluate.ts` は日次データから
  28日窓を直接計算しており、固定スナップショットを介さない
- `media.db` コンソールを畳む。`ingest.py` を `gsc-weekly-fetch` のステップ7.5 から外す。
  「記事別 日次推移」は作らない判断で合意済みなので残る差分は無い

---

## MMS が cowork の出力に依存している箇所

パスやフォーマットを変えるときは事前に知らせてほしい。

| MMS のジョブ | 読んでいるもの | 実行 |
|---|---|---|
| dm-log-import-daily | `.../agency-recruitment/dm-log.md` | 毎日10:00 |
| rakko-import-daily | `shared/keywords/rakko-exports/<YYYY-MM>/` | 毎日05:00 |
| agency-lp-import-daily | `tools/media-console/agency_lp_sources.json` → 各LPの export.php | 毎日07:15 |
| threads-sync-daily | Threads GAS Web App | 毎日06:30 |
| queue-refill-daily | Threads GAS のシート（draft → pending） | 毎日05:00 |

**`dm-log.md` は MMS の唯一のDM情報源。** 列順と判定4語
（有効 / 有効候補 / 保留 / 無効）を変えないこと。

### DM の種別（2026-07-23・cowork の指摘で修正）

`dm_log_import.py` は `Lead.type` を `agency` に決め打ちし、`AgencyLead` にも
無条件で起票していた。集客投稿から来たDMを同じファイルに書くと、
**見込み客が代理店候補として起票され、代理店の歩留まりの分母が壊れる**。

列は増やさず、**「反応元」列（3列目）の先頭**で分別する:

| 反応元の書き方 | MMS の扱い |
|---|---|
| `A12(...) への返信` / `代理店DMリクエスト（プロフ経由）` | `Lead.type=agency` ＋ `AgencyLead` に起票 |
| `集客投稿(THR-151)` / `集客(プロフ経由)` | `Lead.type=direct_inquiry`・**`AgencyLead` には起票しない** |

計測開始の指標も2つに分けた:

- `lead_threads_dm` … 受け皿「Threads DM」（代理店・見込み客の両方）
- `lead_agency` … 代理店リード（代理店パイプラインの分母）

---

## MMS 側で対応済み（依頼不要）

| 元の課題 | 対応 |
|---|---|
| PV が7/13で停止 | MMS が GA4 を直接読む（毎日07:30）。Notion経由をやめた |
| GA4ファネルの受け渡し | 同上で不要 |
| intervention の二重管理 | MMS を正とし、記録の入口も `/experiments` に移した |
| 代理店LPのデータ | MMS が export.php を直接取得（PIIは保存しない） |
| 診断LPの成約接続 | `/lp` を 記事PV→到達→送信→問い合わせ→成約 の5段に |
| 代理店の画面分散 | `/agency` に統合（DM ／ 代理店LP の2階段） |
