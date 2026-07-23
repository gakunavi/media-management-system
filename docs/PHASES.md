# MMS 実装ロードマップ（PHASES）

> 抽出元: `docs/DESIGN.md` §9（実装ロードマップ 統合版・★設計書における唯一の正）
> 補助: §1.1（成功条件・撤退条件）／§9.3（マイルストーン）／§9.4（モデル振り分け）／§9.5（依存関係の注意）
>
> **★このファイルが Phase 定義の唯一の正。** 以降の実装セッションは設計書ではなくこのファイルを読む。
> **★ロードマップ表はこのファイルと設計書 §9 にしか存在してはならない**（`docs/check-consistency.sh` が検査）。

---

## 0. 読み方

| 列 | 意味 |
|---|---|
| **#** | 設計書 §9.1 の行番号（1〜59）。着手順ではない |
| **Phase** | Phase ID。依存関係の参照キー |
| **内容** | 設計書 §9.1 の記述（原文を保つ） |
| **依存** | 先行 Phase。`—` は依存なし |
| **見積** | 人日（設計書 §9.1） |
| **担当モデル** | `prisma/schema.prisma` のうち、その Phase で作成・変更する model |
| **完了条件** | ★設計書に明記が無いため P0-a で導出（§13-U01 参照）。**受け入れ判定に使う** |
| **使用モデル** | 設計書 §9.4 の振り分け。`—` は §9.4 に記載が無い（§13-U02 参照） |

**着手順は「#」ではなく「依存」に従う。** §9.5 の注意を必ず守る。

---

## 1. 全Phase（59行）

### 【S0 基盤】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 1 | **P0-a** | 設計書 全文を読み、実装仕様を抽出（`schema.prisma` / `PHASES.md` / `RULES.md` / `GLOSSARY.md` / `check-consistency.sh`）※**全文読込必須** | — | 1 | 全82model（定義のみ・DB未作成） | 5ファイルが存在し `check-consistency.sh` が全項目 pass。§13 未解決リストが提出されている | **Opus** |
| 2 | **P0** | Docker Compose（web/db/worker）＋Next.js 15＋Prisma＋Auth.js＋launchd常駐 | P0-a | 1.5 | 全82model（`prisma migrate` で実DB作成） | `docker compose up` で web/db/worker が起動し、Mac再起動後も launchd で自動復帰。`localhost:3000` にログインできる | **Opus**（§9.4.1）／**Fable 5**（§9.4.4）★重複記載・§13-U03 |
| 3 | **P1** | 既存データ移行（media.db / timeseries.db → Postgres）＋worker が既存Pythonを呼べる | P0 | 1 | ContentItem / ContentMetric / KeywordRanking / InternalLink / Intervention / Job / JobRun | media.db・timeseries.db の全行が Postgres に入り件数が一致。worker から既存 `.claude/scripts/` が改変なしで実行できる | Sonnet |
| 4 | **P1.5** | **Notion 全DB移行**（記事/AIO/ネタ/リール・プロパティ全件・§7）＋並行稼働突合 | P1 | 1 | ContentItem / ContentMetric / Idea | §7.1〜7.3 の全プロパティが移行済み。**1週間の並行稼働で突合差分ゼロ** |Sonnet |

### 【S1 計測 — ここが無いと全部が推測になる】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 5 | **P2** | **CV配管**（`Lead` ＋ `/api/ingest/*` ＋ WPフォームWebhook ＋ 即時通知） | P0 | 1 | Lead / MeasurementCoverage | WPフォーム送信が HMAC 検証を通って `Lead` になり、石井さんに即時通知が届く。`MeasurementCoverage` に計測開始日が入る | Sonnet |
| 6 | **P2.5** | **ファネル7段**（`VisitorSession` / `FunnelEvent` ＋計測タグ）＋A/B群割当モデル＋**計測タグ設計原則§3.10.3＋ingestレート制限** | P2 | 2.0 | VisitorSession / FunnelEvent / Experimentation / Variant | 7段全ての `FunnelEvent` が記録される。`docs/RULES.md` §1 の7原則を全て満たす。同一セッションから毎分N件超で 429 を返す | Sonnet |
| 7 | **P2.6** | `Lead` 属性・興味・比較対象・経路・初動速度 ＋ フォーム項目設計 | P2 | 1 | Lead | `Lead` に属性/興味/`competitorsConsidered`/first・lastTouch/`firstResponseAt` が入る。**直客2件を遡及入力済み**（§14 前提の更新） | Sonnet |
| 8 | **P2.7** | **初動自動対応**（起票→通知→自動返信→興味推定→返信ドラフト） | P2.6 | 1 | Lead / VisitorSession / Action | §5.4 の6ステップが自動で走り、返信ドラフトが段5に並ぶ。**氏名・連絡先はLLMに渡らない**（§16.2） | — |

### 【S2 可視化】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 9 | **P3** | **ダッシュボード 段1〜段3・段7**（結果／ファネル／買い手の質／ジョブ健全性） | P2.5 | 2 | Target / MetricSnapshot / MeasurementCoverage / FunnelEvent / ContentItem / JobRun | 段1〜3・段7 が表示される。**未計測の指標が "—(未計測)" と表示され 0 と書かれていない**（§3 規約） | Sonnet |
| 10 | **P3.5** | **鮮度管理**（`freshnessTier` / `nextReviewDue` / `ArticleReview` ＋ overdue初回スキャン・§7.5） | P1.5 | 1 | ContentItem / FreshnessRule / ArticleReview | 全記事に `freshnessTier` が付き `nextReviewDue` が自動算出される。**初回スキャンで overdue 一覧が出る** | — |
| 11 | **P3.7** | `UnitEconomics` ＋ **広告シミュレーター**（順算/逆算・3シナリオ） | P2.6 | 1.5 | UnitEconomics / AdSimulation | 上限CPA が算出され、順算・逆算の両モードが3シナリオで動く。**前提が実測かベンチマークかが `assumptionSource` に必ず入る** | **Opus** |

### 【S3 自動運営・PDCA】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 12 | **P4** | **operator 週次**（段4変化・段5立案）＋承認/却下 Server Action ＋ `Intervention` 自動記録 | P3 | 2 | Action / ActionEvent / Intervention / Experiment / Learning | §5.2 の入力7種から `Action` が起票され、承認すると `Intervention` が自動生成され**判定日が予約される** | **Opus** |
| 13 | **P4.5** | `Keyword` 群（マスタ/研究/割当/順位）＋既存YAML・CSV移行 ＋ `/keywords` | P1 | 2 | Keyword / KeywordResearch / KeywordAssignment / KeywordRanking | §13.6 の6資産が全て移行済み。`/keywords` で「KW/狙い/割当記事/現在順位/前週差/次の一手」が1行で並ぶ | Sonnet |
| 14 | **P4.6** | `Idea` ＋ **5供給源の自動起票** ＋ `/ideas` | P4.5 | 1.5 | Idea | §13.4 の供給源から `Idea` が自動起票される。**`impacts` が空の Idea は API で弾かれる**（§5.5） | Sonnet |
| 15 | **P4.7** | 鮮度アラート・カニバリ検出・striking distance の Action 自動起票 | P4.5 | 0.5 | Keyword / KeywordRanking / KeywordAssignment / ContentItem / Action | 11〜20位KWが日次抽出され段5に起票。`KeywordAssignment` の main 重複がDB制約で検出される | **Opus** |
| 16 | **P4.3** | **トピッククラスタ**（`TopicCluster` / `ContentCluster` / `InternalLink` / `ClusterMetric`）＋既存157記事の自動割当＋599リンク正規化＋**構造欠陥の初回スキャン**＋`/clusters` ツリー | P4.5 | 2 | TopicCluster / ContentCluster / InternalLink / ClusterMetric | 157記事が割当済み・599リンクが正規化済み。**「ピラー不在」「thin」「リンク不備」「孤児」の一覧が出る**。`/clusters` がツリー表示される | Sonnet |
| 17 | **P4.9** | `budgetTier` / `funnelStage` / `productFit` の一括タグ付け（既存157記事＋KW・AI補助） | P4.5 | 1 | ContentItem / Keyword | 157記事＋追跡KW の3軸が全て埋まる。**ルール＋一括処理＋人の承認**で行う（1本ずつAI判定しない・§9.4.2 注意） | Sonnet |
| 18 | **P4.10** | `KeywordVolume` / `KeywordCluster` / **`CtrCurve`（自社実測CTR曲線）** | P4.5 | 1 | KeywordVolume / KeywordCluster / CtrCurve | 月次ボリュームが履歴保存される。**自社GSC実測から順位別CTR曲線が算出される**（外部一般値を使わない） | — |

### 【S4 チャネル拡張】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 19 | **P5** | Threads / AIO 配管（GAS→ingest、aio-batch→jobs） | P1 | 1 | Channel / ContentItem / ContentMetric / Job / JobRun | Threads GAS の Insights が `/api/ingest/threads` へ届く。aio-batch が jobs から自動実行される（時間制限なし） | Sonnet |
| 20 | **P5.6** | `AgencyLead` / `Partner`（DM triage のDB化・GAS連携） | P5 | 1 | AgencyLead / Partner | 投稿→DM→有効→契約の歩留まりが算出できる。**代理店募集投稿1本あたりの有効DM数**が出る | Sonnet |
| 21 | **P5.7** | `LineFriend` / `LineMessage`（LINE Messaging API連携） | P2 | 1 | LineFriend / LineMessage | 友だち追加が Webhook で即時記録され、記事別に登録経路が分離される | Sonnet |

### 【S5 市場・競合・広告】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 22 | **P6.7** | `SerpSnapshot`（DataForSEO 週次・AIO有無含む）／`Competitor` | P4.10 | 1 | SerpSnapshot / Competitor / CompetitorMetric | 追跡KWの1〜20位が週次保存され、`hasAiOverview` / `aioCitedDomains` が入る | Sonnet |
| 23 | **P6.8** | `MarketShare` / `Opportunity` の自動算出 ＋ `/market` | P6.7 | 1.5 | MarketShare / Opportunity | 表示/クリックシェア・Top3/10/20率・機会損失ランキングが出る。**`Opportunity` が `budgetTier` で重み付けされている**（§3.3.4） | **Opus** |
| 24 | **P7.5** | 広告 API 連携（`AdAccount`〜`AdMetricDaily`・gclidでLead突合） | P3.7 | 1.5 | AdAccount / AdCampaign / AdGroup / AdCreative / AdMetricDaily | 日次実績が自動取得され、**gclid/utm で `Lead` と突合**される（媒体の自己申告に依存しない） | Sonnet |
| 25 | **P7.6** | CPA判定・停止/増額の自動起票 ＋ SEO vs 広告比較 | P7.5 | 0.5 | AdMetricDaily / UnitEconomics / Opportunity / Action | 上限CPA超過で「停止/減額提案」、下回れば「増額提案」が段5に自動起票される | — |

