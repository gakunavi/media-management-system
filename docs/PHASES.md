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
| 30 | **P0.5** | 個人情報・同意対応（ポリシー改定案・同意チェックボックス・`ConsentRecord`）＋専門家確認 | — | 0.5 | ConsentRecord / DataRetentionPolicy | プライバシーポリシー改定案があり専門家確認が済んでいる。保存期間の自動削除ジョブが動く。★**第三者提供の同意チェックボックスは実装しない**（§16.2 石井確定） | — |
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
| 51 | **P6.10** | **m2連携**（`Lead` ⇄ m2 Deal・成約結果の還流） | P2.6 | 1 | Lead | `Lead` が m2 へ連携され、成約額・成約日が MMS に還流して記事別・クラスタ別ROIが出る。★**商談プロセスは MMS に作らない**（二重管理を避ける） | Sonnet |

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
> ⚠️ M-A の所要日数は設計書内で **4通り**に記載が割れている（§13-U04）。

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

### 成功指標（M-A 到達＝11.1日 後の30日間で判定）

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

> ★P0-a の絶対要件2に従い、**一切を自己判断で解決していない**。
> 各項目に「設計書の該当行」と「なぜ判断できないか」を添える。**石井さんの判断が必要**。

### 8.1 実装をブロックしうるもの（★優先）

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U05** | §5.2 L1644 / §14.6 L2463 / §14.8 L2490 | `CompetitorSnapshot` というモデルが3箇所で参照されるが、**§3 にその定義が存在しない** | 実体が `SerpSnapshot`（KW×日付×順位）なのか `CompetitorMetric`（競合×月）なのか、あるいは第3のモデルなのかが読み取れない。立案ロジック（§5.2 入力④）の実装に直結する |
| **U06** | §16.5 L2688 | 「`Intervention` に `controlGroupSize` / `confidence` / `batchId` を追加（**§3反映済み前提**で実装）」とあるが、**§3 の `model Intervention`（L462-470）にこの3フィールドは無い** | 「反映済み前提」という記述と実際の §3 が食い違っている。schema には追加したが、`confidence` の値域（low/medium/high か数値か）が不明 |
| **U07** | §11.4 L2150-2153 | `model PostPattern` が `metrics PatternMetric[]` を持つが、**`PatternMetric` モデルが設計書のどこにも定義されていない** | 「businessId 別の成績を保持」としか書かれておらず、保持する指標（views / engagement / DM数 …）が不明。推測でモデルを新設しない方針のため、関連フィールドを持たせていない |
| **U08** | §3 L379-386 `MarketShare` / §3.8.1 L1189 `SeasonalityIndex` | `clusterId` が **`TopicCluster`（§3 L311）と `KeywordCluster`（§3 L351）のどちらを指すか不明** | 両者は別概念（前者=記事のトピック階層／後者=商材テーマでのKW束ね）。§3.3.2 の式は KeywordCluster 寄り、§3.5.4 の指標表は TopicCluster 寄りで、記述が割れている。暫定で `TopicCluster` に接続した |
| **U09** | §3 L446-451 `Experiment` | `Experiment` が `interventions Intervention[]` を持つが、**`Intervention`（L462）に `experimentId` が無い** | `Intervention` は `actionId` 経由でしか `Experiment` に到達できない。直接リレーションを張るのか Action 経由にするのかが不明。暫定で Action 経由のみとした |
| **U10** | §3 L189 `ContentItem.mainKeywordId` / §3 L304-307 `KeywordAssignment(role=main)` | **メインKWの正が2箇所ある** | §7.1 の移行表では「メインKW → `KeywordAssignment(role=main)`」とされる一方、`ContentItem.mainKeywordId` も存在する。どちらを正とするか（あるいは片方を非正規化キャッシュとするか）が不明 |

### 8.2 型・値域が確定できないもの

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U11** | §3 全体 | **値の列挙（`// a \| b \| c`）が無い項目が26箇所ある** ため String のままにした | 該当: `Business.status` / `Channel.type`(※`…`で打切) / `MetricSnapshot.granularity` / `MeasurementCoverage.method` / `ContentItem.type` / `.status` / `.category` / `.eyecatchType` / `.eyecatchColor` / `.targetLabel` / `.complianceVerdict` / `.factCheckVerdict` / `Lead.companyType` / `.urgency` / `Partner.status` / `LineFriend.status` / `LineMessage.kind` / `Keyword.intent` / `.priority` / `.status` / `Idea.state` / `Intervention.type` / `AdCampaign.objective` / `.status` / `AdCreative.status` / `Job.kind` / `JobRun.status` / `CrossPromotion.direction` / `DataQualityCheck.kind` / `.verdict` / `AuditLog.actorType`。**推測で enum を作ると後からマイグレーションが必要になる** |
| **U12** | §3 L207・L346・L379 ほか | **`month` の型が不明**（"YYYY-MM" 文字列か DateTime か） | `KeywordVolume` / `CompetitorMetric` / `MarketShare` / `Opportunity` / `UnitEconomics` は `month` としか書かれていない。一方 §3.8.1 `SeasonalityIndex.month` だけは `// 1-12` と明記され Int。暫定で前者を String("YYYY-MM")、後者を Int とした |
| **U13** | §3 L184-215 ほか | **Nullable の判断が付かない項目がある** | 「設計書で `?` が付いているものは Nullable」という指示だが、`ContentItem.url` / `.publishedAt` / `.infoBaseDate` / `.dataUpdatedAt` / `.lastReviewedAt` / `.nextReviewDue` は `?` が無い。しかし**下書き段階では論理的に値が存在しない**ため、必須にすると行を作れない。**Nullable にした（C-7）**。同様に `.category` / `.eyecatchType` / `.eyecatchColor` / `.targetLabel` / `.complianceVerdict` / `.factCheckVerdict` / `.validatorRun` / `.note` / `Lead.companyType` / `.urgency` / `Cta.variant` など |
| **U14** | §3 L1293-1300 `LandingPage.offer` | 値が **`無料相談 \| 資料DL \| 診断` と日本語** | Prisma の enum 値は識別子（英数字・アンダースコア）しか使えないため enum 化できない。String のままにした。英語識別子への読み替えが必要 |
| **U15** | §3 L374-377 `CtrCurve.segment` / §3.7.1 L1097 `SplitTest.changeType` / §3.9.5 L1405 `BrandMention.source` / §3 L158 `Channel.type` | **列挙が `…` で打ち切られている** | 「他に何があるか」が読み取れないため enum 化できず String のままにした |
| **U16** | 全model | **作成・更新時刻（createdAt / updatedAt）を持つモデルがほぼ無い** | 設計書に記載が無いため追加していない。しかし §16.2 の `AuditLog` や障害調査では通常必要になる。**全モデルに一律で入れるか否かの方針決定が要る** |