### 【S6 完成】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 26 | **P7** | `/content` 移植（console.html の5タブ）→ console.html 退役 | P3 | 2 | ContentItem / ContentMetric / Cta | 5タブが React で動き、**console.html が退役**している | Sonnet（§9.4.2）／**Fable 5**（§9.4.4） |
| 27 | **P8** | operator 日次・月次（異常検知→即応・施策の生死判定）＋ `/experiments` | P4 | 1.5 | Experiment / Action / Intervention / Learning / MetricSnapshot | 日次の異常検知が即応を起票し、月次で施策の継続/撤退が判定される。段6にカウントダウンが出る | Sonnet |
| 28 | **P6** | Notion 停止（`notion-sync.py` 削除・CLAUDE.md 修正） | P1.5 | 0.5 | —（コード・運用のみ） | `notion-sync.py` / `notion-sync-aio.py` が削除され、CLAUDE.md 公開ゲートから Notion 同期が消えている。**Notion DB はアーカイブとして残す（削除しない）** | — |
| 29 | **P9** | Cloudflare Tunnel ＋ Access（スマホ閲覧） | P3 | 0.5 | —（インフラのみ） | スマホから Access のメール認証を経て閲覧できる。**素のトンネル公開になっていない** | — |

### 【S7 品質・法務・復旧 — §16 積み残し】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 30 | **P0.5** | 個人情報対応（ポリシー改定・`ConsentRecord` / `DataRetentionPolicy`）※**専門家確認は不要**（2026-07-20 石井確定・§9-D14） | — | 0.5 | ConsentRecord / DataRetentionPolicy | プライバシーポリシーに取得情報・利用目的・保存期間・開示請求窓口が明記されている。保存期間の自動削除ジョブが動く。★**第三者提供の同意チェックボックスは実装しない**（§16.2 石井確定）／★**専門家確認は行わない** | — |
| 31 | **P0.7** | バックアップ3箇所・`RECOVERY.md`・段7表示 | P0 | 0.5 | —（運用のみ） | ローカル30世代＋Time Machine＋Google Drive（週次）が動く。`RECOVERY.md` がある。段7に最終バックアップ日時と**最終リストア検証日**が出る | **Haiku** |
| 32 | **P1.7** | タイムゾーン正規化ルール ＋ `AuditLog` | P1 | 0.5 | AuditLog（全model の日時項目に規約適用） | 全ての日時が JST で保存される。GSC の PT→JST 変換ルールが実装され明文化されている | Sonnet |
| 33 | **P2.4** | **計測検証基盤**（合成モニタリング・突合・ボット除外・外れ値検知） | P2.5 | 1 | MonitorRun / DataQualityCheck / FunnelEvent | **日次で Playwright が巡回し期待する `FunnelEvent` の記録を検証**。不一致で段7が赤になる。GSC/GA4 との乖離±15%超で警告 | **Opus** |
| 34 | **P4.4** | `ContentVersion` ＋ ロールバック実行 | P4 | 0.5 | ContentVersion / Intervention | `Intervention` の前後バージョンが保存され、**ワンクリックで復元できる** | Sonnet |
| 35 | **P4.8** | 判定の信頼度（対照群最小基準・バッチ判定・inconclusive のUI表現） | P4 | 0.5 | Intervention | 対照群5記事以上かつ合計impressions 500以上を満たさなければ `inconclusive`。**UIで「効果なし」と区別して表示される** | **Opus** |

### 【S8 記事ライフサイクル — §3.6】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 36 | **P3.3** | **`IndexStatus`**（GSC URL Inspection API・未インデックス検知） | P1 | 0.5 | IndexStatus | 157本のインデックス状況が判明する。**未インデックス記事が段1に赤で出る**（公開直後は「インデックス待ち」として別扱い） | Sonnet |
| 37 | **P3.4** | `PageExperience`（CWV / PSI・モバイル別） | P1 | 0.5 | PageExperience | LCP/INP/CLS/TTFB がモバイル・デスクトップ別に取得される | Sonnet |
| 38 | **P4.2** | **`LeadTouchpoint`**（マルチタッチ・アシスト貢献） | P2.5 | 1 | LeadTouchpoint | CVした人が読んだ記事が全部残る。**last touch を主指標としつつアシスト貢献も併記**される | Sonnet |
| 39 | **P4.11** | `ProductionCost`（記事別ROI） | P4 | 0.5 | ProductionCost / JobRun | 記事別ROI＝リード貢献額÷制作コストが出る。**AIトークンは `JobRun.metrics` から自動集計・作業時間は滞在時間から自動推定**（手入力を強要しない） | Sonnet |
| 40 | **P5.8** | `trafficSource` / `aiEngine` 判別（AI検索流入） | P2.5 | 0.5 | VisitorSession | ChatGPT/Perplexity/Copilot/Gemini からの流入が referrer で判別される。**AIO引用率（先行指標）とAI流入（結果指標）が並べて見られる** | — |
| 41 | **P6.9** | **`Backlink` / `DomainAuthority`**（DataForSEO・自社＋競合） | P6.7 | 1 | Backlink / DomainAuthority | 自社と競合の参照ドメイン数が月次取得される。**「1〜3位が0本」の原因が権威不足かどうか判定できる** | Sonnet |
| 42 | **P8.2** | `ContentLifecycle` / `UrlRedirect` ＋ プルーニング自動起票 | P4.3 | 1 | ContentLifecycle / UrlRedirect | §3.6.7 の4条件でプルーニング提案が段5に自動起票される。**URL変更・削除時に `UrlRedirect` が必ず作られる（404を出さない）** | Sonnet |

### 【S9 検証手法 — §3.7】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 43 | **P2.8** | **Microsoft Clarity 導入**（タグ設置＋フォームマスキング） | — | 0.1 | —（外部サービス・MMSに統合しない） | Clarity が録画・ヒートマップを取得している。**全フォーム項目に `data-clarity-mask` が付いており氏名/電話/メールが録画に残らない** | **Haiku** |
| 44 | **P4.12** | **SEOスプリットテスト**（層別ランダム化・判定・主判定手法） | P4.3 | 0.5 | SplitTest / SplitAssignment | クラスタ×順位帯×funnelStage で層別ランダム化される。**最小サンプル基準未達なら結論を出さず `inconclusive`** | **Opus** |
| 45 | **P7.7** | LP/CTA A/Bテスト（サンプル数計算・underpowered拒否） | P2.5 | 1 | Experimentation / Variant / VisitorSession | 開始時に必要サンプル数を自動計算し、**到達見込み3ヶ月超なら `underpowered` として起動を拒否**する | — |

### 【S10 運用・業務・外部環境 — §3.8】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 46 | **P2.9** | `LandingPage` / `LpVersion` ＋ 既存LP投入 | P2.5 | 0.5 | LandingPage / LpVersion | PRJ-029（診断LP）・PRJ-034（代理店LP）が初期データとして入り、バージョン管理される | Sonnet |
| 47 | **P2.10** | 電話CTAクリック計測 ＋ `/leads` 手動登録UI ＋ `sourceType` | P2.6 | 0.3 | FunnelEvent / Lead | `tel:` クリックが `FunnelEvent(step=phone_click)` になる。`/leads` の「電話から登録」が**3項目のみ**で入力でき `sourceType=phone_manual` が入る | **Haiku** |
| 48 | **P3.8** | `RegulatoryEvent`（税制改正カレンダー）＋60日前の自動起票 | P1 | 0.5 | RegulatoryEvent / Action / ContentItem | 期日の60日前に「記事準備」Action が自動起票される。適用期限が近い制度の記事が一括で `overdue` になる | — |
| 49 | **P4.13** | `SeasonalityIndex`（季節調整）＋段1・段4への併記 | P4.10 | 0.5 | SeasonalityIndex | 段1・段4の前月比・前週比に**季節調整値が併記される**（「-7.8%だが季節調整後は+2.1%」） | **Opus** |
| 50 | **P5.9** | `SnsAccountHealth` / `PostSchedule` / `CrossPromotion` | P5 | 1 | SnsAccountHealth / PostSchedule / CrossPromotion | **`viewsPerFollower` の急落が段1で検知される**。トークン残日数が段7に出る。記事↔投稿の相互送客が計測される | Sonnet |
| 51 | **P6.10** | **m2連携**（`Lead` ⇄ m2 Deal・成約結果の還流）※**m2 は無改修**（§9-D13） | P2.6 | 1 | Lead | `Lead.m2DealId` で突合し、成約額・成約日が MMS に還流して記事別・クラスタ別ROIが出る。★**商談プロセスは MMS に作らない**／★**m2 側にスキーマ追加をしない**（紐付けの正は MMS 側） | Sonnet |

### 【S11 実運用・品質・信頼性 — §3.9】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 52 | **P1.8** | **WP書き込みのMMS一本化**（`wp-publish.py` API化）＋日次ハッシュ突合 | P1 | 1 | ContentItem / ContentVersion | **WP への書き込み経路が `/api/wp/publish` の1本になっている**。日次ハッシュ突合で差分検出時のみ段7に出る | Sonnet |
| 53 | **P3.9** | `UptimeCheck`（5分間隔・フォーム含む） | P0 | 0.3 | UptimeCheck | トップ・代表記事・LP・**フォーム送信エンドポイント**を5分間隔で監視。連続3回失敗で即通知 | Sonnet |
| 54 | **P4.14** | `GenerationProvenance`（スキル/モデルのバージョン記録） | P4 | 0.3 | GenerationProvenance | 記事の成績をスキルバージョン別・モデル別に比較できる | Sonnet |
| 55 | **P6.11** | `LinkCheck`（週次・tier1優先） | P4.3 | 0.5 | LinkCheck / InternalLink | 500本超の外部リンクが週次検査される。**tier1 出典の404が最優先で段5に起票**される | Sonnet |
| 56 | **P8.3** | `BrandMention`（レピュテーション監視） | P5 | 0.5 | BrandMention | 自社名・メディア名・商材名の言及が週次で検索される。**negative は即通知（AIは自動返信しない）** | Sonnet |

### 【S12 性能事故の再発防止 — §3.10】

| # | Phase | 内容 | 依存 | 見積 | 担当モデル | 完了条件 | 使用モデル |
|---|---|---|---|---:|---|---|---|
| 57 | **P1.9** | `PerfGate`（デプロイ前後PSI計測・劣化でブロック） | P0 | 0.5 | PerfGate | デプロイ前後で PSI を測り、**TTFB 20%以上悪化 or LCP 0.5秒以上悪化でデプロイを失敗扱い**にして段7に赤 | Sonnet |
| 58 | **P2.11** | **`TelemetryVolume`（発火回数監視）＋閾値アラート＋ワンクリック停止** | P2.5 | 0.5 | TelemetryVolume | `eventsPerSession` の閾値（30=黄 / 50=赤）で段7に出る。**前日比3倍で計測タグのワンクリック停止 Action が段5に出る** | Sonnet |
| 59 | **P3.10** | `Incident` ＋ 過去5件の登録 | P0 | 0.3 | Incident | §3.10.6 の過去5件が登録され、各々に再発防止策と実装済みチェックが付いている | **Haiku** |

**合計: 約52.5日**（設計書 §9.1）

---

## 2. スコープ外（将来・§9.2）

| Phase | 内容 | 条件 |
|---|---|---|
| P10-a/b/c | コンテンツ販売事業・新Threadsアカウント・`PostPattern` 横断化 | 石井が新アカウント開始を決めたら |
| P5.5 | `Channel(type=note)` ＋ 月次手入力（note公式APIなし・§11.2） | note 開始時 |

> §11.2 の確定事項: **note には公式APIが無い**（2026-07時点）。非公式APIのスクレイピングは**採用しない**（規約グレー・2026年に2度塞がれた・BANは事業の即死）。`Channel(type=note)` は**手動入力チャネル**として定義し、未入力なら段1の信号を黄色にする。

---

## 3. マイルストーン（§9.3）

| 区切り | 到達点 | 累計 |
|---|---|---|
| **M-A: P0-a〜P2.11（＋P1.8/P1.9/P3.9/P3.10）** | **計測が始まり、正しいと保証され、暴走しない。** 実装仕様の抽出／Clarity／LP管理／電話／WP一本化／死活監視／**発火回数監視・性能ゲート** | **15.0日** |
| **M-B: 〜P3.7（＋P3.3/P3.4）** | **見える化が完成。** 獲得3ゴール・ファネル・買い手の質・鮮度・**インデックス状況**・ページ体験・広告試算 | **15.5日** |
| **M-C: 〜P4.11** | **PDCAが回る。** 承認→実行→対照群補正つきで自動判定。**アシスト貢献で記事評価が正しくなる**。クラスタ単位で母数が足りる | **27日** |
| **M-D: 〜P7.6（＋P6.9）** | **市場・競合・被リンク・広告が見える。** 「1〜3位が0本」の原因が特定できる | **36日** |
| **M-E: 全完了** | Notion廃止・console退役・スマホ閲覧・プルーニング・A/B・m2連携・品質監視 | **52.5日** |

> **★M-A に P2.4（計測検証）を必ず含める。** 計測が正しいと保証されない状態で以降を積み上げると、全部が砂上の楼閣になる。
> **★推奨: M-A で一度止めて実際に使う。** 計測が始まればデータが溜まり始め、以降の設計判断が実測ベースになる。
>
> ★M-A の所要日数は **15.0日 に統一済み**（§9-D10。設計書 §1.1・§9.3 も修正済み）。

---

## 4. 依存関係の注意（§9.5）

- **P2（CV配管）が全ての起点。** ここが無いと `Lead` も `Intervention` も評価できない
- **P4.5（Keyword群）は P4.6〜P4.10 の前提。** 先に片付ける
- P3.7（広告シミュレーター）は**広告を回さなくても価値がある**（SEO投資判断の基準線になる）

---

## 5. ★このシステム自体の成功条件と撤退条件（§1.1・要 石井合意）

> 施策には撤退条件を必須にしておきながら、47日かけるこのシステム自体に成功条件も撤退条件も置いていなかった。ここで定義する。

### 仮説

> 獲得3ゴール（直客・代理店・LINE）が伸びない原因は「何が効いているか見えないこと」であり、
> 計測とPDCAの自動化により、**同じ稼働で獲得件数が増える**。

### 成功指標（M-A 到達＝**15.0日** 後の30日間で判定）

> ★日数は **§9.3 の 15.0日 が正**（§9-D10 の決定。設計書側も修正済み）

| # | 指標 | 目標 | 測り方 |
|---|---|---|---|
| 1 | **問い合わせの経路特定率** | **100%** | 全リードに `firstTouchContentId` または `sourceType=phone_manual` が入っている |
| 2 | **リード数** | **月2件以上** | `Lead(type=direct_inquiry)` |
| 3 | **石井さんのコマンド実行回数** | **0回** | リマインダー方式のタスクが全て自動実行されている |
| 4 | 石井さんの「見えている」実感 | 主観でよい | 週1回以上ダッシュボードを開いているか（アクセスログ） |

### 判定と撤退条件

| 状況 | 判断 |
|---|---|
| 4つ中3つ以上達成 | **継続**。M-B以降へ進む |
| **2つ以上未達** | **以降のPhaseを止めて設計を見直す**（作り続けない） |
| 指標1が未達（経路が特定できない） | **最も重い失敗**。計測設計そのものが誤っている → M-A をやり直す |
| 指標2が未達だが1・3は達成 | システムは機能している。**問題は集客側** → MMSは継続し、打ち手を流入・転換に集中 |

**中間チェックポイント**: M-A の各Phase完了時に「予定日数を1.5倍超過していないか」を確認。超過していれば**その時点で残りのスコープを削る**。

> **止める勇気を先に決めておく。** 作り込むほど止めにくくなるため、着手前に基準を置く。

---

## 6. モデル振り分けとトークン戦略（§9.4）

> 原則は CLAUDE.md §8（判断・戦略・執筆=Opus / 定型処理・検証=Sonnet / 軽作業=Haiku）を踏襲。
> **判断を誤ると全体が壊れる箇所だけ Opus。実装の主力は Sonnet。**

### 6.1 Opus（判断・設計の中核 — 約2割）

P0（Prisma初期スキーマ確定）／P2.4（計測検証基盤）／P3.7（UnitEconomics・広告シミュレーター）／P4（operator週次 立案ロジック）／P4.7（鮮度・カニバリ・striking distance の判定）／P4.8（判定の信頼度）／P4.12（SEOスプリットテスト 層別ランダム化）／P4.13（季節調整）／P6.8（MarketShare / Opportunity 算出）

### 6.2 Sonnet（実装の主力 — 約6割）

- **API・CRUD・Webhook**: P1, P1.5, P1.7, P1.8, P2, P2.5, P2.6, P2.9, P5, P5.6, P5.7, P6.10
- **画面実装**: P3, P4.5, P4.6, P6.8（描画部）, P7
- **外部API連携**: P6.7, P7.5, P3.3, P3.4, P6.9
- **移行スクリプト**: P1, P4.3, P4.5, P4.9
- **監視系**: P1.9, P2.11, P3.9, P6.11, P8.3
- **PDCA周辺**: P4.2, P4.4, P4.14, P8, P8.2

> **★注意**: 移行スクリプト（P4.3のクラスタ自動割当・P4.9のタグ付け）は「**Sonnetがスクリプトを書いて実行**」する。157記事をAIが1本ずつ判定するのではなく、**ルール＋一括処理＋人の承認**にする。ここを取り違えるとトークンを数十倍消費する。

### 6.3 Haiku（軽作業 — 約2割）

P2.8（Clarityタグ設置）／P2.10（電話CTA計測＋手動登録UI）／P3.10（Incident 過去5件の登録）／P0.7（`RECOVERY.md`・バックアップスクリプト）／定型テスト生成・ドキュメント整形・seedデータ作成

### 6.4 Fable 5（長時間自律 — 選択的に2箇所のみ）

P0（Docker Compose + Next.js + Prisma + Auth.js + launchd を一気に立ち上げる）／P7（`/content` 移植・画面が大きい）

> **それ以外では使わない。** 単発の実装は Sonnet で十分。

### 6.5 ★コンテキスト戦略（§9.4.5）

> **原則: 正確さ > 効率。効率化は、正確さを落とさない方法でのみ行う。**

**❌ やってはいけない**: 設計書の一部だけを読んで実装する／「たぶんこういう定義だろう」で書く／他セクションとの整合を確認せずに追記する

**✅ 正しいアプローチ**: 設計書（2,757行）は**人が合意するための文書**であり、実装の入力に直接使わない。P0-a で**一度だけ全文を読み、機械可読な実装仕様に落とす**。以降はその抽出物が正。

| 成果物 | 誰が読むか |
|---|---|
| `prisma/schema.prisma`（82モデルの完全定義・**唯一の正**） | 全Phase |
| `docs/PHASES.md`（本ファイル） | 全Phase |
| `docs/RULES.md`（実装規約） | 全Phase |
| `docs/GLOSSARY.md`（用語と取りうる値） | 全Phase |
| `docs/DESIGN.md`（判断の背景・却下した案・数値の根拠） | **レビュー時・設計変更時に全文** |

**効率化のルール（正確さを損なわない範囲）**

| # | ルール |
|---|---|
| ① | **1セッション = 1Phase**（節約が目的ではなく、混線による事故を防ぐのが目的） |
| ② | 既存Python資産は読まない（worker から**呼ぶだけ**で中身に依存しない設計＝疎結合） |
| ③ | 触るファイルを事前に明示（探索的に大量のファイルを読ませない） |
| ④ | 小さく作って確認 |
| ⑤ | lint・型チェック・テスト実行は Haiku ※ただし「**設計との整合の判断**」は Sonnet 以上 |