### 8.3 数値・Phase の食い違い

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U02** | §9.4 L1964-2012 | **§9.4 のモデル振り分けに載っていない Phase が9つある** | P0-a（※§9.1 の行内に「Opus」と記載あり）／P2.7 / P3.5 / P3.8 / P4.10 / P6 / P7.6 / P7.7 / P9 / P0.5。本ファイルでは `—` と記載した |
| **U03** | §9.4.1 L1970 vs §9.4.4 L2009 | **P0 が Opus と Fable 5 の両方に記載されている** | どちらで実施するか判断できない。加えて §9.4.1 は P0 を「Prisma 初期スキーマ確定」と説明するが、**スキーマ確定は P0-a の成果物**であり Phase の割当がずれている |
| **U04** | §1.1 L52 / §9.3 L1949 / §9.3 L1957 / §16.7 L2714 | **M-A の所要日数が4通り**: 「11.1日」「15.0日」「7日」「8日に修正」 | どれが最新か判断できない。§1.1 の成功指標は「M-A 到達＝11.1日 後の30日間で判定」と 11.1日 を前提にしているため、判定タイミングにも影響する |
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

### 8.5 外部依存・運用上の未確定

| ID | 該当行 | 内容 | なぜ判断できないか |
|---|---|---|---|
| **U31** | §3.8.4 L1261 / §19.0 L2749 | **m2 側に「リード元＝メディア」を記録する項目があるか未確認** | 無ければ m2 に1項目追加が必要。P6.10 までに石井さんの確認が要る（設計書自身が「石井さん確認事項」と明記） |
| **U32** | §19.0 L2748 | **プライバシーポリシーの改定を専門家に確認するか未決** | 設計書が「私は弁護士ではない」と明記しており、判断は石井さん |
| **U33** | §19.1 L2753-2756 | **構成の最終承認・スコープ・経営戦略室 Markdown 資産の扱いが未チェック** | `[ ]` のまま。特に「Markdown資産をDBへ移すか」は `Decision` / `Learning` モデルの使い方に直結する |
| **U34** | §3.4.6 L766-771 | **Google/Yahoo 広告のポリシー審査に通るか未確認** | 節税商材が「金融サービス」と判定されると審査が厳しい。**不承認が続くと広告チャネル自体が使えない**（P7.5 / P7.6 が空振りになる） |
| **U35** | §2.1 L85 | **Prisma のバージョン指定が無い** | P0-a で検証したところ **Prisma 7 は `datasource` ブロックの `url` を廃止**しており（`prisma.config.ts` へ移動）、schema の書き方が変わる。本 schema は **Prisma 6 系の構文で記述し `prisma validate` に pass することを確認**した。P0 で採用バージョンを確定する必要がある |
| **U36** | §16.1-① L2604 | 合成モニタリングは Playwright を使うとあるが、**§2.1 のスタック表に Playwright が無い** | worker（Python）側か web（Node）側かが不明 |

### 8.6 P0-a で導出した項目（設計書に記載が無いもの）

| ID | 内容 | 対応 |
|---|---|---|
| **U01** | **各 Phase の「完了条件」が設計書に存在しない** | 本ファイル §1 の完了条件は、Phase の内容記述から P0-a が導出した。**受け入れ基準として使う前に石井さんのレビューが要る** |
| **U37** | **主キーの型・生成方式が設計書に無い**（`id` とだけ記載） | `String @id @default(cuid())` に統一した（schema 冒頭 C-1） |
| **U38** | **金額列の精度が設計書に無い** | `Decimal @db.Decimal(14, 2)` に統一した（C-5）。240万円・480万円規模のため桁数は十分 |
| **U39** | **リレーションの逆側フィールドが設計書に無い** | Prisma は双方向リレーションが必須のため機械的に追加した（C-2）。**データ構造の追加ではない** |

---

> **★このリストが埋まらないまま P0 に進むと、U05〜U10 は実装中に必ず手戻りになる。**
> 特に **U05（`CompetitorSnapshot` 不在）と U08（`clusterId` の指す先）** は、
> P4.3 / P6.7 / P6.8 の実装を止める。**P0 着手前の判断を推奨する。**