---

## 7. 追加したインデックスの一覧（設計書に無いが追加した分）

> P0-a の指示「日次クエリで必要なインデックスを追加し、追加分は明記する」に基づく。
> **フィールド・モデルは一切追加していない。** 追加したのは索引と、冪等性のための一意制約のみ。

### 7.1 追加した @@unique（★挙動に影響するため要確認）

| model | 制約 | 理由 |
|---|---|---|
| `ContentMetric` | `@@unique([contentItemId, metric, date])` | §3.2.2 の**欠測の自動補填（backfill）**を冪等にする。無いと再実行で日次行が重複する |
| `KeywordRanking` | `@@unique([keywordId, date])` | 同上 |
| `ClusterMetric` | `@@unique([clusterId, date, granularity])` | 同上（日次バッチ） |
| `Channel` | `@@unique([businessId, type, accountRef])` | §11.3 の**投稿誤爆の構造的防止**。同一アカウントの二重登録を禁じる |
| `ContentItem` | `@@unique([channelId, externalId])` | ART-XXX / THR-XXX の重複投入防止（移行時に必須） |
| `Target` | `@@unique([businessId, period, metric])` | 同一期間・同一指標の目標二重登録を防ぐ |
| `Keyword` | `@@unique([businessId, keyword])` | KWマスタの重複防止（§13.6 の6資産統合時に必須） |
| `Business` / `Job` / `Competitor` / `LineFriend` / `UrlRedirect` / `PostPattern` / `DataRetentionPolicy` / `FreshnessRule` | 各 `@unique`（slug / name / domain / lineUserId / fromPath / entity / freshnessTier） | 自然キーの重複防止 |
| `KeywordCluster` / `TopicCluster` / `LandingPage` | `@@unique([businessId, name])` ほか | 同上 |
| 外部ID系（`AdAccount` / `AdCampaign` / `AdGroup` / `AdCreative`） | `@@unique([親, externalId])` | 媒体APIの日次取得を冪等にする |
| `SplitAssignment` / `Variant` / `LpVersion` / `ContentVersion` / `LeadTouchpoint` / `PageExperience` / `SnsAccountHealth` / `PostSchedule` / `CrossPromotion` / `TelemetryVolume` / `PerfGate` / `DomainAuthority` / `Backlink` / `InternalLink` / `LinkCheck` / `SeasonalityIndex` / `CtrCurve` / `CompetitorMetric` / `MarketShare` / `Opportunity` / `UnitEconomics` / `ContentCluster` | 各 `@@unique` | 同一対象・同一時点の二重記録防止 |

### 7.2 追加した @@index

| 目的 | 対象（抜粋） |
|---|---|
| **段1〜段3の日次描画** | `MetricSnapshot([businessId, metric, date])` / `ContentMetric([contentItemId, metric, date])` / `FunnelEvent([step, occurredAt])` |
| **段5「次の一手」のソート** | `Action([businessId, state])` / `Action([type])` / `Idea([estValue])` / `Opportunity([month, priorityScore])` |
| **段6「施策の生死」** | `Experiment([evaluateAt])` / `Action([expiresAt])` |
| **段7「ジョブ健全性」・欠測検知** | `JobRun([jobId, startedAt])` / `JobRun([status])` / `UptimeCheck([ok])` / `TelemetryVolume([anomaly])` / `MonitorRun([runAt, passed])` |
| **鮮度スキャン（§7.5.2 日次ジョブ）** | `ContentItem([reviewState, nextReviewDue])` / `KeywordResearch([expiresAt])` |
| **買い手軸の集計（§14.1）** | `ContentItem([budgetTier, funnelStage])` / `Keyword([budgetTier, funnelStage])` |
| **striking distance 抽出（日次）** | `KeywordRanking([position])` / `KeywordRanking([keywordId, date])` |
| **アトリビューション逆引き** | `Lead([firstTouchContentId])` / `Lead([lastTouchContentId])` / `LeadTouchpoint([contentItemId, role])` |
| **m2 連携の突合** | `Lead([m2DealId])` |
| **競合比較（§3.3.5）** | `SerpSnapshot([date, domain])` / `SerpSnapshot([isOurs])` |
| **クラスタ構造欠陥スキャン** | `TopicCluster([state])` / `ContentCluster([clusterId, role])` / `InternalLink([linkType])` |
| **監査（§16.2）** | `AuditLog([entity, entityId, at])` / `AuditLog([actorType, at])` |

---

## 8. §13 未解決リスト — 設計書内で見つけた矛盾・曖昧・不足

> 各項目に「設計書の該当箇所」と「なぜ判断できないか」を添える。
> ★このうち **8.1 の6件は §9 の決定で解決済み**（2026-07-20 石井「あなたの判断で推進して」による委任）。
> **8.2〜8.5 は未解決のまま。** 石井さんの判断が必要。

### 8.1 実装をブロックしうるもの（★優先）→ **全て §9 で決定済み**

| ID | 該当箇所 | 内容 | 状態 |
|---|---|---|---|
| **U05** | §5.2 / §14.8 | `CompetitorSnapshot` が参照されるが **§3 に定義が無い** | ✅ **§9-D1 で決定**（実体は `SerpSnapshot`。設計書も修正済み） |
| **U06** | §16.5 | 「`Intervention` に `controlGroupSize`/`confidence`/`batchId` を追加（**§3反映済み前提**）」だが §3 に無い | ✅ **§9-D3 で決定**（3フィールド採用・`confidence` は3段階 enum） |
| **U07** | §11.4 | `PostPattern.metrics PatternMetric[]` の **`PatternMetric` が未定義** | ✅ **§9-D5 で決定**（P10-a スコープ外のため関連を持たせない） |
| **U08** | §3 `MarketShare` / §3.8.1 `SeasonalityIndex` | `clusterId` が `TopicCluster` / `KeywordCluster` のどちらか不明 | ✅ **§9-D2 で決定**（**KeywordCluster**） |
| **U09** | §3 `Experiment` | `Experiment.interventions` が張れない（`Intervention` に `experimentId` が無い） | ✅ **§9-D4 で決定**（Action 経由のみ） |
| **U10** | §3 `ContentItem.mainKeywordId` / `KeywordAssignment(role=main)` | **メインKWの正が2箇所** | ✅ **§9-D6 で決定**（正は `KeywordAssignment`・`mainKeywordId` は読み取り用キャッシュ） |

### 8.2 型・値域が確定できないもの

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U11** ✅§9-D12 | §3 全体 | **値の列挙が無い項目が26箇所ある** ため String のまま維持。**P1／P1.5 の移行完了後に実データを集計して enum 化する**（§9-D12） | 該当: `Business.status` / `Channel.type`(※`…`で打切) / `MetricSnapshot.granularity` / `MeasurementCoverage.method` / `ContentItem.type` / `.status` / `.category` / `.eyecatchType` / `.eyecatchColor` / `.targetLabel` / `.complianceVerdict` / `.factCheckVerdict` / `Lead.companyType` / `.urgency` / `Partner.status` / `LineFriend.status` / `LineMessage.kind` / `Keyword.intent` / `.priority` / `.status` / `Idea.state` / `Intervention.type` / `AdCampaign.objective` / `.status` / `AdCreative.status` / `Job.kind` / `JobRun.status` / `CrossPromotion.direction` / `DataQualityCheck.kind` / `.verdict` / `AuditLog.actorType`。**推測で enum を作ると後からマイグレーションが必要になる** |
| **U12** | §3 L207・L346・L379 ほか | **`month` の型が不明**（"YYYY-MM" 文字列か DateTime か） | `KeywordVolume` / `CompetitorMetric` / `MarketShare` / `Opportunity` / `UnitEconomics` は `month` としか書かれていない。一方 §3.8.1 `SeasonalityIndex.month` だけは `// 1-12` と明記され Int。暫定で前者を String("YYYY-MM")、後者を Int とした |
| **U13** | §3 L184-215 ほか | **Nullable の判断が付かない項目がある** | 「設計書で `?` が付いているものは Nullable」という指示だが、`ContentItem.url` / `.publishedAt` / `.infoBaseDate` / `.dataUpdatedAt` / `.lastReviewedAt` / `.nextReviewDue` は `?` が無い。しかし**下書き段階では論理的に値が存在しない**ため、必須にすると行を作れない。**Nullable にした（C-7）**。同様に `.category` / `.eyecatchType` / `.eyecatchColor` / `.targetLabel` / `.complianceVerdict` / `.factCheckVerdict` / `.validatorRun` / `.note` / `Lead.companyType` / `.urgency` / `Cta.variant` など |
| **U14** | §3 L1293-1300 `LandingPage.offer` | 値が **`無料相談 \| 資料DL \| 診断` と日本語** | Prisma の enum 値は識別子（英数字・アンダースコア）しか使えないため enum 化できない。String のままにした。英語識別子への読み替えが必要 |
| **U15** | §3 L374-377 `CtrCurve.segment` / §3.7.1 L1097 `SplitTest.changeType` / §3.9.5 L1405 `BrandMention.source` / §3 L158 `Channel.type` | **列挙が `…` で打ち切られている** | 「他に何があるか」が読み取れないため enum 化できず String のままにした |
| **U16** ✅§9-D11 | 全model | 作成・更新時刻を持つモデルがほぼ無かった | **解決: 全82モデルに `createdAt @default(now())` / `updatedAt @updatedAt` を一律付与した**（§9-D11） |

### 8.3 数値・Phase の食い違い

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U02** | §9.4 L1964-2012 | **§9.4 のモデル振り分けに載っていない Phase が9つある** | P0-a（※§9.1 の行内に「Opus」と記載あり）／P2.7 / P3.5 / P3.8 / P4.10 / P6 / P7.6 / P7.7 / P9 / P0.5。本ファイルでは `—` と記載した |
| **U03** | §9.4.1 L1970 vs §9.4.4 L2009 | **P0 が Opus と Fable 5 の両方に記載されている** | どちらで実施するか判断できない。加えて §9.4.1 は P0 を「Prisma 初期スキーマ確定」と説明するが、**スキーマ確定は P0-a の成果物**であり Phase の割当がずれている |
| **U04** ✅§9-D10 | §1.1 / §9.3 | **M-A の所要日数が4通り**だった: 「11.1日」「15.0日」「7日」「8日に修正」 | **解決: §9.3 の 15.0日 を正に統一**（設計書 §1.1・§9.3 も修正済み。成功指標の判定は「M-A 到達＝15.0日 後の30日間」） |
| **U17** | §3.3.8 / §3.4.9 / §3.6.9 / §3.7.4 / §3.8.7 / §3.9.7 / §3.10.7 / §16.7 | **全体見積の累計が節ごとに食い違う**: 34.5日（§16.7）→ 41.5日（§3.6.9）→ 43.5日（§3.7.4）→ 47.3日（§3.8.7）→ 49.9日（§3.9.7）→ 51.5日（§3.10.7）→ **52.5日（§9.1・正）** | 各節が追記時点の累計を書いており、統合後の §9.1 と一致しない。**§9.1 の 52.5日 を正として扱ったが、§16.7 の「全体 約34.5日」は明らかに古い** |
| **U18** | §9.4.5 L2036 | 「`docs/PHASES.md` … **58 Phase** の定義」とあるが、**§9.1 の表は 59 行**ある | 1つ多い／少ないのどちらが正か判断できない。本ファイルは §9.1 の 59 行をそのまま採用した |
| **U19** | §17 L2722 | 「P0〜P4（**コア7.5日**）で一度止め」とあるが、§9.1 で P0-a〜P4 を合計すると **13.5日** | 「コア」の範囲定義が不明。§9.3 の M-A（15.0日）とも一致しない |
| **U20** | §3.6.9 L1055 ほか | 各節の「追加N日 → 全体 約X日」の記載が §9.1 と接続しない | U17 と同根 |

### 8.4 定義・規約の食い違い

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U21** | 冒頭 L22 / §3.6〜§3.10 / §11.4 / §16 | 文書冒頭が「**モデル定義は §3 のみ**（他セクションは §3 を参照する。再掲しない）」と宣言しているが、**実際は §3 以外に 33 モデルが定義されている** | §3.6(8) / §3.7(4) / §3.8(7) / §3.9(4) / §3.10(3) / §11.4(1) / §16(6)。schema.prisma には全 82 を含めたが、**設計書側の「唯一の正」の宣言と実態が矛盾している** |
| **U22** | §4.1 L1607（段7=ジョブ健全性） vs §17 L2724-2725 | §4.1 は「段7 = ジョブ健全性（最終実行・失敗・APIトークン残日数・欠測アラート）」と定義するが、**§17 は「段6に最終実行時刻が出る」「トークン残日数を段6に常時表示」と書いている** | §4.1 では段6=施策の生死。**段番号の参照が矛盾している**（`check-consistency.sh` が検出） |
| **U23** | §3 L440 `Idea.source`（7値） vs §13.4 L2277（「供給源は**5つ**」） | **Idea の供給源が7値と5つで食い違う** | §3 は `gsc_gap \| rakko_paa \| news \| threads_hit \| aio_miss \| lead_competitor \| manual` の7値。§13.4 の表は①GSCギャップ ②ラッコPAA ③News ④Threadsヒット ⑤AIOミス の5つ。`lead_competitor` と `manual` が §13.4 に無い。enum は7値を採用した |
| **U24** | §5.2 L1649-1660 | 「**打ち手8タイプ**」と書かれているが、表の行は **9行**（`cta_move` / `cta_variant` が1行に同居） | 8タイプなのか9タイプなのかが不明。enum は9値を採用した |
| **U25** | §3 L249 `FunnelEvent.step`（7値） vs §3.8.3 L1230 | §3 の step は7値だが、**§3.8.3 が `phone_click` の追加を指示している**（=8値） | §4.1 段2 の「ファネル7段」との整合が不明（phone_click は7段の外か）。enum には8値目として含めた |
| **U26** | §3 L254 `Lead.type`（3値） vs §11.1 L2103 | §3 は `direct_inquiry \| agency \| line_friend` の3値だが、**§11.1 が `Lead(type=note_purchase)` を「既存モデルのまま」使うと書いている** | note は §9.2 でスコープ外のため enum には含めなかったが、含める場合は §14.0「獲得3ゴール」の定義と衝突する |
| **U27** | §3 L169-172 `MetricSnapshot` / §3 L407-412 `AdMetricDaily` / §16.1-④ L2607 | **一意制約に NULL 可能な列が含まれている** | Postgres は NULL を非同値として扱うため、`channelId` が NULL の行や `adGroupId`/`creativeId` が NULL の行に一意制約が効かない。**冪等キー（§16.1-④）が意図通り機能しない**。NOT NULL 化するか部分インデックスを併用するかの判断が要る |
| **U28** | §7.5（2箇所） | **見出し番号 `7.5` が重複している**: 「§7.5 廃止手順（データを失わない順序）」（L1774・§7配下）と「## 7.5 記事の鮮度管理とリライト自動化」（L1787・トップレベル） | 参照時にどちらを指すか曖昧。本ファイルでは後者（鮮度管理）を §7.5 として参照した |
| **U29** | §18 L2732-2736 | 見出しは「改訂理由（**v1 → v5**）」だが、**本文は v3 までしか説明していない**（v4 / v5 の改訂理由が無い） | 冒頭 L19 の改訂履歴には v4・v5 の記述があるが、§18 と内容が接続しない |
| **U30** | §14.8 L2483-2494 | 監査表の「現設計」列が `Lead` / `FunnelEvent` / `AgencyLead` 等を **❌（欠損）** としているが、**§3（統合版 v4）には全て存在する** | §14 が追記された時点（v3）の記述が残っている。現時点では ✅ が正のはずだが、明示的な訂正が無い |

| **U40** | §5.2 L1649-1660 vs §7.5.2 L1817-1826 | **Action の type が二系統ある** | §5.2 は打ち手タイプ（`title_meta_rewrite` / `cta_move` …）を定義し、§7.5.2 は鮮度トリガーで起票される Action として **別の名前**（`periodic_review` / `triggered_by_rank` / `triggered_by_law` / `triggered_by_competitor` / `kw_refetch` / `geo_reinforce`）を挙げる。両者の関係（同一 enum か、別の軸か）が不明。★**P1 の移行で実害が出た**: 旧 `intervention_type='rewrite'`（本文リライト）に対応する値が §5.2 に無く、`title_meta_rewrite` に写像せざるを得なかった（原文は `Intervention.type` と `Action.rationale` に保存して失っていない）。**P4 の立案ロジック実装前に決める必要がある** |

| **U41** | §3 model Lead vs §16.2 / §5.4 | **Lead に個人情報の列が1つも無い** | §16.2 は「**Lead の個人情報カラムは列単位で暗号化**」と規定し、§5.4 は「自動返信メール送信」を要求しているのに、§3 の `model Lead` には氏名・メール・電話・会社名を入れる列が無い（`companyType` はあるが連絡先ではない）。★**P2 で実害**: フォーム受信を保存できない。→ §9-D18 で `contactName/Email/Phone/companyName` を追加（AES-256-GCM 暗号化）して解消したが、**設計書 §3 に反映が要る** |

### 8.5 外部依存・運用上の未確定

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U31** ✅§9-D13 | §3.8.4 / §19.0 | m2 側に「リード元＝メディア」を記録する項目が**存在しない**（2026-07-20 石井確認） | **解決: m2 を改修しない。** 紐付けの正を MMS 側（`Lead.m2DealId`）に置く（§9-D13） |
| **U32** ✅§9-D14 | §19.0 | プライバシーポリシー改定の専門家確認 | **解決: 行わない**（2026-07-20 石井確定）。ポリシー本文の改定自体は P0.5 で実施する |
| **U33** | §19.1 L2753-2756 | **構成の最終承認・スコープ・経営戦略室 Markdown 資産の扱いが未チェック** | `[ ]` のまま。特に「Markdown資産をDBへ移すか」は `Decision` / `Learning` モデルの使い方に直結する |
| **U34** ✅§9-D14 | §3.4.6 | Google/Yahoo 広告のポリシー審査に通るか | **解決: 事前確認は行わない**（2026-07-20 石井確定）。§3.4.5 の**小額テスト（Step 1）で実地に判明する**ため、そこまで判断を遅らせる。★不承認なら P7.5 / P7.6 は着手前に中止する（受容したリスク） |
| **U35** | §2.1 L85 | **Prisma のバージョン指定が無い** | P0-a で検証したところ **Prisma 7 は `datasource` ブロックの `url` を廃止**しており（`prisma.config.ts` へ移動）、schema の書き方が変わる。本 schema は **Prisma 6 系の構文で記述し `prisma validate` に pass することを確認**した。P0 で採用バージョンを確定する必要がある |
| **U36** | §16.1-① L2604 | 合成モニタリングは Playwright を使うとあるが、**§2.1 のスタック表に Playwright が無い** | worker（Python）側か web（Node）側かが不明 |

### 8.6 P0-a で導出した項目（設計書に記載が無いもの）

| ID | 内容 | 対応 |
|---|---|---|
| **U01** | **各 Phase の「完了条件」が設計書に存在しない** | 本ファイル §1 の完了条件は、Phase の内容記述から P0-a が導出した。**受け入れ基準として使う前に石井さんのレビューが要る** |
| **U37** | **主キーの型・生成方式が設計書に無い**（`id` とだけ記載） | `String @id @default(cuid())` に統一した（schema 冒頭 C-1） |
| **U38** | **金額列の精度が設計書に無い** | `Decimal @db.Decimal(14, 2)` に統一した（C-5）。240万円・480万円規模のため桁数は十分 |
| **U39** | **リレーションの逆側フィールドが設計書に無い** | Prisma は双方向リレーションが必須のため機械的に追加した（C-2）。**データ構造の追加ではない** |
| **U61** | ~~記事詳細にLINE CTAが1本も無い~~ | ✅ **2026-07-23 解決（テーマ v175）**。`media-article-bottom`（本文直後）と `media-article-sidebar`（PC）を追加。記事を読み切った人の出口ができた |
| ~~**U62**~~ | ~~ヘッダ/フッタのLINEリンクが常に `hp-` 計上~~ | ✅ **2026-07-23 完了・本番で確認済み**。実URLを叩いて裏取りした: 記事ページ（`single-blog`）は `media-*` / `article-*`、`/media/`（`post-type-archive-blog`）も `media-*`、HPトップは `hp-*`。★MMS が渡した判定式 `is_singular('post')` は誤りで、この案件の記事は `post_type=blog`。cowork が修正。**判定式は本番HTMLの body class で裏取りしてから渡す**（教訓） |
| ~~**U63**~~ | ~~LINEの遷移先URLが未確定~~ | ✅ **2026-07-23 完了**。`lin.ee/5NVLBXA` と `lin.ee/szd8e1x` は**同じアカウント**（`@898ubeoo`）の短縮URLが2本あるだけと実測で確認。canonical `szd8e1x` に統一。**コンテナ再起動済みで `MMS_LINK_DEST_LINE=https://lin.ee/szd8e1x` が反映済み**（2026-07-23 確認） |
| **U64** | **LINE友だち数の履歴取り込みが途中** | insight/followers はレート制限（約60回/時）があり、初回は 5/20 までしか遡れていない。日次実行で順次埋まる。それ以前を含む期間は「期首の記録なし」と表示される |
| **U66** | ~~`/media/` トップだけヘッダ/フッタが `hp-` のまま~~ | ✅ **2026-07-23 解決（テーマ v175）**。`/media/` は固定ページではなく `blog` のポストタイプアーカイブで、`is_page_template('page-media.php')`（v171）も `is_page('media')`（v173）も false だった。正しい判定は `is_post_type_archive('blog')`。★MMS が2回とも誤った式を渡した。**判定式は本番HTMLの body class で裏取りしてから渡す**（教訓） |
| **U69** | 記事のタグ付け（読者・記事の型・メインKW・クラスタ・鮮度） | ⏳ **大半が解決（2026-07-23）**。読者157/179・記事の型155/179（`scripts/tag-content-axes.py`）／**メインKW 165/179**・**クラスタ 101/179**（cowork台帳から取り込み・D31/D33）／**鮮度 155/179**（D34）。★買い手軸・ファネル段階は **D28 で記事から外した**（記事から読者の予算規模は決まらない）。残りは**クラスタ未定61本**（cowork も「まだ決めていない」と確認済み）と型が未分類の24本。**判定できないものは空のまま残す**（§3）。`/content` の充足パネルで可視化 |
| ~~**U71**~~ | ~~買い手軸で判定できない記事が40件~~ **→ D28 で解消**。買い手軸（`budgetTier`）そのものを記事から外し、「読者」＋「記事の型」に置き換えた。読者157/179(88%)・型155/179(87%)まで埋まっている。残る未分類は §3 のとおり**空のまま残す**（推測で埋めると分析が嘘になる） |
| **U70** | **リダイレクタの実測が記事別に分解できない**（**D29 で部分的に解消**） | 記事別の内訳は計測タグ（`link_click`）で出せるようになった。ただし**リダイレクタ側の合計とは一致しない**（サーバー実測 vs JSが動いた分）。完全に一致させるには `/r/line/{設置場所}-{記事ID}` が要る → **U72** |
| **U72** | **リダイレクタURLに記事IDを入れる**（cowork 作業） | 記事末CTAのリンクを `/r/line/media-article-bottom` から `/r/line/media-article-bottom-ART-159` にする。`SAFE_SOURCE`（`[A-Za-z0-9_-]{1,40}`）はそのまま通る。これができると**サーバー側の実測だけで記事別の送客**が出せ、広告ブロックの影響を受けない数字になる |
| ~~**U73**~~ | ~~ART-142（P1ピラー）が本番で301の無限ループ~~ | ✅ **2026-07-24 解決**（cowork/石井が WP Redirection を修正）。実測で確認: canonical `keieikyoka-…` が **200・0ホップ**、`chushokigyo-…` と `-pillar` はいずれも **1ホップで canonical に着地**。★MMS 側は `redirectsToId` で301元を集計から除外済み |
| ~~**U74**~~ | ~~`/media/category/tax-reform/` が404~~ | ✅ **2026-07-24 解決**（cowork が WP Redirection を修正）。実測で確認: `tax-reform` が **200・0ホップ**で「税制改正・時事ニュース」（25本）を表示、`/blog-category/tax-reform-news/` は**1ホップで着地**。★行き止まりの正体はメニューではなく **id=25 の逆301**（正カテゴリを削除済みの空termへ転送）だった。原因は3層（重複term・逆301・旧パス転送）ですべて塞がった |
| **U75** | **config の `BREADCRUMB_CATEGORY_SLUG` が404を指していた**（2026-07-24 是正済み） | 3種23本が404だった。`tax-reform-news`(14) → `tax-reform`／`capital-investment`(7) → `capex-tax-reduction`（breadcrumb の JSON-LD 表記「設備投資・減税」とライブのカテゴリ名が一致・GPU系 ART-086〜091）／`tax-reform`(2) は U74 待ち。★`cases-interviews`(3) は `/media/` へ301するだけで**カテゴリページが存在しない**・`partner`(1) は `/partners/` でカテゴリではない → **未対応・要判断** |
| **U76** | **MMS 登録URLのうち25件が404**（`url_health.py`） | **要対応は0件**。内訳はすべて `LEGACY-*`（過去の実測があるだけの旧URL）と `PAGE-*`（GSC由来のサイトページ）で、**現役記事の404は0件**。★このうち2件はURL欄に本文が混入している（`/media/)という中小企業向けの…`）。GSC が 2026-07-02 に実際にクロールしており**壊れたリンクが存在した**が、現在 `/partners/` `/media/` `/` には無く再現しない。実測5件と軽微のため追跡は打ち切り |
| ~~**U77**~~ | ~~worker が `idle in transaction` の接続を残す~~ | ✅ **2026-07-24 根治**。原因は worker だけでなく **`url_health.py`（私が当日書いたもの・235回のHTTPを開いたトランザクション内で実行）** と `line_followers.py` も同じ構造だった。3つとも `autocommit=True` に変更。検証: ポーリング2周超のあいだ `idle in transaction` が常時0、DDL は**4分超 → 0.3秒**、ジョブの書き込みも正常（235行保存） |
| **U68** | **ディスクが94%（残り58GB）で、MMS以外が844GB使っている** | Docker側は掃除済み（43GB＋20GB解放）だが、根本はホスト全体の使用量。日次GCで増加は抑えられるが、**他の要因で再び逼迫する可能性**は残る。段7で監視し、90%で警告が出る |
| **U67** | **`/media/category/tax-reform-news/`（税制改正ニュース）に記事が0本** | CTAは正しく出ているので導線の問題ではなく、**そのカテゴリのコンテンツが空**。カテゴリページは「記事を準備中です」表示。GNav から到達できるので、空のまま置くと読者が行き止まりに当たる |
| **U65** | **`Target` に `inquiries_total` が無い** | 段1のゴール（問い合わせ総数）に対する月次目標が未設定。現状は `direct_inquiry=2` のみで、種別内訳にしか出ない |

---

> **★このリストが埋まらないまま P0 に進むと、U05〜U10 は実装中に必ず手戻りになる。**
> 特に **U05（`CompetitorSnapshot` 不在）と U08（`clusterId` の指す先）** は、
> P4.3 / P6.7 / P6.8 の実装を止める。**P0 着手前の判断を推奨する。**

---

## 9. 決定記録（Decision Log）

> 2026-07-20 石井「あなたの判断で推進して」による委任のもと、§8.1 の6件と Prisma バージョンを決定した。
> **決定はすべて可逆。** 変更前の状態は git commit `5305e74`（P0-a 初回コミット）に残っている。
> **異論があればこの表の行を差し戻すだけでよい。**

| ID | 論点 | **決定** | 根拠 | 影響範囲 |
|---|---|---|---|---|
| **D1** | `CompetitorSnapshot` の実体（U05） | **`SerpSnapshot` とする。** 設計書 §5.2 入力④を「`SerpSnapshot.isOurs=false` で自社圏外のKW」に、§14.8 を「`SerpSnapshot` / `Competitor` / `CompetitorMetric`」に修正 | §3.3.5 の表が「**自社が圏外のKW（空白地帯）→ `SerpSnapshot` の `isOurs=false` のKW抽出**」と明示している。新モデルを作る必要はない | P4（立案ロジック）／P6.7／P6.8 |
| **D2** | `MarketShare.clusterId` / `SeasonalityIndex.clusterId` の指す先（U08） | **`KeywordCluster`（商材／テーマ単位の市場）** | ① `marketVolume = Σ KeywordVolume` は Keyword を束ねる `KeywordCluster` でしか算出できない ② `TopicCluster` 側の市場・シェアは **`ClusterMetric.marketVolume` / `.clickShare` が既に持っている**（§3 に明記）ため、`MarketShare` を TopicCluster に付けると二重定義になる ③ §3.8.1 が `SeasonalityIndex` を「月別の需要指数（**KWクラスタ単位**）」と明記 | P4.10／P6.8／P4.13 |
| **D3** | `Intervention` の §16.5 追加3項目と `confidence` の値域（U06） | **`controlGroupSize` / `confidence` / `batchId` を採用。`confidence` は `ConfidenceLevel { low \| medium \| high }`** | §16.5 が「§3反映済み前提で実装」と明記しており採用は確定事項。値域は同節の3つの判定経路（基準充足／バッチ判定／全体トレンド補正）に1対1で対応させた | P4.8 |
| **D4** | `Experiment` ⇄ `Intervention` の関連（U09） | **Action 経由のみ**（`Experiment → Action → Intervention`）。直接リレーションは張らない | `Intervention` は `Action` に 1:1 で従属する設計（`actionId @unique`）。`experimentId` を足すと親が2つになり整合性を保てない | P4／P8 |
| **D5** | `PatternMetric`（U07） | **モデルを作らない。** `PostPattern` は関連を持たない | `PostPattern` の活用は **§9.2 スコープ外（P10-a）**。保持指標が設計書に無く、推測で作ると P10-a 着手時に作り直しになる | P10-a（将来） |
| **D6** | メインKWの正（U10） | **正は `KeywordAssignment(role=main)`。`ContentItem.mainKeywordId` は読み取り用の非正規化キャッシュ**とし、**書き込みは `KeywordAssignment` 経由のみ**とする | §7.1 の Notion 移行表が「メインKW → `KeywordAssignment(role=main)`」と定めている。カニバリ検出の DB 制約（`@@unique([keywordId, role])`）も `KeywordAssignment` 側にしか置けない | P4.5／P4.7 |
| **D7** | Prisma のバージョン（U35） | **Prisma 6 系に固定する** | Prisma 7 は `datasource` ブロックの `url` を廃止し `prisma.config.ts` へ移した。P0 は Docker Compose + Next.js 15 + Auth.js + launchd を同時に立ち上げる工程であり、**そこに ORM の構成変更を重ねるのはリスクが高い**。本 schema は Prisma 6 で `prisma validate` に pass 済み。7 系への移行は基盤が安定してから単独で行う | P0 |
| **D8** | 設計書の段6/段7 取り違え（U22） | **設計書 §17 の2行を段6→段7に修正した** | §4.1（段6=施策の生死／段7=ジョブ健全性）が正であることは文書冒頭 L24 が宣言している。§17 側が誤り | — |
| **D9** | §9 以外のロードマップ表6箇所（U21/U17） | **§9 へのポインタに置換した**（§3.3.8／§3.4.9 が既に採用している書式に統一）。**Phase は1つも失われていない**（全59件が §9.1 に存在することを確認済み） | 「ロードマップは §9 のみ」という文書冒頭 L23 の宣言に合わせた。各節の「全体 約N日」は追記時点の古い累計で、**§9.1 の 52.5日 と矛盾していた**ため削除 | — |

| **D10** | M-A の所要日数（U04） | **15.0日 に統一。** 設計書 §1.1 の「11.1日」と §9.3 注記の「7日」を 15.0日 に修正 | §9.3 のマイルストーン表は §9.1 の Phase 見積から積み上げた値であり、**唯一 §9.1 と整合する**。他の3つは追記時点の古い値。成功指標の判定は「M-A 到達＝**15.0日** 後の30日間」になる | §1.1 の判定タイミング |
| **D11** | createdAt / updatedAt（U16） | **全82モデルに `createdAt DateTime @default(now())` / `updatedAt DateTime @updatedAt` を一律付与** | ① §16.2 の `AuditLog` だけでは「いつ作られた行か」を追えない ② 移行（P1／P1.5）で入った行と運用中に増えた行を区別できないと突合ができない ③ **後入れは全82テーブルの ALTER になり最も高くつく**。行あたり16バイト増は §3.2.2 の規模（年36万行）では無視できる | 全Phase（P0 の初回マイグレーションで入る） |
| **D12** | 値の列挙が無い26項目（U11） | **String のまま維持し、P1／P1.5 の移行完了後に実データを集計して enum 化する** | 旧Notion の select 値（`ContentItem.status` / `.category` / `.eyecatchType` 等）は**移行すれば実値が全て判明する**。いま推測で enum を作ると、移行時に想定外の値が出て必ず作り直しになる。**「実データが答えを持っている」ものを先に決めない** | P1／P1.5 完了時に再検討 |
| **D13** | m2 側の「リード元＝メディア」項目（U31） | **m2 を改修しない。** 紐付けの正を MMS 側に置き、`Lead.m2DealId` で突合する | 2026-07-20 石井確認により m2 に該当項目は**存在しない**。m2 は VPC内・外部非公開で改修コストが高い一方、**§3.8.4 の目的（記事別・クラスタ別ROI）は MMS 側に DealId があれば達成できる**。m2 のUIで流入元が見えないことは、この目的に影響しない<br>**実装**: ①第一候補＝リード連携時に m2 API が返す DealId を `m2DealId` に保存 ②不可なら `/leads` 画面で手動紐付け（月数件のため現実的） | P6.10 |
| **D14** | 専門家確認・広告審査の事前確認（U32 / U34） | **どちらも行わない**（2026-07-20 石井確定）。P0.5 の完了条件から「専門家確認」を削除。広告審査は**§3.4.5 の小額テスト（Step 1）で実地に判明させる** | 石井さんの明示的な判断。★ただし**リスクは消えていない**: 広告が不承認なら P7.5（1.5日）・P7.6（0.5日）は空振りになるため、**小額テストの結果を見てから着手する**（受容したリスク） | P0.5 / P7.5 / P7.6 |

| **D15** | `ContentItem` の `articleType` / `freshnessTier` / `funnelStage`（P1で判明） | **3つとも Nullable にした** | 既存157記事の移行時点でこの3つは**確定できない**（`freshnessTier` は §7.5.4 が「移行時に自動判定」＝P3.5、`funnelStage`/`budgetTier` は P4.9 の一括タグ付けで確定）。必須のままだと **P1 の移行が1行も入らない**。C-7（作成時点で論理的に未確定な項目は Nullable）と同じ判断 | P1／P3.5／P4.9 |
| **D16** | 計測データはあるが記事レコードが無い URL（P1で判明） | **`ContentItem` として保持する**（`type=article_unlinked` / `type=site_page`） | media.db の `articles`(157) に無いのに実測がある URL が **84件**あった（改題・統合・削除された記事16件＋週次のみ4件＋サイトページ64件）。捨てると §3.2.2「過去3ヶ月を失わない」に反する。`type` で区別し `note` に由来を残した | P1／P4.3（クラスタ割当時に要仕分け） |
| **D17** | 既存 Python 資産の配置（§2.2 は「legacy/ に配置」） | **コピーせず、元ディレクトリを読み取り専用マウントする** | コピーすると本体と乖離し、「更新したのに worker は古いまま」という事故が起きる。`:ro` マウントなら**乖離しない**うえ、worker から書き換えられないので §6「書き直さない」を**構造的に保証**できる | P1 以降の全ジョブ |

| **D18** | Lead の個人情報の列（P2で判明・U41） | **`contactName` / `contactEmail` / `contactPhone` / `companyName` を追加し、AES-256-GCM で列単位に暗号化**して保存する | §16.2 が「Lead の個人情報カラムは列単位で暗号化」と明示しており、§5.4 の自動返信にも連絡先が要る。列が無いと P2 のフォーム受信が保存できない。暗号鍵 `MMS_PII_KEY` 未設定時は **fail-closed**（平文保存せず 503 を返す）。復号は `apps/web/lib/crypto.ts` の `decryptPii()` のみ、AI へは必ずマスキング（§11-1） | P2／P2.7（自動返信）／P3（一覧表示） |

| **D19** | ブラウザ計測タグの認証（P2.5） | **HMAC を使わず、Origin allowlist ＋ セッション単位レート制限 ＋ 冪等キーで守る** | §8 の HMAC は「Webhook 受口」（WP/GAS のサーバー間）向け。ブラウザのタグに共有シークレットを持たせると**クライアントに露出して無意味**。first-party テレメトリは別の防御が正しい。`/api/ingest/form`（HMAC）と `/api/ingest/events`（Origin+レート）で受口を分けた | P2.5／P2.11 |
| **D20** | 計測イベントの FK 堅牢性（P2.5で判明） | **存在しない `ctaId` / `lpId` / `contentExternalId` は null 化してから保存する** | 実機テストで、タグの `data-lp` に未登録IDを入れると FK 違反で**バッチ7件全部が落ちた**。計測タグの属性ミス1つで全ファネルデータを失うのは事故。厳密さより堅牢さを優先し、解決できない参照は null にして残りを保存する | P2.5／全 ingest 受口 |

| **D21** | 獲得の構造（2026-07-22 石井さんと整理） | **「送客 → 受け皿 → リード → 成約」を軸にする。** 段1のゴールは**問い合わせ件数**で、内訳は受け皿（`Lead.sourceType`）別。LINE登録は合算しない | 旧実装は `Lead.type`（直客/代理店/LINE）の3ゴールだけを出しており、受け皿（診断LP・商品LP・HPフォーム・電話・info メール）が1つも画面に無かった。増やしたいのは問い合わせ数で、打ち手は受け皿ごとに違う | `/`（段1・段2）／`/leads`／全受け皿画面 |
| **D22** | Threads のゴール（2026-07-23 石井さん） | **並列に2つ（①メディア送客 ②DM）。1本の階段にしない。** 狙いの判定は**貼ったリンク**（`/r/soken/`→①・リンク無し＋代理店候補→②） | 縦に積むと DM狙いの投稿が「送客していない」と評価され、逆も起きる。自己申告の列を作ると、実際に貼ったものとズレたときに嘘が残る | `/threads` |
| **D23** | 代理店専用画面（2026-07-23 石井さん） | **`/agency` を廃止。** 種別（見込み客／代理店見込み）は**軸であって画面ではない**ので、各画面のタブで分ける | 獲得しているのは2種類で経路が違うだけ。専用画面を持つと同じ数字が2箇所に散り、どちらが正か分からなくなる（実際、商品LPが `/agency` と `/lp` の両方にあり、片方は名前も分類も誤っていた） | `/leads`（代理店見込みタブ）／`/threads`／`/lp/[slug]` |
| **D24** | LPの管理（2026-07-23 石井さん） | **台帳（`LandingPage`）で管理する。** `variantKeys` / `metricPrefix` / `hasAgencyCodes` を追加し、A/Bは「1つのLPのバリアント」として持つ | LPは今後増える（商材別・総合窓口・代理店募集）。旧実装は「診断LP」「代理店LP」を画面に直書きしており3本目で破綻する。A/BでLPを3件に割ると勝敗を判定できない | `/lp`／`/lp/[slug]` |
| **D25** | きっかけ（送客元）の記録（2026-07-23 石井さん） | **`Lead.origin`（`LeadOrigin`）を追加。** 受け皿と直交する軸として持つ。電話・info メールは**測定不能ではなく手入力で計測**する | 施策はすべて「見込み客募集」か「代理店募集」のために動いており、各施策のゴールは問い合わせ増加。いきなり連絡してくる人はほとんどおらず、何かの施策に触れている。「自動で取れない」を「測れない」と書くと記録する動機まで消える | `/leads`／`/hp`／`/phone`／送客×受け皿マトリクス |
| **D26** | info メールの扱い（2026-07-23 石井さん訂正） | **HPの問い合わせフォームと同一。** 受け皿を `form` に一本化し、`email` は @deprecated として値だけ残す | フォーム送信が info@ に届くだけで別経路ではない。2つの受け皿として扱うと二重計上のリスクが残る | `LeadSourceType`／`/hp`／`/leads` |
| **D27** | 公式LINEの階段（2026-07-23 石井さん） | **登録 → 問い合わせ → 成約 の3段。** 送客（クリック）は階段に載せず「入口」（HP/メディア/Threads/不明）として別枠。友だち数は Messaging API から日次取得 | クリックと登録は別の計測系で**同じ人だと確認する手段が無い**（follow に経路情報が入らない）。率に意味が無く「送ったのに登録されない」という誤読を生む。友だち総数は webhook では取れない（設置前の友だちに event が起きない） | `/line`／`builtin/line_followers.py` |
| **D28** | 記事の分類軸（2026-07-23・石井さんの指摘で設計変更） | **「読者」（`ContentAudience`）と「記事の型」（`ContentFormat`）の2軸。** `budgetTier` は記事に付けない | 最初 `budgetTier`（高/中/低）を商材名から記事に付けたが誤りだった。**記事から読者の予算規模は決まらない**（両替機350万/台の記事を1台買う人も数千万分買う人も読む）。唯一の成約（480万＝定義上「中」）の記事を「高」と分類しており、**実測1件が分類を否定していた**。金額はリード側で商談時に聞く | `ContentItem`／`/content`／`scripts/tag-content-axes.py` |
| **D29** | 記事内リンクのクリック追跡（2026-07-23 石井さん「記事内のどのリンクに遷移しているかなども追える方が良いのでは？」） | **計測タグ側で `a[href]` を自動で拾う**（`FunnelStep.link_click`）。WordPress 側の作業を伴わない | リダイレクタ（`/r/`）の送り元は設置場所IDだけで**記事を持たない**ため「どの記事から」が出せない。計測タグは `data-mms` を貼った要素しか見ておらず、記事159本のどこにも属性が無く**イベントは通算1件（`lp_scroll`）だけだった**。159本に属性を貼らせるのは現実的でなく貼り漏れも見えない。記事には既に `data-article` が入っている | `mms-tag.js`／`/api/ingest/events`／`lib/link-clicks.ts`／`/content` |

| **D30** | 記事のメインKWの決め方（2026-07-23） | **GSC の page×query（`ContentQuery`）から実測で決める。** 「一番クリックを集めている検索語」がメインKW。クリック1以上または表示10以上を要求し、それ未満は空のまま残す | 179記事すべてで mainKeyword が空だったのは、埋める材料が無かったから（`gsc_daily.py` は `["date"]` と `["page","date"]` しか取っていなかった）。人が「狙っていたKW」を入力すると狙いと実測のズレが消え、リライト対象が見つからなくなる。実測を正にして初めてカニバリも見える | `ContentQuery`／`builtin/gsc_queries.py`／`scripts/derive-main-keywords.py`／`/keywords`／`/content/[id]` |

| **D31** | クラスタ・メインKWの出所（2026-07-23・石井さん「クラスタは元々管理していたはずだ」） | **メディア事業部側の台帳を正とする。** cowork 経由で受け取った CSV（175行）から 17クラスタ・101本、メインKW162本、最終レビュー日147本を投入 | 「未管理」という判断が誤りだった。`shared/strategy/pillar-plan.md`（7 Pillar構成・石井確定）／`shared/keywords/art-kw-map.yaml`（112件・「SEOキーワードの唯一の正」）／`media.db articles.main_kw`（157/157）／`wp/archive/*/README.md`（PL-D1体系）に管理されており、MMSへ移行されていなかっただけ。実測で上書きすると狙いとのズレが消える | `TopicCluster`／`ContentCluster`／`KeywordAssignment`／`scripts/import-cluster-kw.py`／`/clusters` |
| **D32** | 鮮度階層の扱い（2026-07-23） | **どこにも記録が無いことを確認した。** cowork の CSV も鮮度列は全175行が空。`FRESHNESS_TIER` は PRJ-030 の設計書1ファイルにしか存在せず未実装 | 一方で**最終更新日は147本ぶん実在した**ので `lastReviewedAt` として投入済み。階層さえ決まれば `nextReviewDue` が計算できる状態になった。階層の付与ルール（記事の型からの機械判定）は石井さん承認待ち | `ContentItem.lastReviewedAt`／`FreshnessRule` |

| **D33** | クラスタのピラー紐付け（cowork 回答 2026-07-23） | **`art-kw-map.yaml` の notes が設計上の正。** P1即時償却=ART-006（実体はART-142）／P2法人節税=ART-007／P3決算対策=ART-008。横串2つは**設計上ピラーを置かない** | 前回CSVの「制度・法人節税 総合Pillar」はCSV作成時の便宜的グルーピングだった。「5クラスタでピラーが欠けている」と読んでいたが、**3つは実在していて紐付けが外れていただけ**。ART-006 は 301 で ART-142 へ統合済みのプレースホルダなのでクラスタから外す（被リンク0のピラーという誤った像になる） | `scripts/fix-cluster-pillars.py`／`TopicCluster.note`／`/clusters` |
| **D34** | 鮮度のケイデンス（cowork 実運用ヒアリング 2026-07-23） | **速報=随時（法改正トリガ）／商材・比較=90日＋CTRトリガ／Pillar・実務=6ヶ月／制度・リスク=12ヶ月＋法改正トリガ。** 督促は**二段構え**（期限は境界、着手はCTR不全と重なった記事） | 当初案から3点直した。①リスク記事を商用60〜90日に入れていたが、C柱は時事性が低く実測でもリライト0件だった ②90日は「全商材を定期的に回す」ではなく「CTR不全が出た記事だけの事後対応」が実態 ③処理能力は週2〜3本で、期限切れを全部出すと誰も見なくなる | `scripts/derive-freshness.py`／`lib/review-queue.ts`／`/content` |

**★D34 の根拠になった cowork の実測（そのまま記録する）**
- 着手理由の最多は **CTR不全＝「順位10〜14位×表示あり×クリック0」**。"順位が落ちた"ではない
- 公開→初回リライトの実間隔は **60〜75日**。ただし定期ケイデンスではなく事後対応
- 処理能力: PRJ-026 は5週で約10本、実履歴は約2週で9件（集中日にまとめて処理）
- **効いた**: ART-101 読者意図に合わせた即答型タイトル/メタ → クリック4→7・表示203→509
- **効かなかった**: ART-061 キーワード列挙型のタイトル追加 → 24.7位→10.3位だがクリック0のまま、その後21位へ再下落
- ART-142（ART-006統合）は順位13→20へドリフト、クリック2〜3→0。**統合は順位改善には効いていない**
- `LAST_REVIEWED` は194本中1本のみ＝構造化フィールドとしては実質存在しない

**★D31 で実際に見えたこと（2026-07-23 実測）**
- **5クラスタ（37本）にピラーが無い** — P1即時償却10本 / P2法人節税13本 / P3決算対策5本 / 税制改正・制度横串8本 / 税制改正横串1本。評価を集める先が無い
- **3クラスタでピラーよりクリックの多い子記事がいる** — ハブが実態と合っていない（PL-D1・事業承継退職金・GPU）
- **内部リンクの69%（414本）がクラスター↔クラスター**、クラスター→ピラーは19%（114本）。権威がピラーに集約されていない
- **PL-D1 個人事業主（10本）は表示4,663に対しクリック1** — 「国税庁 …」型の指名検索が主で、順位が良くても押されない（§4-24）
- **総合Pillar の ART-006 は被リンク0** — ART-142 へ統合済み（301）なのにピラーのまま残っている
- 唯一 問い合わせ1件を出しているのは **PL-S1 即時償却主力商材**（被リンク28・最多）

**★D30 で実際に見えたこと（2026-07-23 実測・90日）**
- 「即時償却」で**12記事が競合**。全部 44〜99位、合計186表示・**0クリック**。頭の語に全部が群がって誰も勝てていない
- 「gpuサーバー 節税」「gpu 節税」で**4記事が11〜18位**に散っている
- 低CTR上位はほぼ「国税庁 …」型の指名検索（3.9〜6.6位・計445表示・0クリック）。**直しても増えない**ので印を付けて下へ回した（§4-24）
- 検索流入のある120記事のうち**63本は根拠が薄く**（クリック0かつ表示10未満）メインKWを決められない＝実質的に検索で見えていない

**★D29 の残る限界（画面に明記済み）**
リダイレクタは**サーバー側**の実測で広告ブロックの影響を受けないが、計測タグは **JSが動いた分だけ**。したがって両者の合計は一致しない。**合計はリダイレクタが正**で、記事別・リンク別の内訳を知りたいときに計測タグ側を見る。両方を一致させるには `/r/line/{設置場所}-{記事ID}` のように記事IDをURLへ入れる必要がある（cowork 側の作業・U72）。

### 9.1 決定に伴う実装上の注意

| # | 注意 |
|---|---|
| **N1** | **U27（NULL列を含む一意制約）は未解決のまま残っている。** `MetricSnapshot([businessId, channelId, metric, date, granularity])` と `AdMetricDaily([campaignId, adGroupId, creativeId, date])` は、NULL 列がある行で一意制約が効かない。**P0 で raw SQL マイグレーションによる部分ユニークインデックス（`CREATE UNIQUE INDEX ... WHERE channel_id IS NULL`）を追加すること。** これを怠ると §16.1-④ の冪等キーが機能しない |
| **N2** | D2 により `/market`（P6.8）は **KeywordCluster 単位**で描画する。`/clusters`（P4.3）のツリーに出す市場規模・シェアは `ClusterMetric` から取る |
| **N3** | D6 により、記事のメインKWを変更する処理は **必ず `KeywordAssignment` を更新し、その後に `ContentItem.mainKeywordId` を同期**する。逆順・片側だけの更新を禁じる |
| **N4** | D7 により `package.json` は `prisma@^6` / `@prisma/client@^6` で固定する |
| **N5** | D17 により、legacy スクリプトを動かすジョブを有効化する前に**資格情報を worker に渡す**こと。未設定のまま有効化すると失敗した `JobRun` が段7を赤で埋める（→ `services/worker/legacy/README.md`） |
| **N6** | D16 の `type=article_unlinked` / `type=site_page` は **P4.3 のクラスタ自動割当の対象外**にすること。記事ではないものをクラスタに入れると `linkHealthScore` が歪む |
