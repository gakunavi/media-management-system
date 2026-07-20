# メディア管理システム（MMS）設計書 v5

> **名称（2026-07-20 石井決定）**
> | 用途 | 名前 |
> |---|---|
> | 正式名称 | **メディア管理システム** |
> | 略称・識別子 | **MMS** |
> | リポジトリ／ディレクトリ | `~/システム開発/Next/media-management-system/` |
> | DB名 | `mms` |
> | API／MCPツール接頭辞 | `mms_*` |
> | 環境変数接頭辞 | `MMS_*` |


> 起案: 2026-07-20 / 起点: 石井
> 「見える化できていない。結果にフォーカスして動いている感じがしない。人を雇わない代わりに結果フォーカスの自動化をしたい」
> 「Next.js/Reactでちゃんとシステムを作れ。**今後さらに強化しながらうちの会社の基本になる**」
>
> 位置づけ: **メディア／SNS運用の獲得基盤**（節税商材代理店事業・主力商材 ML）。将来の事業追加に耐えるよう `Business` 軸だけ持たせる。
> 改訂履歴: v1 静的HTML → v2 FastAPI+SPA → v3 Next.js全社基盤 → v4 スコープを獲得3ゴールに集約 → **v5 市場・競合・広告・鮮度・Notion完全移行を追加し、スキーマとロードマップを単一化**。改訂理由は §17
>
> **📌 この文書内での参照ルール（実装事故防止）**
> - **モデル定義は §3 のみ**（他セクションは §3 を参照する。再掲しない）
> - **ロードマップは §9 のみ**（各セクションの見積は §9 に統合済み）
> - **画面パネル番号は §4.1 が正**（段1=結果 / 段2=ファネル / 段3=買い手の質 / 段4=今週の変化 / 段5=次の一手 / 段6=施策の生死 / 段7=ジョブ健全性）

---

## 1. この システムが背負う役割

> **対象スコープ（2026-07-20 石井確定）: メディア／SNS運用。** 目的は次の3つの獲得を増やすこと。
> **① 直客の問い合わせ（最優先） ② 代理店開拓 ③ 公式LINE登録**
> 全社の手残り・他事業のP/L・時給管理は**対象外**（将来の拡張余地としてデータモデルに `Business` 軸だけ持たせる）。

| 役割 | 内容 |
|---|---|
| **① 獲得の可視化** | 獲得3ゴールの結果と、そこに至るファネル全段を1画面に |
| **② 買い手の質の可視化** | 「PVが増えた」ではなく「**買い手が増えた**」で判断できるようにする |
| **③ 自動運営** | 取得 → 判定 → 立案 → 実行 → 記録 のループを人手なしで回す |
| **④ PDCAを閉じる** | 打ち手ごとに判定日を予約し、対照群補正つきで効果を自動判定して学習に戻す |
| **⑤ 意思決定の記録** | 承認・却下・理由が全て残り、次の立案精度に反映される |

**人を雇わない代わりの装置**。従業員がやる「集計・報告・催促・記録・初動対応」を全部システムに寄せる。

### 1.1 ★このシステム自体の成功条件と撤退条件（要 石井合意）

> **設計上の矛盾を自己申告する**: 施策には撤退条件を必須にしておきながら（行動原則6）、**47日かけるこのシステム自体に成功条件も撤退条件も置いていなかった**。ここで定義する。

**仮説**
> 獲得3ゴール（直客・代理店・LINE）が伸びない原因は「何が効いているか見えないこと」であり、
> 計測とPDCAの自動化により、**同じ稼働で獲得件数が増える**。

**成功指標（M-A 到達＝15.0日 後の30日間で判定）**  ※日数は §9.3 が正（2026-07-20 石井決定）

| # | 指標 | 目標 | 測り方 |
|---|---|---|---|
| 1 | **問い合わせの経路特定率** | **100%** | 全リードに `firstTouchContentId` または `sourceType=phone_manual` が入っている |
| 2 | **リード数** | **月2件以上** | `Lead(type=direct_inquiry)` |
| 3 | **石井さんのコマンド実行回数** | **0回** | リマインダー方式のタスクが全て自動実行されている |
| 4 | 石井さんの「見えている」実感 | 主観でよい | 週1回以上ダッシュボードを開いているか（アクセスログ） |

**判定と撤退条件**

| 状況 | 判断 |
|---|---|
| 4つ中3つ以上達成 | **継続**。M-B以降へ進む |
| **2つ以上未達** | **以降のPhaseを止めて設計を見直す**（作り続けない） |
| 指標1が未達（経路が特定できない） | **最も重い失敗**。計測設計そのものが誤っている → M-A をやり直す |
| 指標2が未達だが1・3は達成 | システムは機能している。**問題は集客側** → MMSは継続し、打ち手を流入・転換に集中 |

**中間チェックポイント**: M-A の各Phase完了時に「予定日数を1.5倍超過していないか」を確認。超過していれば**その時点で残りのスコープを削る**。

> **止める勇気を先に決めておく。** 作り込むほど止めにくくなるため、着手前に基準を置く。

---

## 2. アーキテクチャ

### 2.1 スタック（確定案）

| 層 | 採用 | 理由 |
|---|---|---|
| **アプリ** | **Next.js 15（App Router）+ TypeScript** | Server Components でデータ取得を単純化。Route Handlers で Webhook 受口。Server Actions で承認ボタンが素直に書ける。1つのプロジェクトでフロント/APIが完結し、一人保守に最適 |
| **UI** | **shadcn/ui + Tailwind CSS + Recharts** | shadcn はコードが自分のリポジトリに入る＝バージョン依存で壊れない。Recharts は既存 Chart.js の代替として React に自然 |
| **DB** | **PostgreSQL 16（Docker Compose・ローカル）** | 全社基盤にするならSQLiteでは足りない。同時書込・型（JSONB/配列/enum）・マイグレーション管理・将来のVPS移行を考えると最初からPostgres |
| **ORM/マイグレーション** | **Prisma** | スキーマがコードで正。`prisma migrate` で変更履歴が残る。**「都度追加開発しても壊れない」の技術的担保はここ** |
| **認証** | **Auth.js（Email magic link）+ Cloudflare Access（二重）** | 全社基盤＝将来パートナーに一部を見せる可能性がある。最初から認証と権限を持たせる |
| **ジョブ** | **jobs テーブル + Python worker（常駐）** | 既存 `~/Documents/Claude/Projects/メディア事業部/.claude/scripts/` 40本超のPython資産を**書き直さずそのまま使う**。workerがjobsをポーリングして実行し、結果をDBに書く |
| **キャッシュ/リアルタイム** | Next.js の revalidateTag + SSE | Redis不要。規模に対して過剰 |
| **常駐** | **Docker Compose（web / db / worker）+ launchd** | Mac起動時に自動立ち上げ。`localhost:3000` |
| **外部公開** | **Cloudflare Tunnel（無料）+ Cloudflare Access** | スマホ閲覧。素のトンネル公開はしない |
| **AI実行** | **Claude Code（CLI/MCP）** | worker が「AIに任せるジョブ」を検出したら Claude Code を起動して実行させる |

**追加固定費: 0円**（全てOSS・Cloudflare 無料枠・サーバーはMac本体）

### 2.2 リポジトリ構成（モノレポ）

```
media-management-system/
├─ apps/
│  └─ web/                    Next.js 15（UI + API + Server Actions）
│     ├─ app/
│     │  ├─ (dashboard)/      ダッシュボード（事業横断）
│     │  ├─ media/            メディア実務（現 console.html の後継）
│     │  ├─ threads/          SNS運用
│     │  ├─ experiments/      施策管理（施策仮説シートのDB版）
│     │  ├─ jobs/             ジョブ監視
│     │  └─ api/
│     │     ├─ ingest/        Webhook受口（HMAC検証）
│     │     └─ webhooks/
│     └─ components/
├─ packages/
│  ├─ db/                     Prisma schema + migrations（唯一の正）
│  └─ shared/                 型定義・定数（TS）
├─ services/
│  └─ worker/                 Python常駐。jobsをポーリングして実行
│     └─ legacy/              既存 .claude/scripts/ をそのまま配置（改変せず呼ぶ）
├─ docker-compose.yml
└─ .env.example
```

**既存Python資産は書き直さない。** `gsc-fetch.py` `ingest.py` `validate-article.py` 等は worker から呼ばれるライブラリとして生き残る。これがスコープ爆発を防ぐ最大のポイント。

### 2.3 データフロー

```
[実行層]  WP / Threads GAS / AIOバッチ / LPフォーム / 代理店LP / ML営業システム
    │                                        │
    │ ① Webhook（即時・HMAC署名）             │ ② バッチ（日次/週次）
    ▼                                        ▼
┌─────────── Next.js /api/ingest/* ────────────┐
│                                               │
├──────────── PostgreSQL（唯一の正）────────────┤
│                                               │
├─ worker（Python常駐）                          │
│   jobs をポーリング → 既存スクリプト実行         │
│   → Claude Code 起動（立案・執筆・改稿）        │
│                                               │
└─ Next.js UI（Server Components）───────────────┘
        │
        ├─ localhost:3000（Mac）
        └─ Cloudflare Tunnel + Access（スマホ）
```

---

## 3. データモデル（Prisma・統合版 v4）★ここが唯一の正

> **§13・§14 で追加したモデルを本セクションに統合した。スキーマ定義はここだけを見る**（Singleton）。
> 設計方針: **獲得3ゴール（直客・代理店・LINE）に必要なものを全て持つ。汎用モデルに寄せてチャネル追加でスキーマを変えない。**

```prisma
// ══ 1. 事業・チャネル・目標 ══════════════════════
model Business {          // 節税商材代理店 / （将来）コンテンツ販売 …
  id, slug, name, status
  channels Channel[]  targets Target[]  experiments Experiment[]
}

model Channel {           // media / threads / instagram / line / agency_lp / note …
  id, businessId, type, accountRef, name, config Json   // accountRef=アカウント単位で分離
}

model Target {            // 目標（KPIツリーの階層を持つ）
  id, businessId, period, metric, targetValue
  tier          // north_star | leading | guardrail
  parentMetric? // ★KPIツリー: inquiries ← lp_view ← cta_click ← clicks ← impressions
}

// ══ 2. 計測（欠測とゼロを厳密に区別）══════════════
model MetricSnapshot {
  id, businessId, channelId?, metric, value, date, granularity
  @@unique([businessId, channelId, metric, date, granularity])
}

model MeasurementCoverage {   // ★★ 今回の事故（直客2件の見逃し）の再発防止
  id, metric, channelId?, startedAt, endedAt?, method, note
}
// 規約（絶対）:
//   行が存在しない        = 「未計測」。UI/APIは "—(未計測)" と表示し、決してゼロと書かない
//   value = 0            = 「実測ゼロ」
//   MeasurementCoverage に期間が無い指標は、集計・グラフ・briefから physically 除外する
//   → 「問い合わせ 0」と「問い合わせ 未計測」を二度と混同しない

// ══ 3. コンテンツ（記事・投稿・リール・LP を統一）══
model ContentItem {
  id, channelId, externalId          // ART-088 / THR-076 / LP-001
  type, title, url, status
  // ── 分類（旧Notion 記事パフォーマンス管理DB から移行）──
  articleType     // pillar | cluster | news | lp | reel | post
  isPillar Boolean, category, mainKeywordId?, charCount Int?
  eyecatchType, eyecatchColor, targetLabel
  wpPostId Int?, wpCategoryId Int?, tagIds Int[]
  // ── ★鮮度管理（3階層ケイデンス・content-standards.md 準拠）──
  publishedAt                        // 公開日
  infoBaseDate                       // 情報基準日（YMYL必須・記事内に表示）
  dataUpdatedAt                      // dateModified（★実質追記時のみ更新。cosmeticでは触らない）
  lastReviewedAt                     // 最終チェック日（記事に "last reviewed: YYYY-MM" として表示）
  freshnessTier   // breaking(即時) | commercial(60-90日) | evergreen(6ヶ月) | reference(12ヶ月)
  nextReviewDue                      // ★lastReviewedAt + tier日数（自動算出）
  reviewState     // fresh | due_soon(30日前) | overdue | in_rewrite
  // ── 品質ゲートの判定結果（旧Notion）──
  seoCheckPassed Boolean, complianceVerdict, factCheckVerdict
  validatorRun Json                  // validate-article / seo-lint / ai-tone / geo-checks の結果
  // ── AIO（旧Notion AIO計測DB）──
  aioTier         // hot | warm | cold | none
  aioTracked Boolean, aioTierUpdatedAt, aioNote
  // ── 買い手軸（2026-07-20 実データで訂正済み）──
  budgetTier      // high(1,000万〜) | mid(300〜1,000万) | low(〜300万) | unknown
  funnelStage     // awareness | comparison | product_deep | decision
  productFit String[]                // ML | IoTビーコン | 外貨両替機 | EV充電 | GPU …
  audience String[]                  // 参考: corporate | sole_proprietor | tax_accountant | agency_candidate
  buyerFitScore Int?
  impacts String[]                   // ★効く結果指標（必須・APIで弾く）
  note
  metrics ContentMetric[]  ctas Cta[]  reviews ArticleReview[]
}

model ArticleReview {     // ★リライト/レビューの履歴（いつ何を見て何をしたか）
  id, contentItemId, reviewedAt, reviewer      // ai | ishii
  kind          // periodic | triggered_by_rank | triggered_by_law | triggered_by_gsc
  findings Json                                 // 古くなった数値・失効した制度・順位低下
  outcome       // no_change | minor_fix | substantive_rewrite | archived
  updatedDataUpdatedAt Boolean                  // 実質追記だったか（cosmeticならfalse）
  interventionId?                               // 効果測定に接続
}

model FreshnessRule {     // 鮮度ケイデンスの定義（変更可能にする）
  id, freshnessTier, intervalDays, description
  // breaking=0(随時) / commercial=75 / evergreen=180 / reference=365
}

model ContentMetric {     // clicks / impressions / position / views / aio_hit …
  id, contentItemId, metric, value, date
}

model Cta {               // 記事内CTA（位置別に効果を測る）
  id, contentItemId, position   // hero | mid | final | sidebar
  variant, targetUrl, active
}

// ══ 4. ファネル7段（記事→問い合わせの間を全部измеる）══
model VisitorSession {
  id, visitorId, firstSeenAt, landingContentId?
  referrer, utm Json, fromParam      // ?from=media&article=ART-XXX
  pageviews, converted Boolean
}

model FunnelEvent {
  id, sessionId, occurredAt
  step        // cta_view | cta_click | lp_view | lp_scroll | form_view | form_field | submit
  contentItemId?, ctaId?, lpId?, meta Json
}

// ══ 5. リード・成約（獲得3ゴールを型で分ける）══════
model Lead {
  id, businessId, type               // direct_inquiry | agency | line_friend
  occurredAt, firstResponseAt?       // ★初動速度
  // 誰か
  companyType, budgetTier, interestProduct String[], urgency
  // どこから（first / last touch 両方）
  firstTouchContentId?, lastTouchContentId?, sourceKeywordId?, sourceChannelId?, sessionId?
  competitorsConsidered String[]     // ★「ビーコン/外貨両替機」のような比較対象 = 金脈KWの源泉
  // その後
  status                             // new | contacted | qualified | proposal | won | lost
  closedAmount Decimal?, closedAt?
  sourceType                         // form | phone_manual | line | threads_dm（§3.8.3）
  m2DealId?, m2SyncedAt?, m2Stage?   // ★商談以降は m2 が正（§3.8.4）
  m2ClosedAmount Decimal?, m2ClosedAt?
  touchpoints LeadTouchpoint[]
  note
}

// ══ 6. 代理店 ══════════════════════════════════
model AgencyLead {
  id, threadsUserId, receivedAt, sourcePostId    // どの投稿からのDMか
  stage       // received | screening_sent | answered | qualified | forwarded | contracted | rejected
  screeningAnswers Json, forwardedAt?, partnerId?
}
model Partner {
  id, name, parentPartnerId?, commissionRate, status
  lastDealAt?, dealCount, totalAmount            // 稼働しているか
}

// ══ 7. LINE ════════════════════════════════════
model LineFriend {
  id, lineUserId, addedAt, sourceContentId?, sourceParam
  tags String[], status, convertedLeadId?
}
model LineMessage {
  id, kind, sentAt, targetTags String[]
  delivered, opened, clicked, blocked
}

// ══ 8. KW・ネタ ════════════════════════════════
model Keyword {
  id, businessId, keyword, slug, volume, difficulty, cpc
  intent, budgetTier, funnelStage, productFit String[]
  priority, status
  assignments KeywordAssignment[]  research KeywordResearch[]  rankings KeywordRanking[]
}
model KeywordResearch {
  id, keywordId, fetchedAt, source, expiresAt        // 90日鮮度 → 30日前に自動再取得
  suggests Json, related Json, cooccurrence Json, competitorH2 Json, qaQuestions Json
}
model KeywordAssignment {
  id, keywordId, contentItemId, role                 // main | sub
  @@unique([keywordId, role])                        // ★main重複＝カニバリをDB制約で検出
}
model KeywordRanking { id, keywordId, date, position, clicks, impressions, ctr }

// ══ 8.4 トピッククラスタ（ピラー/クラスター・★2026-07-20 追加）══
model TopicCluster {
  id, businessId, name, slug
  parentId?                     // ★ツリー構造（大項目 → 中項目 → 小項目）
  pillarContentId?              // このクラスタのピラー記事（無ければ pillar_missing）
  pillarType                    // A_standard | B_news | C_risk（3本柱・manuals/three-pillar-strategy.md）
  productFit, budgetTier, funnelStage
  targetKeywordId?              // クラスタが狙う中心KW
  state                         // healthy | pillar_missing | thin | cannibalized | orphan | overgrown
  members ContentCluster[]  metrics ClusterMetric[]
}

model ContentCluster {          // 記事 ↔ クラスタ（★多対多。1記事が複数クラスタに属せる）
  id, contentItemId, clusterId
  role                          // primary（ツリー表示に使う・1記事1つ） | secondary
  @@unique([contentItemId, clusterId])
}

model InternalLink {            // 内部リンクグラフ（現 media.db links の正規版・599本）
  id, srcContentId, dstContentId, anchorText?, contextSection, detectedAt
  linkType                      // cluster_to_pillar | pillar_to_cluster | cluster_to_cluster | cross_pillar
}

model ClusterMetric {           // ★グループ単位の集計（記事単位ではノイズが多すぎる）
  id, clusterId, date, granularity
  articleCount, pillarPresent Boolean
  impressions, clicks, avgPosition, pv
  top3Count, top10Count, top20Count
  leads, deals, revenue Decimal          // ★グループ別のCV貢献（最重要）
  buyerFitClickShare Float               // 買い手適合クリックの割合
  marketVolume, clickShare               // §3.3 と接続
  linkHealthScore Float                  // 相互リンク充足率（0-1）
  cannibalCount Int                      // 同一クラスタ内のmain KW重複
}

// ══ 8.5 市場規模・シェア・競合（★2026-07-20 追加）══
model KeywordVolume {     // 検索ボリュームは変動する → 履歴で持つ
  id, keywordId, month, volume, source        // rakko | dataforseo
  @@unique([keywordId, month, source])
}

model KeywordCluster {    // 市場を「商材／テーマ」単位で束ねる
  id, businessId, name, productFit            // ML | IoTビーコン | 外貨両替機 | GPU | オペリース …
  keywords Keyword[]
}

model SerpSnapshot {      // 対象KWの検索結果1〜20位を丸ごと保存（競合の動きを追う）
  id, keywordId, date, position, domain, url, title
  isOurs Boolean, hasAiOverview Boolean, aioCitedDomains String[]
  @@unique([keywordId, date, position])
}

model Competitor {        // 競合ドメインの強さ
  id, domain, label, isTracked
  metrics CompetitorMetric[]
}
model CompetitorMetric {  // 追跡KW群における相対的な強さ（月次）
  id, competitorId, month
  top3Count, top10Count, avgPosition
  estimatedClicks, shareOfClicks              // CTR曲線から推定
  rankedKeywords Int?                         // DataForSEO Domain Analytics（任意）
  backlinks Int?, refDomains Int?             // DataForSEO Backlinks（任意）
}

model CtrCurve {          // ★自社GSC実測から作る順位別CTR（外部の一般値より精度が高い）
  id, position, ctr, sampleSize, calculatedAt
  segment                                     // all | comparison | product_deep …
}

model MarketShare {       // クラスタ単位のシェア（月次・自動算出）
  id, clusterId, month
  marketVolume            // Σ KeywordVolume（＝ニーズ規模）
  ourImpressions, ourClicks
  impressionShare, clickShare                 // SOV
  top3Rate, top10Rate, top20Rate              // 1ページ目食い込み率
  aioCitationRate
}

model Opportunity {       // ★機会損失の定量化（優先順位の根拠）
  id, keywordId, month
  volume, currentPosition, currentClicks
  targetPosition, potentialClicks
  clickGap                                    // potential - current
  estimatedLeads Float?                       // clickGap × 実測CV率
  effortScore, priorityScore                  // 難易度と掛けて自動採点
  paidCpc Float?                              // ★同じKWを広告で買った場合の単価
  paidCostToMatch Float?                      // ★同じクリック数を広告で買う金額 → SEO vs 広告の比較
}

// ══ 8.6 有料広告（★2026-07-20 追加）══════════════
model AdAccount   { id, businessId, platform, externalId, name, status }
                  // google_ads | meta | yahoo | line
model AdCampaign  { id, adAccountId, externalId, name, objective, targetLpId?
                    dailyBudget, status, startedAt, endedAt? }
model AdGroup     { id, campaignId, externalId, name, keywords String[], audience Json }
model AdCreative  { id, adGroupId, externalId, headline, body, imageUrl?, landingUrl, status }

model AdMetricDaily {     // 日次実績（媒体APIから自動取得）
  id, campaignId, adGroupId?, creativeId?, date
  impressions, clicks, cost Decimal, conversions
  cpc, ctr, cpa                                  // 自動算出
  @@unique([campaignId, adGroupId, creativeId, date])
}

model UnitEconomics {     // ★広告・投資可否の判断基準（経路別に持つ）
  id, businessId, productFit, month
  acquisitionChannel                             // ★direct | agency（粗利が違うので必ず分ける）
  unitPrice Decimal                              // 240万
  ourSharePct Float                              // 20%
  partnerCommissionPct Float?                    // 代理店経由なら 7.5%
  grossProfitPerUnit Decimal                     // direct=48万 / agency=30万
  avgUnitsPerDeal Float                          // 実績: 2台/件（母数1・要蓄積）
  leadToDealRate Float                           // 問い合わせ→成約率（未実測）
  maxCpa Decimal                                 // = grossProfitPerUnit × avgUnits × leadToDealRate
  directPremium Decimal?                         // ★直客−代理店 = 18万/台。獲得コストの上限判断に使う
  actualCpa Decimal?, roas Float?
  provenance                                     // measured | declared | estimated
}

model AdSimulation {      // ★シミュレーション（順算・逆算の両方）
  id, businessId, name, mode                     // forward(予算→成果) | reverse(成果→予算)
  createdAt, scenario                            // conservative | base | optimistic
  inputs Json    // 対象KW群 / 想定CPC / 想定CTR / LP CVR / 成約率 / 粗利
  outputs Json   // クリック数 / 問い合わせ数 / 成約数 / 売上 / 利益 / CPA / ROAS / 回収期間
  assumptionSource Json                          // 各前提が実測かベンチマークか
  actualLinkedCampaignId?                        // 実配信後に予実差分を自動照合
}

model Idea {
  id, businessId, title, body
  source      // gsc_gap | rakko_paa | news | threads_hit | aio_miss | lead_competitor | manual
  sourceRef Json, impacts String[], budgetTier, funnelStage
  estValue, state, keywordId?, contentItemId?
}

// ══ 9. PDCA（Plan-Do-Check-Act を型で持つ）════════
model Experiment {        // Plan（施策単位・撤退条件つき）
  id, businessId, name, hypothesis
  successMetric, successThreshold, startedAt, evaluateAt, exitCondition
  state      // running | won | lost | withdrawn
  interventions Intervention[]
}

model Action {            // Do（打ち手・段5「次の一手」に並ぶ）
  id, businessId, experimentId?, type   // ★下表の打ち手タイプ
  title, rationale, impacts String[], proposedBy
  state      // proposed | prepared | awaiting_approval | approved | rejected | done | failed
  preparedArtifact Json
  events ActionEvent[]  intervention Intervention?
}
model ActionEvent { id, actionId, event, reason, actorId, at }   // 却下理由＝学習データ

model Intervention {      // Check（実行された変更＝効果測定の単位）
  id, actionId, contentItemId?, keywordId?, type
  appliedAt, evaluateAt                // appliedAt + 判定期間（打ち手タイプごと）
  baseline Json                        // 適用前28日の実測
  result Json                          // 適用後28日の実測
  controlDelta Float?                  // ★対照群（無変更の同カテゴリ記事）のトレンド
  netEffect Float?                     // result - baseline - controlDelta
  verdict    // pending | positive | neutral | negative | inconclusive
}

model Learning {          // Act（学び。Interventionの判定から自動生成される）
  id, businessId?, experimentId?, interventionId?, body, at
}
model Decision { id, title, decision, rationale, alternatives, decidedAt }

// ══ 10. ジョブ ═════════════════════════════════
model Job    { id, name, schedule, kind, config Json, enabled, runs JobRun[] }
model JobRun { id, jobId, startedAt, finishedAt, status, log, metrics Json }
```

### 3.1 設計上の要点

- **汎用モデル（Business / Channel / Metric / ContentItem / Lead / Action）** に寄せてある → Instagram / note / 新規事業の追加でスキーマを変えない
- **`MeasurementCoverage` は今回の事故の再発防止装置**。「未計測」を「0」と表示したせいで**直客2件の成約に気づけなかった**。二度と起こさないため、規約をスキーマで担保する
- **`Lead.competitorsConsidered`** — 初の直客が「ビーコン／外貨両替機」を比較していた事実から追加。**比較対象＝次に書くべきKWの直接の情報源**
- **`Intervention.controlDelta`** — 対照群補正。これが無いと「季節変動で上がっただけ」を「施策が効いた」と誤判定する
- **`KeywordAssignment` の unique 制約** でカニバリをDB層で検出

### 3.2 履歴の保持方針（PV・表示回数・掲載順位）

#### 3.2.1 現状の蓄積（media.db 実測・2026-07-20）

| データ | 粒度 | 保持期間 | 件数 |
|---|---|---|---|
| `daily_site`（サイト全体: クリック/表示/順位） | 日次 | 2026-04-14 〜 **2026-07-10** | 88 |
| `daily_page`（記事別: クリック/表示/順位） | 日次 | 2026-04-16 〜 **2026-07-10** | 3,753 |
| `daily_pv`（記事別PV） | 日次 | 2026-04-14 〜 2026-07-13 | 1,579 |
| `article_weekly`（記事別スナップショット） | 週次 | 2026-06-15 〜 2026-07-13 | 572 |
| `query_weekly`（クエリ別） | 週次 | 2026-06-15 〜 2026-07-13 | 1,000 |

**判明した問題**
1. **日次GSCが 2026-07-10 で止まっている**（本日 07-20 時点で**約10日欠測**。GSCの反映遅延2〜3日を考慮しても取りこぼし）
2. **週次スナップショットは5週分しかない**（2026-06-15 開始）。「3ヶ月前と比べてどうか」が現時点では答えられない
3. 日次も**約3ヶ月分**のみ

> これが「欠測検知（§4.1 段7）」を最優先で入れる理由。**取りこぼしに気づく仕組みが無いまま10日分が消えている。**

#### 3.2.2 保持方針（MMS）

| 方針 | 内容 |
|---|---|
| **日次を永久保持** | `ContentMetric` / `KeywordRanking` に日次で入れ、**削除しない**。記事200本×5指標×365日でも年36万行＝Postgresでは些少 |
| **★GSC APIは16ヶ月しか遡れない** | それ以前のデータはGoogleから取得不能。**自前DBに貯め続けることだけが唯一の長期履歴**になる。日次ジョブを止めない運用が資産価値そのもの |
| **欠測の自動補填（backfill）** | 日次ジョブは「最終取得日〜昨日」の欠けている日を毎回チェックして埋める。1日失敗しても翌日に自動回復する |
| **欠測アラート** | 3日以上の欠測を段7で赤表示。今回の10日欠測は本来ここで検知される |
| **初回に既存データを全移行** | media.db / timeseries.db の日次・週次を全てPostgresへ。**過去3ヶ月を失わない** |

#### 3.2.3 見え方（何がどう追えるか）

| 見たいもの | 実現 |
|---|---|
| 記事別の PV / 表示 / クリック / 掲載順位の**日次推移** | `/content/[id]` に折れ線グラフ（7日移動平均つき） |
| サイト全体の推移 | `/` と `/content` |
| KW別の**順位推移** | `/keywords/[id]`。striking distance の出入りが視覚化される |
| 期間比較（7 / 28 / 90日 / 任意） | サーバー側集計。前期間との差分を全指標で自動算出 |
| 記事間の比較 | 複数記事を重ねて表示 |
| **★変更履歴の注釈（annotation）** | グラフ上に **公開日・リライト日・タイトル変更日・CTA変更日**（`Intervention.appliedAt`）を縦線マーカーで重ねる |

**注釈がPDCAの要**。「6/20に順位が上がった」だけでは意味がなく、「**6/18にタイトルを変更した2日後に上がった**」と見えて初めて因果が読める。現行の console.html にはこの機能が無い。

### 3.3 市場規模・シェア・競合の測定（★2026-07-20 追加）

> 石井指摘「市場規模も測定できる方がよい。KWから月間のニーズ規模、どれぐらいのシェアを取れているか、トップページに食い込めているか。競合サイトの順位やSEOの強さも比較したい」
>
> **設計の反省**: 私は「既にあるデータをどう見せるか」から設計を始めたため、**自社の内側しか見ない設計**になっていた。正しくは「勝つために何を知る必要があるか」から始める。外部（市場・競合）が抜けていた。

#### 3.3.1 市場規模（ニーズ規模）をどう出すか

**GSCの「表示回数」は市場規模ではない。** 表示回数は「自社が表示された回数」であり、自社が圏外のKWはゼロとして扱われる。市場を見るには**検索ボリューム**が要る。

```
市場規模（クラスタ単位）= Σ KeywordVolume.volume
```

| クラスタ例 | 構成KW | 意味 |
|---|---|---|
| 即時償却 商材比較 | 即時償却 商品 比較 / IoT節税 商材 比較 / 節税商品 選び方 利益規模 … | **買い手が最も近い戦場** |
| 外貨両替機 | 外貨両替機 節税 / リスク / 業者選び / 税務調査 … | 商材別の需要規模 |
| IoTビーコン | IoTビーコン 節税 / 税務調査 … | 同上 |
| 経営強化税制 | 中小企業経営強化税制 / 経営力向上計画 申請 … | 制度需要（上流） |

**取得元**: ラッコ（既に3ヶ月分・40KW超取得済み）＋ DataForSEO Keyword Data API。**ボリュームは変動するため `KeywordVolume` に月次で履歴保存**する（スナップショットで持たないと「市場が伸びているか」が分からない）。

> ⚠️ 検索ボリュームは**推定値**（Google Keyword Plannerの丸め・各ツールの推定）。絶対値を信じず、**相対比較と推移**で使う。

#### 3.3.2 シェア（SOV）をどう出すか

```
表示シェア = 自社impressions ÷ クラスタのmarketVolume
クリックシェア = 自社clicks ÷ Σ(volume × CTR曲線[自社順位])
```

**★CTR曲線は自社GSC実測から作る。** `daily_page` に position と ctr が既にあるので、順位別の実測CTRを自前で算出できる（`CtrCurve`）。**業界一般値より自社の実態に合う**。セグメント別（comparison / product_deep）に分けるとさらに精度が上がる。

#### 3.3.3 トップページ食い込み率

```
Top3率  = 追跡KWのうち順位≤3 の割合
Top10率 = 順位≤10（1ページ目）
Top20率 = 順位≤20（striking distance 含む）
```

**現状の実測（2026-07-13 週次サマリー）: 4〜10位に78本が滞留、1〜3位は0本。** つまり Top10 には入っているが Top3 が取れていない。**CTRは順位1〜3位で跳ね上がるため、ここが最大の伸びしろ**であることが数値で示せる。

#### 3.3.4 機会損失の定量化（★優先順位の根拠になる）

```
機会クリック = volume × CTR曲線[目標順位] − 現在のclicks
推定リード   = 機会クリック × 実測CV率（Lead / clicks）
```

**例（構造の説明。数値は仮）**
| KW | vol | 現順位 | 現clicks | 3位なら | 機会 |
|---|---:|---:|---:|---:|---:|
| 即時償却 商品 比較 利回り | 1,000 | 12位 | 10 | 110 | **+100クリック/月** |
| 小規模企業共済 シミュレーション | 2,900 | 14位 | 25 | 320 | +295（ただし `budgetTier=low`） |

→ **`Opportunity` は volume だけでなく `budgetTier` で重み付けする。** ボリュームが大きくても買い手でないKWに投資しない（2026-07-20 の直客実データによる訂正を反映）。

これにより打ち手の優先順位が「感覚」から **「このKWを3位に上げると問い合わせが月X件増える」** に変わる。

#### 3.3.5 競合の強さ

`SerpSnapshot` で追跡KWの1〜20位を丸ごと保存する。これ1本で以下が全部出る。

| 見たいもの | 算出 |
|---|---|
| 競合ごとの Top3 / Top10 獲得数・平均順位 | `SerpSnapshot` の集計 |
| 競合の推定クリック・**クリックシェア** | 順位 × CTR曲線 × volume |
| **自社が圏外のKW（空白地帯）** | `isOurs=false` のKW抽出 |
| 競合の順位変動（誰が伸びているか） | 日付軸で差分 |
| **AI Overview に誰が引用されているか** | `hasAiOverview` / `aioCitedDomains` ← **既存のAIO計測と統合** |

**任意で追加可能**: DataForSEO の Domain Analytics（競合の総獲得KW数）・Backlinks（被リンク・参照ドメイン数＝ドメインの強さ）。Ahrefs（月$129〜＋Brand Radar $199〜）は不要。

**コスト実測**: DataForSEO SERP は **$0.60 / 1,000 SERP**。追跡300KW × 週次 = 1,200 SERP/月 = **約$0.72/月（約110円）**。日次にしても約$5/月。**ほぼ無視できる。**

#### 3.3.6 AI Overview 時代の補正（重要）

AIOが表示されるKWでは、**順位が高くてもクリックされない**。従来のCTR曲線が崩れる。

- `SerpSnapshot.hasAiOverview` を持つことで、**AIO有無でCTR曲線を分ける**
- 「Top3を取ってもAIOに食われてクリックが来ないKW」と「クリックが来るKW」を区別して投資判断できる
- 既存のAIO計測（693試行→hit率1.2%）と統合し、**AIO引用シェア**も競合比較の軸にする

#### 3.3.7 画面 `/market`

| セクション | 内容 |
|---|---|
| 市場規模 | クラスタ別の月間検索ボリュームと**推移**（市場が伸びているか） |
| シェア | 表示シェア／クリックシェア／AIO引用シェアの推移 |
| 順位分布 | Top3 / Top10 / Top20 の本数と推移（**1〜3位0本からの脱出が見える**） |
| 機会損失ランキング | `Opportunity` を priorityScore 順。**次に何を書く／直すかの根拠** |
| 競合比較 | ドメイン別の Top3/Top10 数・平均順位・推定クリックシェア・AIO引用数 |
| 空白地帯 | 自社が圏外かつ競合も弱いKW（`isOurs=false` × 上位ドメインが分散） |

#### 3.3.8 ロードマップ追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。

### 3.4 有料広告の検討・予測・運用（★2026-07-20 追加）

> 石井指摘「本来広告を回すことも検討すべきか。LPなど。**いくらかかりそうでどれくらい見込めそうなどの予測や提案**も本来はあった方がよい」

#### 3.4.1 なぜ広告を設計に入れるべきか

**SEOは在庫、広告は蛇口。** 性質が根本的に違う。

| | SEO | 広告 |
|---|---|---|
| 立ち上がり | 3〜6ヶ月（記事が順位を取るまで） | **即日** |
| コスト構造 | 石井さんの時間（変動しない） | 変動費（止められる） |
| 検証速度 | 遅い（1記事の成否に数ヶ月） | **速い（数日でKWの反応が分かる）** |
| 蓄積 | 資産になる | 止めたらゼロ |

**現状の問題**: 直客の実績がまだ1件で、「どのKW・どの訴求が買い手を連れてくるか」の検証に**SEOだと数ヶ月かかる**。広告なら数日で分かる。

→ **広告の第一の役割は集客ではなく「KW・訴求の高速検証装置」**。そこで勝ったKWにSEO記事を投下する、という順序が最も効率が良い。

#### 3.4.2 判断基準は1つだけ — 上限CPA

```
上限CPA = 1成約あたりの当社粗利 × 問い合わせ→成約率
```

これを超える獲得単価なら赤字。下回るなら**理論上いくらでも回してよい**。

#### ★実数（2026-07-20 石井確定）

> **主力商材は ML（マイグレーションライト）に固定。** 当社は事業本部に参画しており、最も伸ばしたい商材。

| 項目 | 値 | 出所 |
|---|---|---|
| 1台の販売価格 | **240万円（税抜）** | 石井確定 2026-07-20 |
| 当社取り分（総枠） | **20% ＝ 48万円 / 台** | 同上 |
| 代理店手数料（新規契約のベース） | **7.5% ＝ 18万円 / 台** | 同上 |
| **① 直客の粗利** | **48万円 / 台** | 同上 |
| **② 代理店経由の粗利** | **30万円 / 台**（12.5%） | 同上 |
| **③ 直客プレミアム** | **18万円 / 台** | 算出 |
| 実績（初の直客） | 1問い合わせ → **2台成約 → 粗利 96万円** | 2026-07-20 |

**→ 直客1件は代理店経由1.6件分の価値（48万 ÷ 30万）。**
**→ 「直客が最も欲しい」は感覚ではなく、粗利構造として正しい。**

**★意思決定の基準線**
```
直客の獲得コストが 18万円/台（2台なら36万円/件）を下回る限り、代理店経由より儲かる
```
この基準は上限CPAとは別軸の判断材料。**広告・LP・SEOへの投資は、直客ベース（粗利48万）で評価する。**

#### 上限CPA（成約率別）

```
上限CPA = 1成約あたり粗利 × 問い合わせ→成約率
```

| 問い合わせ→成約率 | 1台想定（粗利48万） | 2台想定（粗利96万） |
|---:|---:|---:|
| 10% | 4.8万円 | 9.6万円 |
| 20% | **9.6万円** | 19.2万円 |
| 30% | 14.4万円 | 28.8万円 |
| 50% | 24万円 | 48万円 |

> ⚠️ 成約率は**未実測**（実績は1問い合わせ→1成約＝100%だが母数1で使用不可）。上表は構造を示すもの。
> 実務では**保守側（成約率10〜20%・1台想定）＝上限CPA 5〜10万円**を初期の判断線に置く。

#### 損益分岐 LP CVR

```
必要CVR = CPC ÷ 上限CPA
```

| CPC | 上限CPA 4.8万（保守） | 上限CPA 9.6万（基準） |
|---:|---:|---:|
| 300円 | 0.63% | 0.31% |
| 500円 | 1.04% | 0.52% |
| 1,000円 | 2.08% | **1.04%** |
| 2,000円 | 4.17% | 2.08% |

**BtoBのLP CVRは一般に1〜3%程度とされる。** つまり **CPC 1,000円までなら基準シナリオで成立する可能性が高い**。
→ **ML は広告と相性が良い商材**（単価240万・粗利48万＝1件あたりに数万円払える）。

#### ★時間 vs 金の比較（行動原則10）

石井さんの目標時給は3.5万円。**記事1本に5時間 = 17.5万円相当のコスト**。

| 投下先 | 17.5万円で得られるもの（推定） |
|---|---|
| 記事1本（SEO） | 順位が付くまで3〜6ヶ月。成果は不確実だが**資産として残る** |
| 広告17.5万円 | 上限CPA 4.8万なら **問い合わせ約3.6件**（即時・ただし止めたら消える） |

**→ 短期の獲得は広告が有利、長期の資産形成はSEOが有利。** システムは両方を同一画面で比較できるようにする（`/ads` の「SEO vs 広告」）。

#### 3.4.3 コストの見積もりは既に材料がある

ラッコ取得済みの `rakko-monthly-manifest.yaml` に**既にCPCが入っている**（例: 「事業承継税制 延長」 vol 320 / difficulty 38 / **cpc 2.69**）。

→ **追跡KWのCPCとボリュームから、広告費の概算は今すぐ試算可能**。DataForSEO Keyword Data API でも取得できる。

```
月間広告費の目安 = Σ(KWのvolume × 想定CTR × CPC)
```

#### 3.4.4 シミュレーション（順算と逆算の両方を持つ）

**順算モード（予算 → 成果）**
```
予算 → ÷CPC → クリック数 → ×LP CVR → 問い合わせ数
     → ×成約率 → 成約数 → ×粗利 → 利益 / ROAS
```

**★逆算モード（成果 → 予算）— 実務ではこちらが重要**
```
「問い合わせを月5件取りたい」
 → ÷成約率・CVR → 必要クリック数 → ×CPC → 必要予算
```

**3シナリオ（保守/基準/楽観）**で出し、前提が実測かベンチマークかを `assumptionSource` に明記する。**LP CVRは自社実測がまだ無い**ため、初回は必ずベンチマーク＝推定として扱う。

#### 3.4.5 実行手順（いきなり本番を回さない）

| Step | 内容 | 目的 |
|---|---|---|
| 1 | **小額テスト（例: 10万円 / 2〜3週間）** | 実CPC・実LP CVRを取る。**推定を実測に置き換える** |
| 2 | 実測でシミュレーションを再計算 | 上限CPAを超えないか判定 |
| 3 | 超えなければ段階的に増額。超えたら停止 or LP改善 | — |
| 4 | 広告で勝ったKW・訴求を**SEO記事とThreadsに展開** | 検証結果を資産に変える |

> **小額テストを飛ばして本番予算を投じない。** LP CVRの実測が無い状態のシミュレーションは、前提が1つズレると結論が10倍変わる。

#### 3.4.6 媒体候補と注意点

| 媒体 | 適性 | 注意 |
|---|---|---|
| **Google検索広告** | ◎ 最有力。「即時償却 商材 比較」等のインテントKWを直接買える | **金融・投資関連の広告ポリシー**に抵触する可能性。節税商材が「金融サービス」と判定されると審査が厳しい。要事前確認 |
| Yahoo!検索広告 | ○ 経営者層の利用が一定ある | 同上 |
| Meta（FB/IG） | △〜○ 経営者ターゲティング可。ただし顕在層ではない | 同上＋クリエイティブ審査 |
| LINE広告 | △ LINE登録との相性は良い | — |

**⚠️ YMYL領域のリスク**: 税務・節税は広告審査が厳しい領域。「必ず節税できる」「税金がゼロに」等の断定表現は**既存の tax-accuracy ルールで禁止済み**だが、広告文でも同じ基準を適用する。**不承認が続く場合、広告チャネル自体が使えない可能性がある** — これは事前に小額テストで確認すべき事項。

#### 3.4.7 自動運用とPDCA

| 周期 | 処理 |
|---|---|
| 日次 | Google Ads API / Meta Marketing API から `AdMetricDaily` を自動取得 |
| 日次 | `gclid` / `utm` で **`Lead` と突合** → 広告経由の問い合わせを特定（自社CVを媒体の自己申告に依存しない） |
| 週次 | CPA を上限CPAと比較 → **超過なら段5に「停止/減額提案」を自動起票**、下回るなら「増額提案」 |
| 週次 | 予実差分（`AdSimulation` vs 実績）を自動照合し、前提値を実測で更新 |
| 週次 | **同一KWのSEO vs 広告コスト比較**（`Opportunity.paidCostToMatch`）→ どちらに投資すべきか提示 |

#### 3.4.8 画面 `/ads`

| セクション | 内容 |
|---|---|
| ユニットエコノミクス | 上限CPA・実CPA・ROAS・損益分岐CVR |
| シミュレーター | 順算/逆算・3シナリオ。**前提値を触ると即再計算** |
| キャンペーン実績 | 日次コスト・クリック・CV・CPA推移 |
| 予実差分 | シミュレーション vs 実績。前提のどれがズレたか |
| SEO vs 広告 | KW別に「SEOで上げるコスト」と「広告で買うコスト」を並べる |
| LP別成績 | 広告×LPのA/B（PRJ-029のLP AB基盤と統合） |

#### 3.4.9 ロードマップ追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。

---

### 3.5 トピッククラスタ（ピラー／クラスター）の管理 ★石井指摘（2026-07-20）

> 「記事はピラーやクラスターで管理できるように。可能ならツリー状で。いくつピラーがあっていくつクラスターがあるか、各ピラーグループで数値的にはどうか——さまざまな検討箇所があると思うがどう思う？」

#### 3.5.1 私の見解 — 単純なツリーでは破綻する

**記事は同時に複数の軸に属します。** 例えば ART-112「外貨両替機 リスク」は：

- **柱**: C（リスク中立・`~/Documents/Claude/Projects/メディア事業部/manuals/three-pillar-strategy.md`）
- **商材クラスタ**: 外貨両替機
- **ファネル段階**: product_deep
- **買い手層**: budgetTier=high

これを1本の親子ツリーに押し込むと、必ずどこかで矛盾します。

**→ 解: `TopicCluster` を親子ツリーで持ちつつ、記事は複数クラスタに所属可（多対多）。ただし `role=primary` を1つだけ決める。**
ツリー表示は primary で描き、分析は多次元で行う。これで「見た目のシンプルさ」と「分析の自由度」を両立します。

#### 3.5.2 ★数を数えるより重要なこと — 内部リンク構造

**トピッククラスタの本質は「数」ではなく「リンク構造」です。** ピラーが10本あっても、クラスターからピラーへリンクが張られていなければ権威は集約されず、ただの記事の山です。

幸い **`media.db` の `links` に内部リンク599本が既にある**ので、**今すぐ以下が検出できます**。

| 検出項目 | 意味 |
|---|---|
| **クラスター → ピラー のリンクが無い記事** | 権威がピラーに集約されていない（最も多い不備） |
| **ピラー → 各クラスター のリンク欠落** | ピラーがハブとして機能していない |
| **クラスター同士の過剰リンク** | 権威が横に分散し、ピラーが育たない |
| **孤児記事**（どのクラスタにも属さない） | 戦略上の位置づけが無い記事 |
| **ピラー不在のクラスタ群** | クラスターだけあってピラーが無い＝受け皿が無い |

→ `linkHealthScore`（相互リンク充足率）としてグループ別にスコア化し、段1に表示する。

#### 3.5.3 ★グループ単位に束ねると、初めて統計的に意味が出る

現状は**クリック142/週 ÷ 157本 = 1本あたり週1件未満**。記事単位の数値はノイズだらけで、増減が偶然か施策の効果か判別できません。

**グループ（クラスタ）単位に束ねれば母数が10〜30倍**になり、有意な比較ができます。
**これは §16.5 の「対照群が作れない」問題の解にもなります** — 記事単位ではなくクラスタ単位で対照群を組めばサンプルが足ります。

#### 3.5.4 見るべき指標（グループ別）

| カテゴリ | 指標 | 判断 |
|---|---|---|
| **構造** | ピラー数 / クラスター数 / **ピラーあたりクラスター数** | 適正 5〜15本。**3本未満=thin**（受け皿が薄い）／**20本超=overgrown**（分割候補） |
| 構造 | `linkHealthScore` | 0.8未満は要修復 |
| 構造 | カニバリ数（同一クラスタ内のmain KW重複） | 1件でも要整理 |
| **成果** | クリック / 表示 / 平均順位 / Top3・Top10本数 | グループ間で比較 |
| **成果** | **リード数・成約数・売上** | **★最重要。どのグループが直客を生んだか** |
| 成果 | buyer-fit クリック比率 | 買い手が来ているグループか |
| **市場** | 市場規模（Σ検索ボリューム）／クリックシェア | §3.3 と接続 |
| **投資** | 記事数 × 制作時間 vs 成果 | 伸ばす／畳む／新設の判断 |

#### 3.5.5 ★これで初めて言える判断（今は言えない）

| 判断 | 根拠になる指標 |
|---|---|
| **どのピラーグループに次の記事を投下すべきか** | 市場規模 × クリックシェア × buyer-fit × リード実績 |
| **畳むべきグループはどれか** | 記事数は多いが buyer-fit も リードもゼロ（例: 低予算テーマ群） |
| **新設すべきグループはどこか** | **市場規模はあるがクラスタが存在しない**（§3.3 の空白地帯と直結） |
| **ピラーが弱い** | ピラー記事の順位がクラスター平均より低い ＝ **権威が集約されていないアンチパターン** |
| **リンク修復の優先順位** | `linkHealthScore` 低 × 市場規模 大 |

#### 3.5.6 ツリー表示（画面 `/clusters`）

```
📁 即時償却・節税商材（市場 12,400/月・シェア 3.1%）        🟡 link 0.62
├─ 🏛 ART-074 主力5商材を徹底比較 [ピラー] 12.4位          ← ピラーが弱い ⚠️
│  ├─ 📄 ART-097 即時償却 商品 比較 利回り        8.2位  ✅→ピラーリンク有
│  ├─ 📄 ART-129 IoT節税 商材 比較              14.1位  ❌→ピラーリンク無
│  └─ 📄 ART-096 節税商品 選び方 利益規模        9.8位  ✅
│     └─ リード 1件・成約2台・粗利96万 ★このグループが直客を生んだ
├─ 📁 外貨両替機（市場 3,200/月・シェア 8.4%）             🟢 link 0.91
│  ├─ 🏛 ART-076 外貨両替機の即時償却スキーム [ピラー] 6.1位
│  └─ 📄 ART-094/112/113/114/115/116/117（7本）
└─ 📁 IoTビーコン（市場 880/月・シェア 12%）               🟢 link 0.88
   ├─ 🏛 ART-186 [ピラー] 5.4位
   └─ 📄 ART-187（1本）  ⚠️ thin（クラスター1本のみ）
```

各ノードに **記事数・順位・市場規模・シェア・リード・リンク健全度**を並べ、**赤/黄のノードだけを展開する**モードを持たせる。

#### 3.5.7 移行時にやること

1. 既存157記事に `TopicCluster` を自動割当（`main_kw`・`productFit`・内部リンクグラフから推定 → AIが提案 → 石井が承認）
2. `links`（599本）を `InternalLink` に正規化し `linkType` を判定
3. **初回スキャンで「ピラー不在」「thin」「リンク不備」「孤児」の一覧を出す** ← ここで現状の実態が初めて見える
4. PRJ-031 WS-C（カニバリ整理・Pillar/Cluster再設計）は、このスキャン結果を入力として実行する

> **現状、ピラーが何本でクラスターが何本かを正確に答えられる場所が存在しません。** 週次サマリーは Pillar/Cluster を出そうとしていますが、実際の出力は両方 "Cluster" になっており**集計が壊れています**（2026-07-13 サマリーで確認）。移行時にここも正します。

---

### 3.6 記事ライフサイクル全体の棚卸し — 残る7つの欠損 ★2026-07-20

> 石井質問「他にメディア記事を管理する上（結果を出すために）管理しておくポイントはないか？」
> 記事の一生（企画→制作→公開→流入→転換→保守→終息）を全工程で洗い直した結果、**まだ7つ抜けていた**。

#### 3.6.1 ★① インデックス状況 — 最も基本的で、最も致命的

**インデックスされていない記事はクリック0が確定する。** 順位もCTRも意味がない。にもかかわらず現設計に無い。

```prisma
model IndexStatus {
  id, contentItemId, checkedAt
  coverageState      // indexed | crawled_not_indexed | discovered_not_indexed | excluded | error
  canonicalUrl, isCanonicalSelf Boolean
  robotsDirective, lastCrawledAt, sitemapIncluded Boolean
  richResultValid Boolean, richResultErrors Json   // JSON-LD の妥当性
  mobileUsable Boolean
}
```

- **GSC URL Inspection API** で自動取得（既存 `~/Documents/Claude/Projects/メディア事業部/.claude/scripts/` に `batch_url_inspection` 相当のMCPツールあり）
- **未インデックス記事を段1に赤で表示**。公開直後の記事は「インデックス待ち」として別扱い
- **canonical の自己参照が崩れている記事**（重複・パラメータ違い）を検出 → カニバリの隠れた原因

> **157本のうち何本が実際にインデックスされているかを、今誰も知らない。**

#### 3.6.2 ★② アシスト貢献（マルチタッチ） — 記事評価を最も歪める欠損

現設計は `firstTouchContentId` / `lastTouchContentId` の2つだけ。
しかし実際の購買行動は「比較記事を読む → 商材記事を3本読む → 数日後に戻って問い合わせ」。
**間の記事は評価ゼロになり、"効いていない記事"として畳まれる危険がある。**

```prisma
model LeadTouchpoint {           // CVした人が読んだ記事を全部残す
  id, leadId, contentItemId, viewedAt, sequenceNo
  dwellSeconds, scrollDepth
  role         // first | assist | last
  attributionWeight Float        // 線形 or 時間減衰で配分
}
```

- **アシスト評価**があって初めて「この記事は直接CVしないが、CVした人の8割が読んでいる」が分かる
- 今回の直客も、`VisitorSession` があれば「ART-074を見てART-076に進んだ」まで復元できたはず
- 配分方式は **last touch を主指標としつつ、アシスト貢献も併記**（片方だけ見ない）

#### 3.6.3 ★③ 被リンク・権威 — 「1〜3位が0本」の最有力の原因

実測: **4〜10位に78本が滞留、1〜3位は0本**（2026-07-13）。
コンテンツ品質の問題ではなく、**ドメインの権威（被リンク）が足りていない**可能性が高い。これは記事をいくら書いても解決しない。

```prisma
model Backlink {
  id, targetContentId?, sourceDomain, sourceUrl, anchorText
  firstSeenAt, lastSeenAt, lost Boolean
  domainRank Int?, isNofollow Boolean
}
model DomainAuthority {
  id, domain, date, refDomains, backlinks, rankScore    // 自社＋競合
}
```

- **DataForSEO Backlinks API** で自社と競合を月次取得（SERP APIと同じアカウント・低コスト）
- **競合との参照ドメイン数の差**が「1ページ目の上位に行けない天井」を説明する
- サイテーション（リンク無しの言及）は当面スコープ外

> **これが分かると打ち手が変わる。** 「記事を増やす」ではなく「被リンクを取る（プレスリリース・専門メディア寄稿・監修実績）」が正解になる可能性がある。

#### 3.6.4 ★④ ページ体験（Core Web Vitals・表示速度）

ランキング要因であり、かつ**CVRに直結**（表示が遅いLPは離脱する）。

```prisma
model PageExperience {
  id, contentItemId, date, device        // mobile | desktop
  lcp, inp, cls, ttfb, performanceScore
  source                                  // crux(実測) | psi(ラボ)
}
```

- GSC の CWV レポート（実ユーザー実測）＋ PageSpeed Insights API（ラボ値）
- **モバイル／デスクトップ別に持つ**。経営者層はモバイル閲覧が多い可能性があり、モバイルのCVRが低いなら最優先の改善点になる

#### 3.6.5 ★⑤ 記事別の制作コスト — ROIの分母

> ※ 全社の時給管理（石井さんが「いらない」とした部分）ではなく、**記事単位のROI**。メディア運用の判断に必要。

```prisma
model ProductionCost {
  id, contentItemId, kind        // new | rewrite | image | video
  humanMinutes Int               // 石井さんの実作業（承認・レビュー・確認）
  aiTokens Int, aiCostYen Decimal
  externalCostYen Decimal        // 画像生成・API・外注
  producedAt
}
```

- **記事別ROI = リード貢献額 ÷ 制作コスト** が出せる
- **クラスタ別ROI** に集約すれば「どのテーマが投資に見合うか」が分かる
- AIトークンは `JobRun.metrics` から自動集計。石井さんの作業時間は承認画面の滞在時間から自動推定（手入力を強要しない）

#### 3.6.6 ★⑥ AI検索からの流入（実体としてのAIO効果）

現在のAIO計測は「AIに引用されたか」を**自前プロンプトで測っている**（693試行）。
しかし**本当に知りたいのは「AI経由で人が来たか」**。

- ChatGPT / Perplexity / Copilot からの流入は **referrer で判別可能**（`chat.openai.com` / `perplexity.ai` 等）
- `VisitorSession.referrer` を正規化し、`trafficSource` に **`ai_search`** を追加
- **AIO引用率（先行指標）と AI流入（結果指標）を並べて見る**ことで、GEO施策の実効性が初めて評価できる

```prisma
// VisitorSession に追加
//   trafficSource  // organic | ai_search | social | direct | referral | paid
//   aiEngine?      // chatgpt | perplexity | copilot | gemini
```

#### 3.6.7 ★⑦ 記事の終息管理（プルーニング・404・統合）

**薄い記事・買い手を連れてこない記事を放置すると、サイト全体の評価を下げる**（Google のサイト品質評価）。現設計には「記事を減らす」経路が無い。

```prisma
model ContentLifecycle {
  id, contentItemId, action    // keep | improve | merge | noindex | redirect | delete
  reason, decidedAt, decidedBy
  mergeTargetId?, redirectTo?
}
model UrlRedirect { id, fromPath, toPath, statusCode, createdAt, hits Int }
```

**プルーニング判定の自動起票**（段5に提案として上がる）

| 条件 | 提案アクション |
|---|---|
| 公開180日超 × クリック0 × 表示100未満 | `noindex` または `merge` |
| 同一クラスタ内でKW重複 × 順位が低い方 | `merge`（統合してリダイレクト） |
| buyer-fit低 × リード0 × 制作コスト回収不能 | `keep`（放置）だがリライト投資はしない |
| URL変更・記事削除 | `UrlRedirect` を必ず作る（404を出さない） |

> **記事は増やすだけでは結果が出ない。** 畳む判断をシステムに持たせる。

#### 3.6.8 検討したが「今は入れない」もの（判断の記録）

| 項目 | 判断 |
|---|---|
| 監修者・E-E-A-T の管理（誰が監修したか） | **記事メタとして `ContentItem.note` で足りる**。監修体制が本格化したら別モデル化 |
| コンテンツ盗用検知 | 優先度低。被リンクが増えてから |
| サイテーション（リンク無し言及） | 被リンク管理が回ってから |
| ~~ヒートマップ~~ | **判断を訂正 → §3.7.3 で Microsoft Clarity 併用を採用** |
| ~~A/Bテスト基盤~~ | **判断を訂正 → §3.7 で全面設計**（前回の「SERPでのA/Bは実質不可」は不正確だった） |

#### 3.6.9 ロードマップ追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。
> 本節が追加した Phase: P3.3 / P3.4 / P4.2 / P6.9 / P5.8 / P8.2 / P4.11

---

### 3.7 検証手法の設計 — 母数に応じた使い分け ★2026-07-20（前回判断の訂正）

> 石井質問「ヒートマップや記事タイトルのA/Bテストを入れない理由は？」
> **前回の判断は雑だった。精査した結果、3つとも入れる。ただし優先順位とタイミングが異なる。**

#### 3.7.0 ★大前提 — 現在の母数では統計的手法の大半が機能しない

| 実測（2026-07） | 値 |
|---|---|
| 検索クリック | 142 / 週 |
| LP訪問 | **約38 / 月** |
| 記事数 | 157本 |
| 問い合わせ | 1件（初） |

**CVR 1% 想定で有意差を検出するには、各群で数百〜数千セッションが必要。**
月38訪問では、**A/Bテストを回しても何ヶ月経っても結論が出ない**。

→ **母数の段階に応じて、使う手法を変える。** これを明文化しないと「A/Bを回したが分からない」で時間を溶かす。

| 母数の段階 | 主に使う手法 | 理由 |
|---|---|---|
| **今（LP訪問 〜100/月）** | ① **定性**（Clarity録画・リードへのヒアリング）<br>② **大きく変えて before/after**<br>③ **クラスタ／記事群単位の判定** | 検出力が無いので小さな差は測れない。**1本の録画から分かることの方が多い** |
| 中（100〜1,000/月） | ④ **SEOスプリットテスト**<br>②③ を継続 | 記事群なら母数が作れる |
| 先（1,000+/月） | ⑤ **LP/CTA の A/Bテスト** | ここで初めて小改善の検証が成立する |

> **今の段階で小さなCTA文言のA/Bを回すのは時間の無駄。** LPの構成を大きく変えて before/after で見る方が正しい。

#### 3.7.1 ① SEOスプリットテスト（記事群を分ける・**主判定手法**）

**訂正**: 前回「GoogleのSERPでのA/Bは実質不可」と書いたが不正確だった。
- 正確には「**同一URLで訪問者ごとにtitleを出し分けることは不可能**」（クロールされた1つのtitleが全員に表示される）
- しかし「**ページ群を2グループに分け、片方だけ変更して期間中の推移を比較する**」split test は実在の手法であり、**記事157本あれば成立する**

記事単位では母数不足（クリック142/週 ÷ 157本 ＝ 週1件未満）で判定できないため、**これが主たる判定方法になる**。

```prisma
model SplitTest {
  id, name, hypothesis, changeType     // title | meta | cta_position | intro_structure …
  startedAt, endsAt, minSampleImpressions
  state                                 // running | concluded | aborted
  assignments SplitAssignment[]
}
model SplitAssignment {
  id, splitTestId, contentItemId
  arm                                   // treatment | control
  stratum                               // ★層（clusterId × 順位帯 × funnelStage）で層別ランダム化
  baseline Json                         // 開始前28日の実測
}
```

**設計上の要点**
- **層別ランダム化**（クラスタ・順位帯・funnelStage を揃えてから振り分ける）。無作為に分けるとグループ間の初期条件がズレて結論が歪む
- 判定は既存 `Intervention` と同じ式（treatment差分 − control差分）
- **最小サンプル基準**（合計impressions・記事本数）を満たすまで結論を出さない → `inconclusive`
- §16.5 で「バッチ判定」と書いていたものを、正式な手法としてここに格上げする

#### 3.7.2 ② LP / CTA の A/Bテスト（**モデルは今、実装は後**）

LPとCTAは**同一URLで訪問者ごとに出し分け可能**なので、本来のA/Bテストが成立する。**直客獲得の本丸がLPである以上、必ず入れる。**

```prisma
model Experimentation {          // LP/CTA の同時A/B
  id, targetType                 // lp | cta | form
  targetId, name, hypothesis
  variants Variant[]
  trafficSplit Json              // {A:50, B:50}
  primaryMetric                  // submit_rate | cta_click_rate
  minSamplePerArm Int            // ★到達するまで判定しない
  startedAt, concludedAt?, winnerVariantId?
  state                          // draft | running | concluded | underpowered
}
model Variant {
  id, experimentationId, key, config Json, isControl Boolean
  sessions, conversions, convRate, confidence
}
// VisitorSession に variantAssignments Json を追加（Cookieで固定・再訪時に同じ群）
```

**重要な運用ルール（母数不足への対処）**
- 開始時に**必要サンプル数を自動計算**し、到達見込みが3ヶ月を超えるなら **`underpowered` として起動を拒否**する（無駄なテストを始めさせない）
- その場合は「**大きく変えて before/after**」を提案する（`Intervention` 経由）
- **実装は P7 以降**（母数が増えてから）。ただし**モデルと計測は今入れる**（後から入れると過去データが使えない）

#### 3.7.3 ③ ヒートマップ・セッション録画（**Microsoft Clarity 併用・即導入**）

**訂正**: 前回「`FunnelEvent` のCTA位置別で代替できる」と書いたが不十分だった。
- `FunnelEvent` は**仮説ありきの計測**（「CTAが見られたか」）
- ヒートマップの本質は「**想定していない場所がクリックされている**」「**どこで読むのをやめたか**」を**仮説なしで発見する探索性**。代替にならない

| 選択肢 | 判断 |
|---|---|
| 自前実装 | ❌ **採用しない**。クリック座標とスクロールを大量記録すると**ストレージとJS負荷でCWVが悪化**する（§3.6.4 と矛盾する） |
| **Microsoft Clarity** | ✅ **採用**。**完全無料**・実装数分・セッション録画／ヒートマップ／レイジクリック検出 |

**役割分担（重要）**
```
Clarity      = 探索（仮説を見つける）      ← データはClarity側。MMSに統合しない
MMS      = 検証（仮説を定量で確かめる） ← FunnelEvent / SplitTest / Intervention
```
**統合しないことを設計判断として明記する。** 無理に取り込むと保守負担だけ増える。

**必須設定**: フォーム入力のマスキング（氏名・電話・メールが録画に残らないようにする）。`data-clarity-mask` を全フォーム項目に付与。

> **母数38の今こそ、録画38本を見る方が速い。** 定量が効かない段階では定性が最短経路。

#### 3.7.4 ロードマップ追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。
> 本節が追加した Phase: P2.8 / P4.12 / P7.7（`Experimentation` のモデルと群割当は **P2.5 に内包**・後入れ不可）

---

### 3.8 運用・業務・外部環境の軸での棚卸し ★2026-07-20（6件）

> §3.6 まではSEO／コンテンツ軸で洗った。**運用・業務・外部環境の軸**で洗い直した結果、さらに6件あった。

#### 3.8.1 ★① 季節性・需要カレンダー — 判断を最も誤らせる要因

**節税需要は決算期に集中する。** 3月決算なら1〜3月、12月決算なら10〜12月に検索が跳ねる。

**現設計では「クリック前週比 -7.8%」が季節要因か施策失敗かを判別できない。**
対照群補正（§5.3）も、**全記事が同じ季節性を持つ場合は効かない**（treatment も control も同時に下がる）。

```prisma
model SeasonalityIndex {     // 月別の需要指数（KWクラスタ単位）
  id, clusterId?, keywordId?, month     // 1-12
  indexValue Float                      // 年平均を1.0とした相対値
  sampleYears Int, source               // 検索ボリューム履歴から自動算出
}
```

- `KeywordVolume` の月次履歴が12ヶ月分溜まれば**自動算出できる**（今は3ヶ月分しかないので、初期はDataForSEOの過去12ヶ月データで補完）
- **段1・段4の前月比・前週比に季節調整値を併記**する（「-7.8%だが季節調整後は +2.1%」）
- **決算期の3ヶ月前に記事を仕込む**ための逆算カレンダーにもなる

#### 3.8.2 ★② 税制改正・制度カレンダー — 先回りできる情報

税制改正は**毎年12月に大綱 → 3月に成立 → 4月に施行**と予定が決まっている。各制度の適用期限も事前に判明している（例: 中小企業経営強化税制の期限）。

```prisma
model RegulatoryEvent {
  id, title, eventType        // outline | enactment | enforcement | expiry | public_comment
  scheduledAt, confirmedAt?
  affectedProducts String[]   // ML | 経営強化税制 | 少額減価償却 …
  sourceUrl, status           // scheduled | occurred | cancelled
  affectedContentIds String[] // ★該当記事を事前に紐付け
}
```

**自動化**
- 期日の**60日前に段5へ「記事準備」Action を自動起票**（速報を先回りで書ける）
- **適用期限が近い制度の記事を一括で `overdue` に**（§7.5 の `triggered_by_law` の入力源）
- 大綱発表日など**予定が分かっているものは News monitor より確実**

> 現状は「改正が起きてから反応」。カレンダーがあれば**先回りできる**。C柱（リスク中立）の速報性と相性が良い。

#### 3.8.3 ★③ 電話問い合わせが計測外だった

CTA v1拡張ブロックには**電話番号 03-6823-4928** が入っているが、設計のファネル7段は**フォーム送信で終わっている**。
→ **電話で問い合わせた人の流入経路は永久に分からない。**

**石井さん判断（2026-07-20）: 手動記録でよい（コスト0）。**

| 対応 | 内容 |
|---|---|
| `tel:` リンクのクリックは計測する | `FunnelEvent(step='phone_click')` を追加。**クリック数は取れる**（架電したかは不明） |
| 電話受電時は石井さんが手動で `Lead` 登録 | `/leads` に「電話から登録」ボタン。**入力は3項目のみ**（社名・興味商材・「何を見てお電話しましたか」） |
| ヒアリング文言をルール化 | **「何を見てお電話いただきましたか」を必ず聞く**（これが唯一の経路情報） |
| `Lead.sourceType` | `form` / `phone_manual` / `line` / `threads_dm` で区別し、**手動分は provenance=declared** として扱う |

> コールトラッキング（月数千円）は**件数が月10件を超えたら再検討**。それまでは手動で十分。

#### 3.8.4 ★④ 商談以降は m2（ML営業管理システム）に載せる

**石井さん判断（2026-07-20）: m2に載せる。MMSはリードまで。**

```
MMS: 集客 → 問い合わせ（Lead）まで
   ↓ Lead を m2 へ連携（外部ID保持）
m2     : 商談 → 提案 → 契約 → 着金
   ↓ 成約結果を API で MMS に戻す
MMS: 記事別・クラスタ別 ROI を算出
```

**`Lead` に追加するフィールド**（定義本体は §3 の `model Lead`。ここでは追加分のみ記載）

| フィールド | 用途 |
|---|---|
| `m2DealId` | ★m2側のID（双方向の紐付け） |
| `m2SyncedAt` / `m2Stage` | 同期時刻・m2側の商談ステージ |
| `m2ClosedAmount` / `m2ClosedAt` | 成約額・成約日（記事別ROIの入力） |
| `sourceType` | `form` / `phone_manual` / `line` / `threads_dm`（§3.8.3） |

**設計上の要点**
- **商談プロセスはMMSに作らない**（二重管理を避ける）。`Deal` モデルは m2 のミラーとして最小限に留める
- m2 は **VPC内・外部非公開**（`ML営業管理システム_接続メモ.md`）。既に月次で `/api/stats/strategy-report` を叩く連携があるため、**同経路に「成約→リード紐付け」を追加する**
- **未確認**: m2 側に「リード元＝メディア」を記録する項目があるか。無ければ m2 側に1項目追加が必要（石井さん確認事項）

#### 3.8.5 ★⑤ Threads側の管理が薄い

記事は §3.5〜3.7 まで細かく設計したが、Threads は「投稿キュー・配信実績・パターン分析」程度だった。

```prisma
model SnsAccountHealth {     // ★アカウントが生きているか
  id, channelId, date
  followers, followersDelta
  postsDelivered, postsFailed
  avgViews, viewsPerFollower          // ★急落＝配信制限/シャドウバンのサイン
  restrictionSuspected Boolean, tokenExpiresAt
}
model PostSchedule {         // 時間帯別の成績
  id, channelId, hourOfDay, dayOfWeek, avgViews, avgEngagement, sampleSize
}
model CrossPromotion {       // ★記事 ↔ 投稿の相互送客
  id, contentItemId, postContentItemId, direction, clicks
}
```

- **`viewsPerFollower` の急落を段1で検知**（Threadsの配信制限は静かに起きる。気づかないと数週間無駄になる）
- **トークン期限**（60日）は段7で残日数表示（§16 で既出だが Threads も対象に明記）
- **記事→Threads / Threads→記事の相互送客**を計測。§13.4④「Threadsヒット→記事化」の効果検証に必要
- リプライ対応は `AgencyLead` が代理店DM専用なので、**一般リプ・DMは対象外**（現行のGAS＋日次監視のまま）と明記

#### 3.8.6 ★⑥ LP のエンティティが無い

`lp_funnel` と `Cta` はあるが、**LP自体のモデルが無い**。診断LP・商材別LP・代理店LP・比較ハブが増えると管理不能になる。

```prisma
model LandingPage {
  id, businessId, slug, url, name
  lpType           // consultation | product | comparison_hub | agency
  productFit String[], budgetTier, offer     // 無料相談 | 資料DL | 診断
  status           // draft | live | paused | retired
  publishedAt, currentVersionId
  sourceContentIds String[]                  // どの記事から送客されるか
  versions LpVersion[]  funnels FunnelEvent[]
}
model LpVersion {
  id, landingPageId, versionNo, capturedAt, html, config Json, changeNote
}
```

- **LPもコンテンツと同じくバージョン管理**（§16.3 と同じ理由。ロールバックできないと改善が怖くてできない）
- `sourceContentIds` により「どの記事群からどのLPへ送るか」の設計が管理できる
- PRJ-029（診断LP）・PRJ-034（代理店LP）を初期データとして投入

#### 3.8.7 ロードマップ追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。
> 本節が追加した Phase: P2.9 / P2.10 / P3.8 / P4.13 / P5.9 / P6.10

---

### 3.9 実運用・品質・信頼性の軸（残る5件）★2026-07-20

#### 3.9.1 ★① WordPress との整合ズレ — 原則で潰す

**石井さん確認（2026-07-20）: 「WPを私が直接触ることはない。基本的にメディア事業部のプロジェクトでClaudeに依頼する」**

→ **人が直接触るリスクは無い。** ただしゼロではなく、リスクの主体が変わる。

| リスク源 | 内容 |
|---|---|
| ~~石井さんがWP管理画面で直接編集~~ | **無し**（確認済） |
| **別セッションのAIがWPを直接叩く** | メディア事業部セッションの `wp-publish.py` や、CLAUDE.md が認める**緊急 surgical fix（live post への REST PATCH）**は、MMSを経由しない |
| WP/テーマ/プラグインの自動更新 | 計測タグやテンプレートが書き換わる可能性 |

**設計原則（新規に定める）**
```
★ WordPress への書き込みは、必ず MMS API を経由する
   メディア事業部の既存スクリプトも MMS 経由に切り替える（wp-publish.py → /api/wp/publish）
   → 書き込み経路が1本になり、原理的にズレない
```

**それでも残る緊急 PATCH 用の保険（軽量）**
- 日次で WP から `title / metaDescription / status / tags / featured_media` を取得し、**ハッシュ比較**（本文全体は比較しない＝軽量）
- 差分検出時のみ段7に表示し、`ContentVersion` を1件作って取り込む
- **石井さんが直接触らない前提なので、頻度は日次で十分**

#### 3.9.2 ★② 外部リンク切れ — YMYLでは信頼性に直結

**157記事 × 出典3本以上 ＝ 500本超の外部リンクを、誰も見ていない。**
`news-article.md` は外部出典3本以上・tier1（nta.go.jp 等）1本以上を必須にしているが、**公開後にリンクが生きているかは未確認**。国税庁のURLは実際に変わる。

```prisma
model LinkCheck {
  id, contentItemId, url, isExternal Boolean
  checkedAt, statusCode, ok Boolean
  redirectedTo?, consecutiveFailures Int
  tier                     // tier1(nta/mof/e-gov) | tier2 | other
}
```

- **週次で全リンクを検査**（内部・外部とも）
- **tier1 の出典が404になった記事を最優先で段5に起票**（YMYL信頼性の毀損）
- 内部リンク切れは §3.5 の `InternalLink` と統合して扱う

#### 3.9.3 ★③ サイトの死活監視 — 落ちたら流入ゼロ

```prisma
model UptimeCheck { id, target, checkedAt, statusCode, responseMs, ok Boolean }
```

- 5分間隔で `asset-support.co.jp` トップ・代表記事・**LP・フォーム送信エンドポイント**を監視
- **連続3回失敗で即通知**（Appleリマインダー最優先）
- WP/PHP/プラグイン更新後の500エラーは実際に起きうる。**フォームが壊れていると問い合わせが消える**（最も高い損失）
- 外部サービス（UptimeRobot 無料枠等）でも代替可。**worker 内蔵で十分**

#### 3.9.4 ★④ スキル・プロンプトのバージョン記録 — 品質変化の原因究明

`article-writer` は **v4**、`news-writer`・`reel-factory` 等も更新される。**スキルが変われば出力が変わる**が、「どのバージョンで作った記事か」の記録が無いため、**品質が変わったときに原因を特定できない**。

```prisma
model GenerationProvenance {
  id, contentItemId, generatedAt
  skillName, skillVersion          // article-writer v4
  modelName                        // opus-4.8 | sonnet-5 …
  promptHash, configSnapshot Json
  validatorResults Json
}
```

- **記事の成績をスキルバージョン別に比較できる**（v3の記事とv4の記事で順位・CTRに差があるか）
- モデル振り分け（CLAUDE.md §8: 判断=Opus / 定型=Sonnet）の**実際の効果を検証できる**
- スキル更新時に「更新前後で成績が落ちていないか」を自動判定 → `Learning` へ

#### 3.9.5 ★⑤ レピュテーション監視

節税商材は炎上リスクがある領域で、実際に**倒産・行政指導・否認事例の記事を書いている**（オペリース倒産・ドローンネット破産等）。

```prisma
model BrandMention {
  id, source          // threads | x | google | note | 5ch …
  url, snippet, foundAt
  sentiment           // positive | neutral | negative
  entity              // 節税総研 | アセットサポート | ML | 石井 …
  handled Boolean, note
}
```

- 自社名・メディア名・商材名の言及を週次で検索（無料の範囲: Google検索・Threads検索）
- **negative を検出したら即通知**（対応判断は石井さん。AIは自動返信しない）
- 記事が名誉毀損リスクを持つ領域なので、**クレームの初期検知は保険として必要**

#### 3.9.6 リール動画の指標（モデル変更不要）

`ContentItem(type='reel')` は既にあるため、**`ContentMetric` の metric 名を増やすだけ**で対応できる。
`reel_views` / `reel_watch_time` / `reel_completion_rate` / `reel_saves` / `reel_shares`。
→ **スキーマ変更なし**（§10「壊れずに強化できる」の実例）。

#### 3.9.7 ロードマップ追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。
> 本節が追加した Phase: P1.8 / P3.9 / P4.14 / P6.11 / P8.3

---

### 3.10 ★過去のサイト重量化事故の再発防止 ★2026-07-20 石井指摘

> 石井「以前発生したサイト自体が重くなる問題は再発ないか。読み込むたびに何千回とリロード的なのを繰り返していた（コードのミス）」

#### 3.10.1 事故の事実確認（社内記録より）

`~/Documents/Claude/Projects/メディア事業部/ops/projects/PRJ-027_pv-referer-tracking/README.md` のリスク表に記録あり：

| リスク | 対策（当時） |
|---|---|
| **テーマ更新で TTFB スパイク再発** | 既存**非同期 sendBeacon** パターン維持。**同期 DB 書込みを追加しない** |
| postmeta レコード爆増（チャネル数×日数で5倍） | 90日で日別bucket削除（TTL）を継承 |

関連記載: **「PRJ-023 perf-audit（sendBeacon 非同期化）」**

**原因**: WPテーマの自前PV計測 `/asset/v1/track` が**同期でDB書込み**（`update_post_meta`）していたため、ページ表示のたびにDB書込みが走り TTFB が跳ねた。対策として非同期 sendBeacon 化された。

> ⚠️ **問題: 事故の詳細記録（インシデントレポート）が残っていない。**
> 学びログにもナレッジにも無く、**再発防止策が PRJ-027 のリスク表の1行にしか存在しない**。→ §3.10.5 で `Incident` を作る。

#### 3.10.2 今回の設計における再発リスク評価

| 観点 | 評価 |
|---|---|
| **送信先** | ✅ **有利**。`FunnelEvent` の送信先は **MMS（別サーバー）であり WordPress ではない**。過去の主因「WP側の同期DB書込み」「post_meta肥大」は**構造的に発生しない** |
| **計測点の数** | ⚠️ **危険**。7段に増える（CTA表示／CTAクリック／LP到達／スクロール／フォーム到達／項目離脱／送信）。**フロントJSの発火回数は確実に増える** |
| **スクロール計測** | ⚠️ **最も危険**。スクロールイベントは1操作で数百回発火しうる。throttle 無しは事故直結 |
| **A/B の群割当** | ⚠️ 同一URLで出し分ける際、JS描画だとちらつき（CLS悪化）。サーバー側で決定する |
| Clarity | ⚠️ 外部JS。非同期・遅延読込にする |
| LinkCheck / UptimeCheck | ⚠️ 自社サイトへの定期リクエスト。**LinkCheckは週次・レート制限つき**、Uptimeは軽量HEAD |
| WP書き込み一本化（P1.8） | ⚠️ REST経由の書込み頻度が上がる。**バッチ化・レート制限**する |

> **過去の事故で本当に問題だったのは「何千回発火しても誰も気づかなかったこと」。** 発火回数を監視していなかった。**同じ設計にしない。**

#### 3.10.3 ★計測タグの設計原則（違反を機械で検出する）

```
① 1ページあたりの送信は原則1回（ページ離脱時にまとめてPOST）
   → イベントは sessionStorage にバッファし、
     beforeunload / visibilitychange で sendBeacon 1発

② スクロールは throttle 250ms ＋ 深度は 25/50/75/100% の4段のみ（連続値を送らない）

③ 同一イベントの冪等キー: (sessionId, step, contentItemId, 分単位のtimestamp)
   → 重複は受信側で捨てる

④ 送信は必ず非同期（sendBeacon / fetch keepalive）。同期XHR禁止

⑤ WordPress 側では一切DB書込みをしない（受けるのは MMS の /api/ingest）
   → post_meta / wp_options を太らせない

⑥ 計測JSは defer / 遅延読込。document.write 禁止

⑦ 1セッションあたりのイベント上限を JS 側にも置く（例: 50件）
   → 超えたら送信を止める（暴走の自己遮断）
```

#### 3.10.4 ★発火回数そのものを監視する（これが決定的）

```prisma
model TelemetryVolume {        // 計測タグ自身の発火量を監視
  id, date, hour
  sessions, events, eventsPerSession Float
  bytesReceived, rejectedDuplicates
  anomaly Boolean               // 閾値超過
}
```

| 閾値（初期値・調整可） | アクション |
|---|---|
| `eventsPerSession > 30` | 段7に**黄**（想定は7〜15） |
| `eventsPerSession > 50` | 段7に**赤** ＋ 即通知 |
| 前日比でイベント総数が **3倍** | **赤 ＋ 計測タグの自動無効化を提案**（段5にワンクリック停止Action） |
| `rejectedDuplicates` 比率 > 20% | 実装バグの疑い。黄 |

> **「何千回発火」は、この監視があれば当日中に検知できる。**
> さらに **`/api/ingest` 側にレート制限**（同一セッションから毎分N件超は429）を置き、**サーバー側でも暴走を止める**（二重の歯止め）。

#### 3.10.5 デプロイ前の性能ゲート

**WPテーマ・計測タグ・LPを更新する前後で、必ず性能を測って比較する。**

```prisma
model PerfGate {
  id, releaseTag, target        // wp_theme | tracker | lp | plugin
  measuredAt, phase             // before | after
  lcp, inp, cls, ttfb, jsBytes, requestCount
  passed Boolean, blockedReason
}
```

- デプロイ前に PageSpeed Insights を叩いて `before` を記録 → デプロイ後に `after`
- **TTFB が 20% 以上悪化、または LCP が 0.5秒以上悪化したらデプロイを失敗扱い**にして段7に赤
- ロールバック手順を必ず併記（§16.3 の `ContentVersion` / テーマzipの旧版）

> 過去の事故は**テーマ更新に紛れて入った**。更新のたびに測れば、次は当日中に気づく。

#### 3.10.6 インシデント記録（今回の事故を含めて残す）

```prisma
model Incident {
  id, occurredAt, detectedAt, resolvedAt?
  severity              // critical | high | medium | low
  category              // performance | data_quality | availability | security | quality
  title, symptom, rootCause, resolution
  preventionActions Json          // 再発防止策（実装済みかのチェック付き）
  relatedPhase?, relatedContentIds String[]
}
```

**初期データとして以下を登録する**
| # | 事故 | 分類 | 再発防止 |
|---|---|---|---|
| 1 | **TTFBスパイク（自前PV計測の同期DB書込み）** | performance | §3.10.3 ⑤／§3.10.4／§3.10.5 |
| 2 | **問い合わせを「未計測」なのに「0」と表示し、直客2件の成約を見逃した** | data_quality | `MeasurementCoverage`（§3 規約） |
| 3 | **GSC日次が10日欠測していたが誰も気づかなかった** | data_quality | 欠測アラート（§3.2.2） |
| 4 | 週次サマリーの Pillar/Cluster 集計が壊れていた（両方Cluster表示） | data_quality | §3.5.7 移行時に修正 |
| 5 | intervention 記録が9件しか無く28日判定が回っていなかった | quality | publish時の自動INSERT（§12） |

> **事故を記録しないと、対策は個別ファイルの1行に埋もれて失われる。** 今回まさにそれが起きていた。

#### 3.10.7 ロードマップ追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。
> 本節が追加した Phase: P2.11 / P1.9 / P3.10（計測タグ設計原則§3.10.3 と ingest レート制限は **P2.5 に内包**）

---

## 4. 画面（メディア／SNS運用に絞る）

> 石井方針（2026-07-20）: **対象はメディア／SNS運用。全社の手残り・他事業は対象外。**

### 4.1 `/` — ダッシュボード（石井さんが毎日見る唯一の画面）

**段1: 獲得3ゴールの結果**
```
2026年7月  残り11日

① 直客の問い合わせ    1 / 5件   ██░░░░░░  20%   ▲+1    🟡  ← 最優先
   └ 成約: 2台 / 約480万（内諾・リーガルチェック中）
② 代理店（有効DM）    1 / 3件   ███░░░░░  33%   →±0    🟡
③ LINE登録            0 / 20件  ░░░░░░░░   0%   →±0    🔴 ※2026-07-XX 計測開始
```
※ 計測開始前の期間は「—(未計測)」と表示し、0とは書かない（§3 規約）

**段2: ファネル（どこで落ちているか）**
```
表示 12,400 → クリック 142 → CTA表示 620 → CTAクリック 41 → LP到達 38 → フォーム到達 4 → 送信 1
                                                                    ↑ 最大ドロップ: LP到達→フォーム到達 (89%離脱)
```

**段3: 買い手の質**
```
買い手適合クリック（budgetTier=high/mid）  38 / 142 (27%)
比較段階（funnelStage=comparison）の流入   61 / 142 (43%)
買い手PVあたり問い合わせ率                  1 / 640
```

**段4: 今週の変化** — operator が日本語3〜5行で生成（履歴保存）

**段5: 次の一手** — [承認][却下][差戻し]。押すと Server Action で即 jobs 投入

**段6: 施策の生死** — 撤退期限までのカウントダウン

**段7: ジョブ健全性** — 最終実行・失敗・APIトークン残日数・**計測の欠測アラート**

### 4.2 その他の画面

| 画面 | 内容 |
|---|---|
| `/leads` | リード一覧（属性・興味・比較対象・経路・初動速度）。**直客2件をここに遡及入力する** |
| `/content` | 記事・投稿一覧（buyerFit / funnelStage / ファネル成績・現 console.html の後継） |
| `/clusters` | **トピッククラスタのツリー表示**（ピラー／クラスター・グループ別数値・リンク健全度・構造欠陥検知）（§3.5） |
| `/keywords` | KW・順位・カニバリ・鮮度・競合ギャップ |
| `/market` | **市場規模・シェア（SOV）・Top3/Top10率・機会損失ランキング・競合比較・空白地帯**（§3.3） |
| `/ads` | **ユニットエコノミクス（上限CPA）・シミュレーター（順算/逆算）・キャンペーン実績・予実差分・SEO vs 広告比較**（§3.4） |
| `/ideas` | ネタ（5供給源から自動起票） |
| `/threads` | 投稿キュー・配信実績・パターン別分析・代理店DM triage |
| `/experiments` | 施策管理（仮説・成功指標・撤退条件） |
| `/jobs` | ジョブ監視 |

---

## 5. 自動運営とPDCA

### 5.1 ループ

| 周期 | 処理 |
|---|---|
| **随時（Webhook）** | 問い合わせ／LINE登録／WP公開を**発生した瞬間**に記録 → §5.4 の初動自動対応を起動 |
| **日次 07:00** | 実測取得 → 異常検知 → 即応（ヒット投稿の横展開・順位急落のリライト登録・欠測検知） |
| **週次 月 09:00** | 集計 → 判定 → **立案（§5.2）** → 先に実行して draft 化 → 段5に承認待ちで並べる |
| **日次** | `Intervention.evaluateAt` を迎えたものを**自動判定（§5.3）** → `Learning` を自動生成 |
| **月次 1日** | 施策の継続/撤退判定 → 目標再設定提案 → 学び/意思決定の追記案 |

### 5.2 立案ロジック（段5に何を並べるか）★これが無いと実装できない

**入力**
1. 目標とのギャップ（`Target` vs `MetricSnapshot`）
2. **ファネルの最大ドロップ地点**（`FunnelEvent` 集計）
3. striking distance（`KeywordRanking` 11〜20位）
4. 競合ギャップ（`SerpSnapshot.isOurs=false` で自社圏外のKW・§3.3.5）
5. **リードの比較対象**（`Lead.competitorsConsidered`）
6. 却下履歴（`ActionEvent.reason`）
7. 買い手適合の低い記事（`buyerFitScore` 低 × 投入時間大 = 停止候補）

**打ち手タイプ（各々に「効く指標」「期待効果」「判定期間」を定義）**

| type | 効く指標 | 判定期間 | 自動実行 |
|---|---|---|---|
| `title_meta_rewrite` | CTR / clicks | 28日 | draft生成 |
| `cta_move` / `cta_variant` | cta_click率 | 14日 | 実装まで |
| `lp_section_edit` | form_view率 | 14日 | draft生成 |
| `internal_link` | 回遊 / lp_view | 28日 | 実装まで |
| `new_article` | impressions / clicks | 56日 | draft生成 |
| `kw_pivot` | position | 56日 | 提案のみ |
| `threads_format_shift` | views / DM数 | 14日 | 配分変更まで |
| `stop_low_fit` | 投入時間の再配分 | — | 提案のみ |

**出力**: `Action`（type・rationale・impacts・期待効果レンジ・判定期間つき）。承認されると `Intervention` が自動生成され、**判定日が予約される**。

### 5.3 判定ロジック（Check）— PDCAが閉じる場所

```
netEffect = (適用後28日の実測) - (適用前28日の実測) - (対照群の同期間トレンド)

対照群 = 同カテゴリ・同 funnelStage で、その期間に手を入れていない記事群
```

| verdict | 条件 | 自動アクション |
|---|---|---|
| `positive` | netEffect > 期待効果の下限 | `Learning` 生成 → **同型の打ち手を他記事へ横展開提案** |
| `neutral` | 有意差なし | `Learning` 生成 → 立案の重みを下げる |
| `negative` | 悪化 | `Learning` 生成 → **ロールバック提案** ＋ 同型の打ち手を一時停止 |
| `inconclusive` | サンプル不足 | 判定期間を延長 |

**対照群補正が無いと「季節変動で上がっただけ」を「施策が効いた」と誤判定する。** ここがPDCAの精度を決める。

### 5.4 初動自動対応（リード発生時）

```
問い合わせ受信
 → Lead 起票（?from=&article= と VisitorSession から経路を自動判定）
 → 石井さんへ即通知（最優先）
 → 自動返信メール送信
 → 閲覧履歴から興味商材・比較対象を推定
 → 返信ドラフト生成 → 段5で承認して送信
 → firstResponseAt 記録・SLA（1時間）を段1で監視
```

### 5.5 結果フォーカスの構造的強制

- 全 `ContentItem` / `Action` / `Idea` に `impacts` 必須。**どの結果指標にも効かない作業は登録できない**（APIで弾く）
- 段5は `impacts` の重み順にソート
- 月次で「今月の作業のうち結果指標に効いた割合」を自動算出

### 5.6 却下が学習になる仕組み

`ActionEvent.reason` を蓄積 → 次回の立案プロンプトに直近の却下理由を注入 → 3週連続で却下率が高い打ち手タイプは自動停止。

---

## 6. 既存資産の扱い

| 既存 | 扱い |
|---|---|
| `~/Documents/Claude/Projects/メディア事業部/.claude/scripts/` 40本超（Python） | **書き直さない**。worker の `legacy/` に置きそのまま呼ぶ |
| `media.db`（SQLite・14テーブル） | 初回移行スクリプトで Postgres へ投入。以後 media.db は退役 |
| `timeseries.db` | 同上（article_weekly / query_weekly / intervention を移行） |
| `console.html` | `/media` へ移植後に退役 |
| Threads GAS（Post/Scheduler/Insights/Api） | **継続**。Insights を `/api/ingest/threads` へPOSTするよう1関数追加するだけ |
| cron/aio-batch.sh | jobs テーブルに定義を移し、worker から実行 |
| Cowork Scheduled 11タスク | jobs へ集約（リマインダー方式が必要なものだけ残す） |
| Notion（記事DB/AIO/ネタ/リール） | **廃止**。全て Postgres へ移行（§7） |

---

## 7. Notion 廃止 — プロパティ単位の完全移行表

> 石井質問「Notionで管理していた情報は全て入っているか？ Notionをなくしても問題ない状態か？」
> **v4時点では「ContentItem に移行」と1行書いただけで、プロパティ単位の突合をしていなかった（手抜き）。**
> `notion-sync.py` の実装を読んで全プロパティを洗い出し、以下に移行先を確定した。

### 7.1 記事パフォーマンス管理DB（20プロパティ）

| Notion プロパティ | 型 | 移行先 | 状態 |
|---|---|---|---|
| 記事タイトル | title | `ContentItem.title` | ✅ |
| 記事ID | rich_text | `ContentItem.externalId`（ART-XXX） | ✅ |
| メインKW | rich_text | `KeywordAssignment(role=main)` → `Keyword` | ✅ 関連で持つ |
| カテゴリ | select | `ContentItem.category` | ✅ |
| アイキャッチタイプ | select | `ContentItem.eyecatchType` | ✅ |
| アイキャッチ色 | select | `ContentItem.eyecatchColor` | ✅ |
| ターゲット | select | `ContentItem.targetLabel` ＋ `audience` / `budgetTier` | ✅ 強化 |
| 制作ステータス | status | `ContentItem.status` | ✅ |
| 公開URL | url | `ContentItem.url` | ✅ |
| 公開日 | date | `ContentItem.publishedAt` | ✅ |
| **データ更新日** | date | **`ContentItem.dataUpdatedAt`** | ✅ 追加した |
| **情報基準日** | rich_text | **`ContentItem.infoBaseDate`** | ✅ 追加した |
| ピラー | checkbox | `ContentItem.isPillar` | ✅ |
| SEOチェック | checkbox | `ContentItem.seoCheckPassed` ＋ `validatorRun` | ✅ 強化 |
| コンプラ判定 | select | `ContentItem.complianceVerdict` | ✅ |
| ファクトチェック判定 | select | `ContentItem.factCheckVerdict` | ✅ |
| 記事種別 | select | `ContentItem.articleType` | ✅ |
| メモ | rich_text | `ContentItem.note` | ✅ |
| 文字数 | number | `ContentItem.charCount` | ✅ |
| **最終チェック日** | date | **`ContentItem.lastReviewedAt`** | ✅ 追加した |

### 7.2 AIO計測DB（4プロパティ）

| Notion プロパティ | 移行先 |
|---|---|
| AIO Tier | `ContentItem.aioTier` |
| AIO計測対象 | `ContentItem.aioTracked` |
| AIO Tier更新日 | `ContentItem.aioTierUpdatedAt` |
| AIOメモ | `ContentItem.aioNote` |
| （計測実績） | `ContentMetric(metric='aio_hit' 等)` — 日次履歴として保持 |

### 7.3 ネタ管理DB / リール管理DB

| Notion | 移行先 |
|---|---|
| ネタ管理 | `Idea`（状態遷移・5つの自動供給源つき。**Notionより機能が増える**） |
| リール管理 | `ContentItem(type='reel')` ＋ `ContentMetric` |

### 7.4 移行後に失われるもの → **なし**

- **Notionにあって移行先が無いプロパティはゼロ**（上表で全件マッピング済み）
- Notionのページ本文（自由記述メモ）は `note` に移行。長文は Markdown ファイルへのリンクで保持
- **移行後に増えるもの**: 日次の履歴（Notionは最新値しか持たない）／`ArticleReview` の履歴／validator全結果／ファネル・リードとの接続

### 7.5 廃止手順（データを失わない順序）

1. Postgres 側にテーブルを作る（P0）
2. **Notion API で全ページをエクスポート → 投入**（P1.5）
3. **1週間の並行稼働**: 新規記事は両方に書き、突合スクリプトで差分ゼロを確認
4. 差分ゼロを確認後、`notion-sync.py` / `notion-sync-aio.py` を停止・削除
5. CLAUDE.md 公開ゲートから Notion 同期の必須項目を削除
6. Notion のDBはアーカイブとして残す（削除しない）

**→ 上記完了後、Notionを見る理由は無くなる。**

---

## 7.5 記事の鮮度管理とリライト自動化 ★石井指摘（2026-07-20）

> 「記事が古くならないように定期的にリライト対象にする必要があるルールのはずだ」
> → `content-standards.md` の **鮮度3階層ケイデンス**が正典。**v4設計にはこれが入っていなかった。**

### 7.5.1 ルール（既存の正典をシステム化する）

| freshnessTier | 対象 | 間隔 | 例 |
|---|---|---|---|
| `breaking` | 速報・税制改正 | **随時**（法改正イベント駆動） | ニュース記事・改正大綱 |
| `commercial` | 商用・税制系 | **60〜90日**（既定75日） | 即時償却・経営強化税制・商材比較 |
| `evergreen` | エバーグリーン・Pillar | **6ヶ月** | 節税の基本ガイド |
| `reference` | 定義・リファレンス | **12ヶ月** | 用語解説 |

**重要な原則（正典より）**
- **cosmetic更新は逆効果**。`dataUpdatedAt`（dateModified）は**実質追記のときだけ**更新する
- 記事に **"last reviewed: YYYY-MM"** を明示する（`lastReviewedAt`）

### 7.5.2 自動化

```
nextReviewDue = lastReviewedAt + FreshnessRule.intervalDays

日次ジョブ:
  nextReviewDue - 30日 → reviewState = due_soon → 段1に黄色
  nextReviewDue 経過   → reviewState = overdue  → 段1に赤 ＋ 段5に Action 自動起票
```

**さらに、期限以外のトリガーでもリライト対象に上げる（イベント駆動）**

| トリガー | 検知元 | 起票される Action |
|---|---|---|
| 期限到来 | `nextReviewDue` | `periodic_review` |
| **順位下落**（4週で3位以上低下） | `KeywordRanking` | `triggered_by_rank` |
| **表示はあるがクリック0**（CTR異常） | `ContentMetric` | `title_meta_rewrite` |
| **税制改正・法令変更** | News monitor | `triggered_by_law`（**該当する全記事を一括で対象化**） |
| **競合に抜かれた** | `SerpSnapshot` | `triggered_by_competitor` |
| **KW鮮度切れ**（ラッコ90日） | `KeywordResearch.expiresAt` | `kw_refetch` |
| **AIO非引用**（Hot tierで連続hit無し） | AIO計測 | `geo_reinforce` |

### 7.5.3 レビュー結果の記録（`ArticleReview`）

AIが自動でレビューを実行し、結果を記録する。
1. 記事内の制度・数値・年度を抽出
2. **一次ソース（国税庁・e-Gov・財務省）と自動照合**
3. 差異があれば `findings` に記録し、修正draftを生成
4. 石井さんは段5で承認するだけ
5. `outcome` を記録（`no_change` なら `dataUpdatedAt` は**更新しない**＝cosmetic回避）
6. 実質追記なら `Intervention` に接続して効果測定へ

**→ 「記事が古い」を人が思い出す必要がなくなる。**

### 7.5.4 現状の課題（このシステムで解決される）

現在、記事157本の `lastReviewedAt` は Notion の「最終チェック日」に入っているが、**期限を過ぎたことを誰も検知していない**。公開後に一度も見直されていない記事が何本あるかも分からない。
→ 移行時に全記事の `freshnessTier` を自動判定（`articleType` と `productFit` から）し、**初回スキャンで overdue 一覧を出す**。

---

## 8. セキュリティ

- Next.js は **127.0.0.1 バインド**。外部公開は Cloudflare Tunnel + **Access（メール認証）**のみ
- Webhook 受口は **HMAC-SHA256 署名検証**（共有シークレット）。WPプラグイン/GAS に同鍵
- 認証は Auth.js（Email magic link）。Role（owner / partner / readonly）を最初から持たせる
- シークレットは `.env`（コミット禁止）。将来 1Password CLI or AWS Secrets Manager へ（ML営業システムで既にSecrets Manager運用実績あり）
- Postgres は**日次論理バックアップ**（`pg_dump` 30世代）＋週次でGoogle Driveへ退避

---

## 9. 実装ロードマップ（統合版・★ここが唯一の正）

> 各セクションに分散していたPhaseを1表に統合した。**着手順はこの表に従う。**

### 9.1 全Phase

| # | Phase | 内容 | 依存 | 見積 |
|---|---|---|---|---|
| **【S0 基盤】** ||||
| 1 | **P0-a** | **設計書 全文を読み、実装仕様を抽出**（`schema.prisma` / `PHASES.md` / `RULES.md` / `GLOSSARY.md` / `check-consistency.sh`）※Opus・**全文読込必須** | — | 1 |
| 2 | **P0** | Docker Compose（web/db/worker）＋Next.js 15＋Prisma＋Auth.js＋launchd常駐 | P0-a | 1.5 |
| 3 | **P1** | 既存データ移行（media.db / timeseries.db → Postgres）＋worker が既存Pythonを呼べる | P0 | 1 |
| 4 | **P1.5** | **Notion 全DB移行**（記事/AIO/ネタ/リール・プロパティ全件・§7）＋並行稼働突合 | P1 | 1 |
| **【S1 計測 — ここが無いと全部が推測になる】** ||||
| 5 | **P2** | **CV配管**（`Lead` ＋ `/api/ingest/*` ＋ WPフォームWebhook ＋ 即時通知） | P0 | 1 |
| 6 | **P2.5** | **ファネル7段**（`VisitorSession` / `FunnelEvent` ＋計測タグ）＋A/B群割当モデル＋**計測タグ設計原則§3.10.3＋ingestレート制限** | P2 | 2.0 |
| 7 | **P2.6** | `Lead` 属性・興味・比較対象・経路・初動速度 ＋ フォーム項目設計 | P2 | 1 |
| 8 | **P2.7** | **初動自動対応**（起票→通知→自動返信→興味推定→返信ドラフト） | P2.6 | 1 |
| **【S2 可視化】** ||||
| 9 | **P3** | **ダッシュボード 段1〜段3・段7**（結果／ファネル／買い手の質／ジョブ健全性） | P2.5 | 2 |
| 10 | **P3.5** | **鮮度管理**（`freshnessTier` / `nextReviewDue` / `ArticleReview` ＋ overdue初回スキャン・§7.5） | P1.5 | 1 |
| 11 | **P3.7** | `UnitEconomics` ＋ **広告シミュレーター**（順算/逆算・3シナリオ） | P2.6 | 1.5 |
| **【S3 自動運営・PDCA】** ||||
| 12 | **P4** | **operator 週次**（段4変化・段5立案）＋承認/却下 Server Action ＋ `Intervention` 自動記録 | P3 | 2 |
| 13 | **P4.5** | `Keyword` 群（マスタ/研究/割当/順位）＋既存YAML・CSV移行 ＋ `/keywords` | P1 | 2 |
| 14 | **P4.6** | `Idea` ＋ **5供給源の自動起票** ＋ `/ideas` | P4.5 | 1.5 |
| 15 | **P4.7** | 鮮度アラート・カニバリ検出・striking distance の Action 自動起票 | P4.5 | 0.5 |
| 16 | **P4.3** | **トピッククラスタ**（`TopicCluster` / `ContentCluster` / `InternalLink` / `ClusterMetric`）＋既存157記事の自動割当＋599リンク正規化＋**構造欠陥の初回スキャン**＋`/clusters` ツリー | P4.5 | 2 |
| 17 | **P4.9** | `budgetTier` / `funnelStage` / `productFit` の一括タグ付け（既存157記事＋KW・AI補助） | P4.5 | 1 |
| 18 | **P4.10** | `KeywordVolume` / `KeywordCluster` / **`CtrCurve`（自社実測CTR曲線）** | P4.5 | 1 |
| **【S4 チャネル拡張】** ||||
| 19 | **P5** | Threads / AIO 配管（GAS→ingest、aio-batch→jobs） | P1 | 1 |
| 20 | **P5.6** | `AgencyLead` / `Partner`（DM triage のDB化・GAS連携） | P5 | 1 |
| 21 | **P5.7** | `LineFriend` / `LineMessage`（LINE Messaging API連携） | P2 | 1 |
| **【S5 市場・競合・広告】** ||||
| 22 | **P6.7** | `SerpSnapshot`（DataForSEO 週次・AIO有無含む）／`Competitor` | P4.10 | 1 |
| 23 | **P6.8** | `MarketShare` / `Opportunity` の自動算出 ＋ `/market` | P6.7 | 1.5 |
| 24 | **P7.5** | 広告 API 連携（`AdAccount`〜`AdMetricDaily`・gclidでLead突合） | P3.7 | 1.5 |
| 25 | **P7.6** | CPA判定・停止/増額の自動起票 ＋ SEO vs 広告比較 | P7.5 | 0.5 |
| **【S6 完成】** ||||
| 26 | **P7** | `/content` 移植（console.html の5タブ）→ console.html 退役 | P3 | 2 |
| 27 | **P8** | operator 日次・月次（異常検知→即応・施策の生死判定）＋ `/experiments` | P4 | 1.5 |
| 28 | **P6** | Notion 停止（`notion-sync.py` 削除・CLAUDE.md 修正） | P1.5 | 0.5 |
| 29 | **P9** | Cloudflare Tunnel ＋ Access（スマホ閲覧） | P3 | 0.5 |
| **【S7 品質・法務・復旧 — §16 積み残し】** ||||
| 30 | **P0.5** | 個人情報・同意対応（ポリシー改定案・同意チェックボックス・`ConsentRecord`）＋専門家確認 | — | 0.5 |
| 31 | **P0.7** | バックアップ3箇所・`RECOVERY.md`・段7表示 | P0 | 0.5 |
| 32 | **P1.7** | タイムゾーン正規化ルール ＋ `AuditLog` | P1 | 0.5 |
| 33 | **P2.4** | **計測検証基盤**（合成モニタリング・突合・ボット除外・外れ値検知） | P2.5 | 1 |
| 34 | **P4.4** | `ContentVersion` ＋ ロールバック実行 | P4 | 0.5 |
| 35 | **P4.8** | 判定の信頼度（対照群最小基準・バッチ判定・inconclusive のUI表現） | P4 | 0.5 |
| **【S8 記事ライフサイクル — §3.6】** ||||
| 36 | **P3.3** | **`IndexStatus`**（GSC URL Inspection API・未インデックス検知） | P1 | 0.5 |
| 37 | **P3.4** | `PageExperience`（CWV / PSI・モバイル別） | P1 | 0.5 |
| 38 | **P4.2** | **`LeadTouchpoint`**（マルチタッチ・アシスト貢献） | P2.5 | 1 |
| 39 | **P4.11** | `ProductionCost`（記事別ROI） | P4 | 0.5 |
| 40 | **P5.8** | `trafficSource` / `aiEngine` 判別（AI検索流入） | P2.5 | 0.5 |
| 41 | **P6.9** | **`Backlink` / `DomainAuthority`**（DataForSEO・自社＋競合） | P6.7 | 1 |
| 42 | **P8.2** | `ContentLifecycle` / `UrlRedirect` ＋ プルーニング自動起票 | P4.3 | 1 |
| **【S9 検証手法 — §3.7】** ||||
| 43 | **P2.8** | **Microsoft Clarity 導入**（タグ設置＋フォームマスキング） | — | 0.1 |
| 44 | **P4.12** | **SEOスプリットテスト**（層別ランダム化・判定・主判定手法） | P4.3 | 0.5 |
| 45 | **P7.7** | LP/CTA A/Bテスト（サンプル数計算・underpowered拒否） | P2.5 | 1 |
| **【S10 運用・業務・外部環境 — §3.8】** ||||
| 46 | **P2.9** | `LandingPage` / `LpVersion` ＋ 既存LP投入 | P2.5 | 0.5 |
| 47 | **P2.10** | 電話CTAクリック計測 ＋ `/leads` 手動登録UI ＋ `sourceType` | P2.6 | 0.3 |
| 48 | **P3.8** | `RegulatoryEvent`（税制改正カレンダー）＋60日前の自動起票 | P1 | 0.5 |
| 49 | **P4.13** | `SeasonalityIndex`（季節調整）＋段1・段4への併記 | P4.10 | 0.5 |
| 50 | **P5.9** | `SnsAccountHealth` / `PostSchedule` / `CrossPromotion` | P5 | 1 |
| 51 | **P6.10** | **m2連携**（`Lead` ⇄ m2 Deal・成約結果の還流） | P2.6 | 1 |
| **【S11 実運用・品質・信頼性 — §3.9】** ||||
| 52 | **P1.8** | **WP書き込みのMMS一本化**（`wp-publish.py` API化）＋日次ハッシュ突合 | P1 | 1 |
| 53 | **P3.9** | `UptimeCheck`（5分間隔・フォーム含む） | P0 | 0.3 |
| 54 | **P4.14** | `GenerationProvenance`（スキル/モデルのバージョン記録） | P4 | 0.3 |
| 55 | **P6.11** | `LinkCheck`（週次・tier1優先） | P4.3 | 0.5 |
| 56 | **P8.3** | `BrandMention`（レピュテーション監視） | P5 | 0.5 |
| **【S12 性能事故の再発防止 — §3.10】** ||||
| 57 | **P1.9** | `PerfGate`（デプロイ前後PSI計測・劣化でブロック） | P0 | 0.5 |
| 58 | **P2.11** | **`TelemetryVolume`（発火回数監視）＋閾値アラート＋ワンクリック停止** | P2.5 | 0.5 |
| 59 | **P3.10** | `Incident` ＋ 過去5件の登録 | P0 | 0.3 |
| **合計** | | | | **約52.5日** |

### 9.2 スコープ外（将来）

| Phase | 内容 | 条件 |
|---|---|---|
| P10-a/b/c | コンテンツ販売事業・新Threadsアカウント・`PostPattern` 横断化 | 石井が新アカウント開始を決めたら |
| P5.5 | `Channel(type=note)` ＋ 月次手入力（note公式APIなし・§11.2） | note 開始時 |

### 9.3 マイルストーン（途中で価値が出る区切り）

| 区切り | 到達点 | 累計 |
|---|---|---|
| **M-A: P0-a〜P2.11（＋P1.8/P1.9/P3.9/P3.10）** | **計測が始まり、正しいと保証され、暴走しない。** 実装仕様の抽出／Clarity／LP管理／電話／WP一本化／死活監視／**発火回数監視・性能ゲート** | **15.0日** |
| **M-B: 〜P3.7（＋P3.3/P3.4）** | **見える化が完成。** 獲得3ゴール・ファネル・買い手の質・鮮度・**インデックス状況**・ページ体験・広告試算 | **15.5日** |
| **M-C: 〜P4.11** | **PDCAが回る。** 承認→実行→対照群補正つきで自動判定。**アシスト貢献で記事評価が正しくなる**。クラスタ単位で母数が足りる | **27日** |
| **M-D: 〜P7.6（＋P6.9）** | **市場・競合・被リンク・広告が見える。** 「1〜3位が0本」の原因が特定できる | **36日** |
| **M-E: 全完了** | Notion廃止・console退役・スマホ閲覧・プルーニング・A/B・m2連携・品質監視 | **52.5日** |

> **M-A に P2.4（計測検証）を必ず含める。** 計測が正しいと保証されない状態で以降を積み上げると、全部が砂上の楼閣になる。

> **推奨: M-A（15.0日）で一度止めて実際に使う。** 計測が始まればデータが溜まり始め、以降の設計判断が実測ベースになる。

### 9.4 ★モデル振り分けとトークン戦略（Claude Code 実装時）

> 原則は CLAUDE.md §8（判断・戦略・執筆=Opus / 定型処理・検証=Sonnet / 軽作業=Haiku）を踏襲。
> **判断を誤ると全体が壊れる箇所だけ Opus。実装の主力は Sonnet。**

#### 9.4.1 Opus（判断・設計の中核 — 全体の約2割）

**理由: ここを間違えると、後続の全実装が土台から壊れる。**

| Phase | 内容 | Opusを使う理由 |
|---|---|---|
| **P0** | Prisma 初期スキーマ確定 | 82モデルの関係性・制約。後から直すとマイグレーション地獄 |
| **P2.4** | 計測検証基盤（合成モニタ・突合設計） | 「何を正とするか」の判断。誤ると全数値が信用できない |
| **P3.7** | UnitEconomics・広告シミュレーター | 計算式の設計。誤ると投資判断を誤る |
| **P4** | operator 週次 — **立案ロジック** | 入力7種から打ち手を導く設計。システムの頭脳 |
| **P4.7** | 鮮度・カニバリ・striking distance の判定 | 閾値と優先順位の設計 |
| **P4.8** | 判定の信頼度（対照群・統計） | 統計的妥当性。誤ると誤った学習が蓄積する |
| **P4.12** | SEOスプリットテスト（層別ランダム化） | 層の切り方で結論が変わる |
| **P4.13** | 季節調整 | 補正式の設計 |
| **P6.8** | MarketShare / Opportunity 算出 | CTR曲線・機会損失の計算設計 |

#### 9.4.2 Sonnet（実装の主力 — 全体の約6割）

**理由: 設計が決まっていれば実装は定型。量が多いのでSonnetが最適。**

- **API・CRUD・Webhook**: P1、P1.5、P1.7、P1.8、P2、P2.5、P2.6、P2.9、P5、P5.6、P5.7、P6.10
- **画面実装**: P3、P4.5（/keywords）、P4.6（/ideas）、P6.8（/market の描画部）、P7（/content 移植）
- **外部API連携**: P6.7（DataForSEO）、P7.5（Google Ads/Meta）、P3.3（GSC URL Inspection）、P3.4（PSI）、P6.9（Backlinks）
- **移行スクリプト**: P1、P4.3、P4.5、P4.9
- **監視系**: P1.9、P2.11、P3.9、P6.11、P8.3
- **PDCA周辺**: P4.2、P4.4、P4.14、P8、P8.2

> **注意**: 移行スクリプト（P4.3のクラスタ自動割当・P4.9のタグ付け）は「**Sonnetがスクリプトを書いて実行**」する。157記事をAIが1本ずつ判定するのではなく、**ルール＋一括処理＋人の承認**にする。ここを取り違えるとトークンを数十倍消費する。

#### 9.4.3 Haiku（軽作業 — 全体の約2割）

| Phase | 内容 |
|---|---|
| **P2.8** | Clarity タグ設置（コピペ＋マスキング属性付与） |
| **P2.10** | 電話CTAクリック計測＋手動登録UI（小規模） |
| **P3.10** | `Incident` 過去5件の登録（データ入力） |
| **P0.7** | `RECOVERY.md` の作成・バックアップスクリプト |
| — | 定型テストの生成、ドキュメント整形、seedデータ作成 |

#### 9.4.4 Fable 5（長時間自律 — 選択的に2箇所のみ）

**大量ファイルにまたがる実装を一気に片付ける場合のみ。** 単価は高いが、人の介入回数が減るため総コストで有利になることがある。

| Phase | 使う理由 |
|---|---|
| **P0** | Docker Compose + Next.js + Prisma + Auth.js + launchd を一気に立ち上げる（ファイル数が多く、往復が増えるとかえって高くつく） |
| **P7** | `/content` 移植（console.html の5タブを React へ。画面が大きい） |

> **それ以外では使わない。** 単発の実装は Sonnet で十分。

#### 9.4.5 ★コンテキスト戦略 — 「読む量を減らす」のではなく「読まなくても間違えない構造にする」

> **石井指摘（2026-07-20）: 「トークンの節約のために読み込みの手抜きをしては意味がない」**
>
> **これは正しい。** 本設計書の作成過程で実際に、**スキーマの二重定義・段番号のズレ・ロードマップの6分散**が発生した。
> 原因はすべて「**全体を読まずに追記した**」こと。**「必要な節だけ読む」は、その失敗を制度化する誤った方針だった。**
>
> **原則を置き直す: 正確さ > 効率。効率化は、正確さを落とさない方法でのみ行う。**

**❌ やってはいけない（前版の誤り）**
- 設計書の一部だけを読んで実装する
- 「たぶんこういう定義だろう」で書く
- 他セクションとの整合を確認せずに追記する

**✅ 正しいアプローチ — 参照先を「短く・正確に・単一に」する**

設計書（2,600行）は**人が合意するための文書**であり、**実装の入力に直接使わない**。
P0で**一度だけ全文を読み、機械可読な実装仕様に落とす**。以降はその抽出物が正。

| 成果物 | 内容 | 行数目安 | 誰が読むか |
|---|---|---|---|
| **`prisma/schema.prisma`** | 82モデルの完全定義（**唯一の正**） | 〜700行 | 全Phase |
| **`docs/PHASES.md`** | 58 Phase の定義・依存・完了条件・担当モデル | 〜200行 | 全Phase |
| **`docs/RULES.md`** | 実装規約（計測タグ原則§3.10.3／欠測規約§3／段番号§4.1／命名／provenance） | 〜150行 | 全Phase |
| **`docs/GLOSSARY.md`** | 用語（buyerFit・funnelStage・freshnessTier の定義と値） | 〜80行 | 全Phase |
| 設計書（本ファイル） | 判断の背景・却下した案・数値の根拠 | 2,600行 | **レビュー時・設計変更時に全文** |

> **抽出物は設計書と1対1対応する。** だから抽出物だけを読んでも手抜きにならない。
> **抽出作業そのものは絶対に手を抜かない**（P0・Opus・**設計書全文を読む**）。

**整合を人の記憶に頼らない（機械で担保する）**

| 仕組み | 内容 |
|---|---|
| **型** | TypeScript ＋ Prisma生成型。**モデル定義を思い出す必要がない**（間違えたらコンパイルが通らない） |
| **テスト** | 集計ロジックはゴールデンデータで検証（§16.1⑥） |
| **整合チェックスクリプト** | `docs/check-consistency.sh`：①`schema.prisma` のモデル数 = 設計書の `model` 数 ②Phase番号の重複なし ③段番号の参照が §4.1 と一致 ④ロードマップが §9 のみに存在 — **本設計書のレビューで実際にこの検査を行い、不整合を検出した** |
| **各Phase完了時の照合** | 実装物と設計書の該当節を突き合わせる（**Haiku で可**。ただし「読まずに合格」にしない） |

**その上で行う効率化（正確さを損なわない範囲）**

| ルール | 内容 |
|---|---|
| ① 1セッション = 1Phase | コンテキストの混線を防ぐ。**節約が目的ではなく、混線による事故を防ぐのが目的** |
| ② 既存Python資産は読まない | worker から**呼ぶだけ**で中身に依存しない設計（§6）。これは手抜きではなく**疎結合** |
| ③ 触るファイルを事前に明示 | 探索的に大量のファイルを読ませない |
| ④ 小さく作って確認 | 大きく生成して直すより総コストが低く、**かつ間違いに早く気づく** |
| ⑤ lint・型チェック・テスト実行は Haiku | 判断を伴わない検証作業 |

> **⑤の注意**: Haiku に任せるのは「**機械的な検証の実行**」であって「**設計との整合の判断**」ではない。後者は Sonnet 以上。

---

### 9.5 依存関係の注意

- **P2（CV配管）が全ての起点**。ここが無いと `Lead` も `Intervention` も評価できない
- **P4.5（Keyword群）は P4.6〜P4.10 の前提**。先に片付ける
- P3.7（広告シミュレーター）は**広告を回さなくても価値がある**（SEO投資判断の基準線になる）

---

## 10. なぜこれが「壊れずに強化できる」のか

| 拡張シナリオ | 必要な作業 |
|---|---|
| Instagram を追加 | `Channel` を1行INSERT ＋ ingest 用の Route Handler 1本。**スキーマ変更なし** |
| 新しい指標（例: AI引用hit率）を追加 | `MetricSnapshot.metric` に値が増えるだけ。**マイグレーション不要** |
| 新規事業を追加 | `Business` を1行INSERT。ダッシュボードに自動で行が増える |
| 新しい打ち手の型を追加 | operator の立案ロジックに1関数。UIは `Action` を表示するだけなので変更不要 |
| パートナーに一部を見せる | Auth.js の Role を付与。既に権限モデルがある |

**汎用モデル（Business / Channel / Metric / ContentItem / Action）に寄せてあるので、追加は「データが増える」であって「コードが増える」ではない。** これがv1・v2との決定的な差。

---

## 11. 拡張ケーススタディ: 別アカウント × note収益化（2026-07-20 石井方針）

> ⚠️ **着手時期: 未定（2026-07-20 石井「noteはまだ開始しない。将来的に追加されると思っていればよい」）。本セクションは"将来こう載る"ことを確認するための設計であり、初期スコープには含めない。**
>
> 石井方針: 現Threadsは節税総研（節税商材代理店事業）。**タイミングを見て別アカウントを立て、note収益化に挑戦する**（＝コンテンツ販売事業・`~/Documents/Claude/Projects/経営戦略室/40_事業_コンテンツ販売`）。
> これは §10 の「壊れずに強化できる」の実地テストになる。以下、本設計で何が起き、何を追加で決めるべきかを具体化する。

### 11.1 データモデル上、何が必要か → ほぼ何も要らない

| 追加要素 | 作業 |
|---|---|
| コンテンツ販売事業 | `Business` を1行INSERT（既にモデル対応済） |
| 新Threadsアカウント | `Channel(type=threads, businessId=コンテンツ販売, config={account_id, token})` を1行INSERT |
| note | `Channel(type=note, businessId=コンテンツ販売)` を1行INSERT |
| note の販売実績 | `Lead(type=note_purchase, closedAmount=金額)` — **既存モデルのまま**。金額列は最初から持たせてある |
| note のPV・スキ | `ContentMetric(metric='note_views' / 'note_likes')` — **マイグレーション不要** |

**スキーマ変更ゼロ。** `Channel` を「プラットフォーム単位」ではなく**「プラットフォーム × アカウント単位」**にしてある設計がここで効く。

### 11.2 ★重大な制約: note には公式APIが無い（2026-07 時点）

これは設計に直結するため、先に事実を確定させる。

- **note は公式APIを提供していない**（note公式ヘルプが明言・公開予定も未定）
- 非公式API（`note.com/api/v1|v2/...`）は規約・robots.txt上グレー
- **2026年2月の仕様変更**でプログラム経由の記事情報取得が塞がれた報告あり
- **2026年5月下旬から認証APIに reCAPTCHA v3 が必須化**され、自前スクリプトによるログインは事実上不可
- 結果: **売上・PVの自動取得はできない**

**設計への反映（必須）**

1. `Channel(type=note)` は **手動入力チャネル**として最初から定義する
2. `/api/ingest/manual` と **月次入力フォーム**（`/note` 画面）を P5 のスコープに含める
   - 入力項目: 商品別 販売数・売上金額・PV・スキ・フォロワー（noteダッシュボードを見て月1回転記／所要2分）
3. **未入力なら段1の信号が黄色になる**（＝入力漏れが可視化される）
4. 非公式APIのスクレイピングは**採用しない**。理由: ①規約グレー ②2026年に2度塞がれた実績があり保守が破綻する ③アカウントBANは事業の即死につながる
5. 代替の自動化: **売上の正はnote、リードの正はMMS**。Threads→note の遷移は `?from=` 付きリンクで自前計測できる（noteの外側は取れる）

> **これは弱点ではなく設計判断。**「取れないものは手入力で確実に」を最初から組み込む方が、壊れる自動化を作るより結果が続く。月2分の手入力で、noteのAPI仕様変更に一切影響されなくなる。

### 11.3 新アカウントの投稿は GAS ではなく MMS worker から出す

| アカウント | 投稿経路 | 理由 |
|---|---|---|
| 節税総研（現行） | **GAS継続** | 稼働中で安定。壊す理由がない |
| 新アカウント | **MMS worker から Threads API 直叩き** | MMSの実力検証を新規側で行う。安定を確認できたら節税総研もGASから移管 |

**投稿の分離ガード（事故防止・必須）**
- `Channel` にアカウント資格情報を紐付け、**worker は `channelId` 経由でしかトークンを引けない**
- `ContentItem` は必ず `channelId` を持つ。**channelId 無しの投稿はAPIレベルで拒否**
- 節税総研アカウントに副業ネタを誤爆する事故を、構造的に不可能にする

> コンテンツ販売事業部 CLAUDE.md §7 の公開前ゲート「**本業毀損チェック**（補助金案件・受注単価・顧客が特定される表現）」は、MMS側でも `Business` 別の公開前チェックとして実装する。

### 11.4 これが最大の資産になる: パターンの横展開

節税総研Threadsは既に **Phase 1（全パターンに N≥5 を溜める）** を回しており、`?action=format_analysis` でフォーマット × ターゲット × コアメッセージの分析が動いている。

→ **`PostPattern` を `Business` 横断の共有テーブルにする**（設計追加）

```prisma
model PostPattern {          // Good/Bad型・早口型・ストーリー型 …
  id, name, structure, hypothesis
  metrics PatternMetric[]    // businessId 別の成績を保持
}
```

- 節税総研で**検証済みの勝ち型**を、新アカウントの初期投稿設計にそのまま適用できる
- 新アカウントはゼロスタートではなく、**N≥5 で検証済みの型を持って始められる**
- 逆に新アカウント（非YMYL＝表現の自由度が高い）で見つかった型を、節税総研に慎重に逆輸入する経路も持つ

これは他社が真似できない、**2アカウント運用だからこそ生まれる資産**。

### 11.5 反論（石井さんに必ず伝えるべきこと）

1. **Threads調査で見た「ツールの話自体が商品」の世界に、自ら入ることになる**（§5 参照）。あの界隈は「作った（＝作りかけ）」を売る人で飽和している。
   → **差別化は1点のみ: 実際に本業で回っている実績があること**。「Fable5で今作ってる」勢に対し、石井さんは「157記事・Threads 70本/週・GSC/GA4連携・公開ゲート自動化を**本番で回している**」。実績開示が売れ筋ジャンルの参入条件である以上、ここが唯一かつ十分な武器。**MMSの構築過程そのものが最良のコンテンツになる**。
2. **noteのAI規約は味方**。100%AI生成は規約違反・AI利用の明記が必須。メディア事業部のYMYL運用（人間レビュー・独自体験・検証ゲート）を持つ側が有利になる。量産勢が淘汰される方向。
3. **プラットフォーム依存＋API無し**の二重リスク。noteで完結させず、**LINE/メールリストへの退避導線を最初から必須**にする（コンテンツ販売事業部 CLAUDE.md §7 に既に規定あり）。
4. **タイミングの論点**: 節税総研側は問い合わせ0・LINE 0 で North Star が未達。新アカウントを**同時並行で立ち上げると、どちらも中途半端になるリスク**がある。
   → 推奨: **MMSのコア（P0〜P4）を節税総研で完成させ、「見える・動く・承認できる」を体感してから新アカウントを立てる**。新アカウントは最初からMMSに載った状態でスタートでき、立ち上げ速度が上がる。順番を逆にすると、計測できない新事業がもう1つ増えるだけになる。

### 11.6 ロードマップへの追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。

---

## 12. 手動ステップの自動化 — 現状の全棚卸しと判定

> 石井質問「運用の手動ステップは新規で開発するシステムでは自動化できますか？」への回答。
> **結論: 現在14ある手動ステップのうち、10が完全自動化、3がワンクリック化、1が半自動（残す）。**

### 12.1 なぜ今まで自動化できなかったのか（根本原因）

現行の手動ステップの大半は「石井さんがやりたくてやっている」のではなく、**技術的制約の産物**。

| 制約 | 影響 |
|---|---|
| **Cowork sandbox の 45秒実行上限** | AIOバッチ（Hot tier 35分）・News fetch・ラッコ大量取得が sandbox 内で完走できない → **「リマインダーを送るので石井さんがローカルで実行してください」方式**になっていた（Scheduled 11タスク中 5つがこれ） |
| **sandbox mount 越しの SQLite 書込制限** | timeseries.db への書込が sandbox から不可 → `intervention-record.py` は石井ローカル実行のみ → **記録が9件しか溜まっていない** |
| **セッションが切れると状態が消える** | 長時間ジョブ・リトライ・失敗検知が持てない |

**MMSは常駐サーバー（Docker/launchd）なので、この3つが全て消える。** 時間制限なし・DB書込自由・状態を持てる。
→ **「リマインダー方式」の5タスクは、そのまま自動実行に変わる。** これが今回の最大の勝ち筋。

### 12.2 全手動ステップの判定表

| # | 現在の手動ステップ | 現状 | MMS後 | 判定 |
|---|---|---|---|---|
| 1 | AIOバッチ Hot/Warm/Cold の実行 | リマインダー→石井がローカルで `cron/aio-batch.sh` | **worker が完全自動実行**（時間制限なし）。結果は `ContentMetric` へ直接 | ✅ 完全自動 |
| 2 | News monitor（平日朝）/ weekly（金） | 同上（石井ローカル） | **worker が自動実行**。速報候補は `ContentItem(status=idea)` として自動起票 | ✅ 完全自動 |
| 3 | 月次KW戦略の実行 | リマインダー→石井が実行 or Coworkチャットで依頼 | **worker が自動実行**し、戦略ドラフトを `/keywords` に生成。石井は見るだけ | ✅ 完全自動 |
| 4 | `intervention-record.py` の実行 | **石井ローカル手動（記録9件＝ほぼ抜けている）** | **publish/更新時にDBへ自動INSERT**。人が触らない | ✅ 完全自動 |
| 5 | Notion 同期（notion-sync.py 等） | publish のたびに実行必須 | **Notion廃止。同期そのものが消滅** | ✅ 消滅 |
| 6 | Rank Math メタ書込の手動補完 | 失敗時に curl で手動 | **失敗をジョブとして再キュー＋指数バックオフ**。3回失敗で段7に赤表示 | ✅ 完全自動 |
| 7 | アイキャッチ生成＋WP紐付け（⑮-eye） | スクリプト実行（手動キック） | **記事パイプラインのジョブに組込** | ✅ 完全自動 |
| 8 | GSC生成AI露出のUI確認（月初週） | 石井がGSC画面を目視 | **API提供後に自動取得**。提供までは「確認タスク」を段5に自動起票 | 🔶 API待ち |
| 9 | 週次KPIの経営戦略室への転記 | 週次サマリーを石井が転記 | **`MetricSnapshot` に直接入り、ダッシュボードが常に最新**。転記という概念が消える | ✅ 完全自動 |
| 10 | LINE友だち数・問い合わせ件数の聞き取り | 石井から口頭/手入力 | **Webhookで即時記録**（LINE公式・フォーム） | ✅ 完全自動 |
| 11 | Threads 日次監視・ヒット横展開 | GAS＋Cowork Scheduled | **worker に統合**。ヒット検知→横展開生成→キュー投入まで自動 | ✅ 完全自動 |
| 12 | **WP記事の draft → publish 切替** | 石井が目視して切替 | **段5で [承認] を押すと worker が publish 実行** | 🔷 ワンクリック化（**ゼロにしない**） |
| 13 | **一次情報ファクトチェック（⑬c）** | 石井が一次ソースと照合 | **AIが照合表を自動生成**（数値×一次ソース実ページのURL・引用箇所）。石井は表を見て承認 | 🔷 ワンクリック化 |
| 14 | **Threads DM triage（代理店興味）** | 全件承認制 | **AIが分類＋返信案を生成**、石井は承認のみ | 🔷 ワンクリック化 |
| 15 | ラッコKW取得時の **CAPTCHA突破** | 出たら石井が対応 | **AI突破は禁止ルール（維持）**。CAPTCHA検出時のみ通知し、それ以外は自動 | 🔸 半自動（意図的に残す） |
| 16 | アーカイブ移動 | 石井承認 | 段5で [承認] | 🔷 ワンクリック化 |

### 12.3 「自動化できるが、してはいけない」もの

**技術的には全自動にできるが、意図的に人の承認を残すべきもの。** ここを曖昧にすると事故が起きる。

| 対象 | 残す理由 |
|---|---|
| **WP公開の最終切替** | YMYL（税務）。誤情報の公開は税理士法・景表法リスクに直結し、取り返しがつかない。**バリデータ全通過＋AI照合表付きで「読んで押すだけ」まで削るが、押すのは人** |
| **一次情報ファクトチェックの承認** | 同上。AIが照合表を作ることと、その表が正しいと判断することは別 |
| **DM/リプの個別税務相談・批判への返信** | 税理士法（個別税務助言の禁止）＋レピュテーション |
| **CAPTCHA** | Bot検知ポリシー違反。アカウントBANは事業の即死 |
| **撤退・大型投資の判断** | 経営判断そのもの |

**設計思想: 「AIが判断材料を完成させ、人は3秒で押す」。** 石井さんの作業時間はほぼゼロになるが、責任の所在は人に残す。

### 12.4 定量的な効果（推定）

| 項目 | 現在 | MMS後 |
|---|---|---|
| 石井さんがローカルでコマンド実行する回数 | **週5〜8回**（AIO・News×2・KW・intervention 等） | **0回** |
| Cowork Scheduled のリマインダー | 11タスク中5つが「実行してください」通知 | **0**（jobsに統合され自動実行） |
| intervention の記録率 | 実測9件（大半が未記録） | **100%**（publish時に自動） |
| 転記作業（週次KPI→経営戦略室） | 週1回 | **0**（概念が消える） |
| 石井さんに残る作業 | 上記全部＋承認 | **承認ボタンのみ** |

---

## 13. SEOキーワード・記事ネタの管理

> 石井質問「SEOキーワードや記事ネタなどもちゃんと管理できるようになっているか？」への回答。
> **結論: できる。むしろ現状で最も"管理されていない"領域なので、ここが一番伸びる。**

### 13.1 現状の資産と問題点

| 資産 | 場所 | 問題 |
|---|---|---|
| 月次KW戦略 | `~/Documents/Claude/Projects/メディア事業部/shared/keywords/2026-07_kw-strategy.md` 他5本 | **Markdownなので横断集計・検索・並べ替えができない** |
| 取得KWのマニフェスト | `rakko-monthly-manifest.yaml`（vol/difficulty/cpc/target_articles/status） | 構造はしっかりしている。**が、月ごとに分断されていて通史が見えない** |
| ラッコ実データ | `rakko-exports/2026-05〜07/<kw>/` にCSV 6本＋meta.yaml（3ヶ月で40KW超） | **CSVのまま。共起語・競合H2・PAAがDBに入っていないので活用が記事執筆時だけ** |
| 記事↔KWの対応 | `art-kw-map.yaml` | 単一ファイル。**カニバリ（同一KWに複数記事）の自動検出ができない** |
| 順位・表示 | timeseries.db `query_weekly`（1,000行） | KWマスタと**紐付いていない**。「狙ったKWが今何位か」が一発で出ない |
| 記事ネタ | Notion ネタ管理DB | **Notion廃止対象。移行先が必要** |
| 90日鮮度ルール | `validate-article.py` Check #72 | **公開直前に弾かれる＝遅い**。事前に気づけない |

**要約: データは十分にあるが、繋がっていない。** 「狙ったKW → 割り当てた記事 → 現在の順位 → 次にやること」が一本の線にならない。

### 13.2 追加するデータモデル

> **モデル定義は §3（統合版 v4）が唯一の正。** 以下で言及するモデルの定義は §3 を参照する（ここには再掲しない — 二重定義による実装事故を防ぐため）。

### 13.3 これで自動化される「管理」

| 機能 | 内容 |
|---|---|
| **鮮度アラート** | `KeywordResearch.expiresAt` が近いKWを段1に黄色で表示。**公開直前に弾かれるのではなく、30日前に再取得ジョブが自動で走る** |
| **カニバリ自動検出** | `KeywordAssignment` の `main` 重複をDB制約で検出。既存のカニバリマップ（PRJ-031 WS-C）が常時最新になる |
| **striking distance 自動抽出** | `KeywordRanking` から 11〜20位のKWを毎日抽出 → **Action として段5に自動起票**（現在は週次サマリーの表を人が読んでいる） |
| **狙ったKWの現在地が一目で分かる** | `/keywords` 画面で「KW / 狙い / 割当記事 / 現在順位 / 前週差 / 次の一手」が1行で並ぶ。**現在これができる画面が存在しない** |
| **KW通史** | 月ごとに分断されていた戦略シートが1つのマスタに統合。「このKWは4月に狙って、6月に記事化して、今12位」が追える |

### 13.4 ネタが自動で供給される仕組み（★ここが統合の最大価値）

`Idea` は手で書くものではなく、**システムが自動で起票する**。供給源は5つ。

| 供給源 | ロジック | 起票例 |
|---|---|---|
| **① GSCギャップ** | 表示回数はあるのに、対応記事が無い／順位が低いクエリを日次抽出 | 「"経営力向上計画 却下" 表示82・記事なし → 新規記事」 |
| **② ラッコ PAA/Q&A** | `KeywordResearch.qaQuestions` のうち未回答のものを抽出 | 「"即時償却は中古でも使える？" → ART-015 のFAQに追加」 |
| **③ News monitor** | 税制改正・倒産・行政指導の検知 | 「令和9年度税制改正大綱 → 速報記事」 |
| **④ Threadsヒット投稿** | 平均viewsの1.5倍を超えた投稿を記事化候補に | 「"決算賞与の落とし穴" 投稿が3,200views → 記事化」 |
| **⑤ AIO ミス** | AIO計測で hit しなかったプロンプトをコンテンツギャップとして起票 | 「"中小企業 節税 おすすめ" で未引用 → 比較記事の強化」 |

**④が統合システムでしか作れない価値。** Threadsで反応が取れたネタを記事に、記事で順位が取れたテーマをThreadsに——**チャネル間でネタが循環する**。今はデータが別々なので、この循環が人の記憶に依存している。

各 `Idea` には `impacts`（効く結果指標）が必須なので、**結果に効かないネタは起票された時点で下位に沈む**。

### 13.5 画面 `/keywords` と `/ideas`

**`/keywords`**
| KW | Vol | 難易度 | 優先 | 割当記事 | 現在順位 | 前週差 | 鮮度 | 次の一手 |
|---|---|---|---|---|---|---|---|---|
| 小規模企業共済 シミュレーション | 2,900 | 28 | 🔴 | ART-047 | 14.2 | ▲+1.8 | 残62日 | リライト提案済 |
| 事業承継税制 延長 | 320 | 38 | 🔴 | ART-161 | 13.8 | →±0 | 残62日 | — |
| GPUサーバー 節税 リスク | 390 | 25 | 🟠 | ART-086/090/093 | 6.5 | ▲+0.5 | 残62日 | ⚠️カニバリ疑い |

**`/ideas`** — 供給源別・スコア順。[記事化する] を押すと `ContentItem(status=draft)` が作られ、ラッコ取得ジョブまで自動で走る。

### 13.6 移行

| 現在 | 移行先 | 方法 |
|---|---|---|
| `rakko-monthly-manifest.yaml`（3ヶ月分） | `Keyword` | パーサ1本で投入 |
| `rakko-exports/*/` CSV 6本×40KW超 | `KeywordResearch` | 取込スクリプト（既存 `rakko-import.py` を流用） |
| `art-kw-map.yaml` | `KeywordAssignment` | 同上 |
| `2026-04〜07_kw-strategy.md` | `Keyword.priority` / `notes` | 手動＋AI補助（通史として保存） |
| timeseries.db `query_weekly` | `KeywordRanking` | KW文字列でマッチング |
| Notion ネタ管理DB | `Idea` | エクスポート→投入 |

**ラッコ取得（Chrome MCP）は worker から自動実行**。CAPTCHA検出時のみ石井さんに通知（§12.3）。

### 13.7 ロードマップへの追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。

---

## 14. 獲得3ゴールに対する網羅性監査 ★本丸

> 石井「今回のメディアやSNSの運用だ。これが今のうちのメイン事業。**より多くの代理店開拓と問い合わせと公式LINE登録**を得る必要がある。**特に直のお客が最も欲しい**。そのための戦略を立てるための情報管理や自動化が全て揃っているか」
>
> **結論: 揃っていない。§1〜13は「何が起きたか」は分かるが、「誰を連れてきたか」が分からない。**
> 獲得3ゴールのうち、直客獲得に必要な情報が最も欠けている。以下、欠損を全て埋める。

### 14.0 3つのゴールは別物として設計する

| ゴール | 欲しい相手 | 導線 | 現状実測 |
|---|---|---|---|
| **① 直客の問い合わせ**（最優先） | **利益の出ている法人**（240万のMLを買える層） | 記事 → LP → フォーム | **★2件成約（2026-08着金予定・内諾）** |
| ② 代理店開拓 | 節税商材を売れる人・会社 | Threads代理店募集トラック 週18本 → DM → 自己選別 → 百瀬へ | 有効DM 月1件 |
| ③ 公式LINE登録 | ①②の手前の温め層 | **未実装**（登録する理由＝軽オファーが存在しない） | **0人** |

**3つは訴求も導線も計測も違う。** 現設計（v3時点）は `Conversion` を1つにまとめており、この違いを表現できていない。

> ### ★前提の更新（2026-07-20 石井確認）
> **メディア/SNS経由の直客が2台成約している**（2026-08着金予定・内諾済み／`~/Documents/Claude/Projects/経営戦略室/10_事業_節税商材代理店/04_数値KPI/2026-07-20_ML着金予定と直客初成約.md`）。
>
> 従来の前提「メディア経由リードは0・成約エンジンは100%代理店網」は**無効**。
> 週次サマリーの問い合わせ欄は「0」ではなく「**未計測**」であり、**成果が出ていたのに気づけていなかった**のが実態。
>
> **これにより本セクションの位置づけが変わる。**
> - 課題は「ゼロから立ち上げる」ではなく **「既に出ている2件を再現・増幅する」**
> - ファネル計測（§14.2）の価値は「0を1にする」ではなく **「勝ち筋がどこから来たかを特定する」** に上がる
> - `Lead`（§14.3）に **直客2件を遡及入力する**。これが最初かつ最重要のレコードになる
> - `buyerFit`（§14.1）は、この2件の属性から**買い手プロファイルを逆算**して定義する（机上の分類ではなく実データ起点）
>
> ⚠️ ただし母数2件。**この時点で戦略を大きく振らない**。経路を記録して再現性を検証するのが次の一手。

### 14.1 決定的な欠損① — 訪問者が「誰か」分からない（★最重要）

PRJ-031 診断（2026-06-09）の実測:
> 高PV記事は個人事業主向けシリーズ（小規模共済・青色申告・iDeCo）に偏っており、**240万のML買い手（利益の出ている法人）とズレている**。法人向け高インテント記事のPVは数十/月と薄い。

**つまり、PVの大半は買わない人。** ところが現設計には「この記事は誰向けか」を持つ場所が無い。

- `ContentItem` に読者属性が無い
- `Keyword` に `intent`（informational/commercial）はあるが、**`buyerFit`（法人／個人事業主／税理士／代理店候補）が無い**
- PRJ-031 は先行指標に「**法人テーマの clicks / PV**」を挙げているのに、**それを算出するタグが存在しない**

> ### ★軸の訂正（2026-07-20 実データにより判明）
> 初の直客成約は **個人事業主・ML 2台（約480万）** だった（`~/Documents/Claude/Projects/経営戦略室/10_事業_節税商材代理店/04_数値KPI/2026-07-20_ML着金予定と直客初成約.md`）。
> **「法人 vs 個人事業主」という切り方は誤り。** 正しい軸は次の2つ。
>
> | 軸 | 内容 |
> |---|---|
> | **① 投下可能な節税予算** | 小規模共済（月7万上限）・iDeCo（月6.8万上限）を調べる層は予算が小さい＝240万商材を買わない。法人格の有無ではなく**利益規模**が判別軸 |
> | **② 商材の比較検討段階** | 実際の買い手は **ビーコン / 外貨両替機 / ML を横断比較**していた。比較段階の読者が最も買い手に近い |
>
> ズレていたのは「個人事業主向け記事」ではなく **「低予算テーマ」**。この訂正を `buyerFit` の定義に反映する。

> **モデル定義は §3（統合版 v4）が唯一の正。** 以下で言及するモデルの定義は §3 を参照する（ここには再掲しない — 二重定義による実装事故を防ぐため）。

**実データによる裏付け（media.db・2026-07-20）**: 買い手が比較していた「ビーコン」「外貨両替機」は **ART-074「主力5商材を徹底比較」の1番目と2番目**。比較クラスタは既に11本、選び方クラスタは8本、外貨両替機9本、ビーコン3本が公開済み。**`funnelStage=comparison` の記事群が、直客を連れてきた最有力候補。**

**これで初めて出せる指標（今どれも出せない）**
- 法人向けクリック数 / 全クリック数（＝流入の質）
- buyer-fit 加重PV（買い手PVだけを数える）
- 「個人事業主向け記事に何時間投入したか」
- **買い手PVあたりの問い合わせ率**（真のCVR。全PV分母のCVRは意味が薄い）

> **この欠損を埋めないと、「PVは増えたが買い手ではない」を無限に繰り返す。** 石井さんの「直のお客が最も欲しい」に直結する最優先の追加。

### 14.2 決定的な欠損② — ファネルの中間が全部欠測

週次サマリー（2026-07-13）の実態:
```
クリック: 142
LP訪問: —(未計測)
LINE登録: —(未計測)
問い合わせ: —(未計測)
転換率: クリック→LP — / LP→LINE — / LP→問い合わせ —
```

**「どこで落ちているか」が一切分からない。** 改善が当て推量になる。記事から問い合わせまでに計測点が7つ必要。

| # | 計測点 | 分かること | 現状 |
|---|---|---|---|
| 1 | 記事内CTAの表示 | CTAまでスクロールされたか | ✗ |
| 2 | **記事内CTAのクリック**（記事別・位置別: ヒーロー/中盤/最終） | どの記事のどの位置のCTAが効くか | ✗ |
| 3 | LP到達 | 記事→LPの離脱率 | ✗ |
| 4 | LPのスクロール深度・セクション到達 | LPのどこで離脱するか | ✗ |
| 5 | フォーム到達 | CTAは押されたが入力に至らない層 | ✗ |
| 6 | フォーム項目別の離脱 | どの項目が重いか | ✗ |
| 7 | 送信 | 問い合わせ | ✗ |

> **モデル定義は §3（統合版 v4）が唯一の正。** 以下で言及するモデルの定義は §3 を参照する（ここには再掲しない — 二重定義による実装事故を防ぐため）。

**GA4に頼らず自前で持つ。** GA4は集計が粗く、記事単位×CTA位置単位のアトリビューションに弱い。1st-party Cookie + 自前イベントなら、`FunnelEvent` から**記事別の全段階転換率**が出る。

**これで出せる**: 「ART-088 はクリック60・CTA表示45・CTAクリック3・LP到達3・フォーム到達0」→ **LPで死んでいると特定できる**。

### 14.3 決定的な欠損③ — リードの中身が構造化されない

問い合わせが来ても、v3時点の `Conversion` は「いつ・どこから」しか持たない。**石井さんが本当に知りたいのは「どんな客か」**。

> **モデル定義は §3（統合版 v4）が唯一の正。** 以下で言及するモデルの定義は §3 を参照する（ここには再掲しない — 二重定義による実装事故を防ぐため）。

**これで初めて答えられる問い（今どれも答えられない）**
- **どの記事が「利益の出ている法人」を連れてくるか** ← 石井さんが最も欲しい情報
- どのKWが冷やかしを連れてくるか（＝書かなくていい記事）
- 商材別の需要（即時償却 vs 経営強化税制 vs ML）
- 初回接触記事（first touch）と最終記事（last touch）の違い

> **ここが埋まると、記事戦略が「PVを増やす」から「買い手を連れてくる」に変わる。**

### 14.4 代理店トラックの欠損

現状: Threads代理店募集 週18本 → DM → 定型自己選別質問（全件承認制）→ 有効DMは**日次報告で石井→百瀬へ手動転送**（`05-sales/agency-recruitment/dm-triage.md`）

**Markdownと手動運用なので、投稿→DM→有効→契約の歩留まりが測れない。**

> **モデル定義は §3（統合版 v4）が唯一の正。** 以下で言及するモデルの定義は §3 を参照する（ここには再掲しない — 二重定義による実装事故を防ぐため）。

**これで出せる**
- **代理店募集投稿1本あたりの有効DM数**（＝週18本が適正か過剰か判断できる。現在は勘）
- どの投稿フォーマットが代理店候補に刺さるか
- **既存代理店の稼働状況**（誰が実際に売っているか）→ 稼働している代理店のプロファイルを逆算して開拓ターゲットを絞る

### 14.5 LINE の欠損 — ゼロから作る必要がある

現状 **友だち0人**。原因は明確で、**登録する理由が存在しない**（軽オファー・リードマグネットが未実装）。PRJ-031 の打ち手①でも「無料相談一本のCTAは初回訪問者には重い。軽いオファー→LINE登録→教育→相談の階段を設計」と指摘済み。

**必要なもの（情報管理側）**
> **モデル定義は §3（統合版 v4）が唯一の正。** 以下で言及するモデルの定義は §3 を参照する（ここには再掲しない — 二重定義による実装事故を防ぐため）。

LINE Messaging API で友だち数・配信・反応が取得可能。登録経路は URL パラメータで記事別に分離できる。

> **計測を作らずにステップ配信を作っても改善できない。** LINE施策の着手前にこのモデルを入れる。

### 14.6 戦略立案に必要な「比較」情報の欠損

現設計は**自社データのみ**。戦略を立てるには相対位置が要る。

| 欠けている情報 | 用途 | 取得手段 |
|---|---|---|
| 競合が取っていて自社が取れていないKW | 記事の空白地帯を特定 | DataForSEO（$0.60/1,000 SERP＝**月数百円**）で主要KWの上位10サイトを定点取得 |
| 競合のLP・オファー構成 | 直客獲得の訴求改善 | 四半期に手動＋AI分析（既存 `2026-06-08_competitor-lp-analysis-wada-dss.md` の更新） |
| 他社の代理店募集条件 | 代理店開拓の競争力 | 四半期に手動調査 |

> **モデル定義は §3（統合版 v4）が唯一の正。** 以下で言及するモデルの定義は §3 を参照する（ここには再掲しない — 二重定義による実装事故を防ぐため）。

**月数百円で、「この10KWは競合が独占していて自社が圏外」が自動で分かる。** 今は分からない。

### 14.7 自動化の欠損 — 初動速度

**リードは初動速度でCVRが決まる。** 現状は問い合わせが来ても週次バッチまで気づかない可能性がある（そもそも0件なので顕在化していないだけ）。

**受信した瞬間に自動で走らせること**
1. `Lead` 起票（source を `?from=&article=` から自動判定）
2. 石井さんへプッシュ通知（最優先・Appleリマインダー）
3. 自動返信メール送信（受付確認）
4. **その人が読んだ記事から興味商材を推定**（`VisitorSession` の閲覧履歴）
5. **返信ドラフトを生成**（推定興味＋読んだ記事に基づく）→ 段5で承認して送信
6. `firstResponseAt` を記録し、SLA（例: 1時間以内）を段1で監視

**これは人を雇う代わりの装置そのもの。** 従業員がいれば「問い合わせ来たらすぐ返す」をやる。それをシステムに寄せる。

### 14.8 監査結果まとめ

| 必要な情報／自動化 | 直客 | 代理店 | LINE | 現設計 | 追加 |
|---|:-:|:-:|:-:|---|---|
| 訪問者の buyer fit（誰向けか） | ★★★ | ★ | ★★ | ❌ | `audience` / `buyerFit` |
| ファネル7段の計測 | ★★★ | — | ★★★ | ❌ | `FunnelEvent` / `VisitorSession` |
| リードの属性・興味・経路 | ★★★ | ★★ | ★★ | ❌ | `Lead` |
| 代理店DMの状態遷移 | — | ★★★ | — | ❌ | `AgencyLead` / `Partner` |
| LINE友だち・配信・反応 | ★ | — | ★★★ | ❌ | `LineFriend` / `LineMessage` |
| 競合KWギャップ | ★★ | ★ | — | ✅（§3.3.5） | `SerpSnapshot` / `Competitor` / `CompetitorMetric` |
| 初動自動対応 | ★★★ | ★★ | ★★ | ❌ | operator 拡張 |
| 記事・KW・ネタ管理 | ★★ | ★★ | ★ | ✅（§13） | — |
| 露出・順位・AIO | ★★ | ★ | ★ | ✅ | — |
| 施策管理・撤退条件 | ★★ | ★★ | ★★ | ✅ | — |

**7項目が欠損。うち5つが直客獲得（★★★）に直撃する。**

### 14.9 これが埋まると私が言えるようになること

**現在の私**
> 「クリックは142件、前週比-7.8%です。問い合わせは0件です。LPのCTAを改善しましょうか」（＝当て推量）

**追加後の私**
> 「今週の法人向けクリックは38件（全体142の27%）。買い手PVあたりの問い合わせ率は0%。
> ファネルを見ると、ART-088 は CTA表示45→クリック3（6.7%）とCTA自体は機能しているが、**LP到達3→フォーム到達0で全滅**。LPの上半分で離脱しています。
> 一方 ART-061 は表示455・順位10.3位ですが**audience=個人事業主**で、買い手を連れてくる記事ではありません。ここへのリライト投入は止めるべきです。
> 競合スナップショットでは「経営強化税制 併用」で上位10のうち自社は圏外、freee/MFも不在。**空白地帯です**。
> 代理店側は週18本から有効DM 1件（歩留まり0.9%）。投稿フォーマット別ではGood/Bad型が3件中2件を占めています。
> 推奨: ①LPの上半分をART-088の読者文脈に合わせる ②個人事業主向けリライトを停止し法人テーマに再配分 ③「経営強化税制 併用」で新規1本」

**この差が「戦略を立てられるか否か」。**

### 14.10 ロードマップへの追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。

---

## 15. AIが直接読むための設計（MCPサーバー化）

> このシステムの**第一の読者は石井さんの目、第二の読者は私（AI）**。後者を後付けにすると使い物にならない。

### 15.1 MMS MCP サーバー

Cowork/Claude Code のセッションから、私が直接クエリできるようにする。

| ツール | 用途 |
|---|---|
| `mms_acquisition_brief(period)` | **獲得3ゴールの一括取得**（§15.2）。戦略セッションの起点 |
| `mms_funnel(contentId? \| lpId?, from, to)` | 記事別・LP別のファネル7段 |
| `mms_leads(type?, status?, from, to)` | リード一覧（属性・興味・経路） |
| `mms_keywords(filter)` | KW・順位・カニバリ・鮮度 |
| `mms_query(entity, filters)` | 任意モデルの読み取り |
| `mms_propose_action(...)` | 「次の一手」を段5に起票（**書き込みはここだけ**） |

書き込みは `propose_action` に限定。私が数値やコンテンツを勝手に書き換えられない設計にする。

### 15.2 `mms_acquisition_brief` の中身

```
{
  "period": "2026-07",
  "goals": {
    "direct_inquiry": { "target": 5, "actual": 0, "trend": 0 },
    "agency":         { "target": 3, "actual": 1, "trend": 0 },
    "line_friends":   { "target": 20, "actual": 0, "trend": 0 }
  },
  "coverage": {                                    // ★必ず先に読む
    "line_friends": { "measuredSince": null, "status": "not_measured" },
    "form_submit":  { "measuredSince": "2026-07-20", "status": "measuring" }
  },
  "traffic_quality": {
    "clicks_total": 142,
    "clicks_by_budget_tier": { "high": 22, "mid": 16, "low": 91, "unknown": 13 },
    "clicks_by_funnel_stage": { "comparison": 61, "product_deep": 34,
                                "awareness": 41, "decision": 6 },
    "buyer_fit_clicks": 38, "buyer_fit_share": 0.27,
    "inquiry_per_buyer_pv": 0.0016
  },
  "funnel": { "cta_view": 620, "cta_click": 41, "lp_view": 38,
              "form_view": 4, "submit": 0,
              "biggest_drop": "form_view→submit" },
  "top_content_by_buyerfit": [ { "id":"ART-088", "corporateClicks":22, "ctaCtr":0.067, "leads":0 } ],
  "wasted_effort": [ { "id":"ART-061", "audience":"sole_proprietor",
                       "impressions":455, "note":"買い手外。リライト投入を停止すべき" } ],
  "leads": [ { "id":"L-001", "type":"direct_inquiry", "companyType":"sole_proprietor",
               "budgetTier":"high", "interestProduct":["ML"],
               "competitorsConsidered":["IoTビーコン","外貨両替機"],
               "firstTouchContentId":null, "note":"経路未特定・遡及入力対象",
               "status":"won", "closedAmount":4800000 } ],
  "agency": { "posts":72, "dms":8, "qualified":1, "yield":0.014,
              "best_format":"good_bad" },
  "competitor_gaps": [ { "keyword":"経営強化税制 併用", "ourPosition":null,
                         "top3":["A社","B社","C社"], "note":"空白地帯" } ],
  "interventions_judged": [ { "type":"title_meta_rewrite", "contentId":"ART-061",
                              "netEffect":+0.8, "verdict":"positive",
                              "note":"対照群補正後。同型を他5記事へ横展開提案済" } ],
  "experiments": [ { "name":"PRJ-029 直問い合わせLP", "daysToExit":49, "onTrack":false } ],
  "dataQuality": { "notMeasured":["line_friends"], "stale":[], "zeroVsMissing":"OK" }
}
```

**私はこのbriefを読むとき、必ず `coverage` と `dataQuality` を先に見る。** 「未計測」を「0」と読んで結論を出さないための規約。

### 15.3 定例の自動化

| 周期 | 私がやること |
|---|---|
| 週次（月） | `acquisition_brief` → 週次レビュー生成 → 段4「今週の変化」・段5「次の一手」に反映 |
| 月次（1日） | 月次総括＋施策の生死判定＋記事戦略の再配分提案（buyer fit ベース） |
| 随時 | リード発生時に即時分析（どの記事・どのKW・どんな客か）→ 次の記事テーマに反映 |

## 16. 着手前に決めるべき設計課題（v5 積み残し）★全て未決

> 2026-07-20 自己監査で発見した積み残し。**「後からやろうとすると抜ける」ため、着手前に全て埋める。**
> §16.1〜16.3 は **P0着手前に方針決定が必要**。それ以外は該当Phaseの中で処理する。

### 16.1 ★計測の正しさをどう担保するか（最も致命的）

**問題**: ファネル7段の計測タグが**間違って実装されても誰も気づかない**。計測が誤れば、その上の分析・判定・戦略・広告投資が**全部無意味**になる。現設計には計測を検証する仕組みが一切なかった。

| 対策 | 内容 |
|---|---|
| **① 合成モニタリング（最重要）** | 日次で Playwright が自社サイトを実際に巡回（記事 → CTA → LP → フォーム表示）し、**期待する `FunnelEvent` がDBに記録されたか検証**。不一致で段7を赤にする |
| **② 二重計測の突合** | GSCクリック vs 自前セッション数、GA4 PV vs 自前PV の**乖離率を日次監視**。±15%超で警告。どちらが正しいかは判断せず「ズレている」ことを検知する |
| **③ ボット除外** | UA・IP・行動パターン（滞在0秒・step順序が不正）でフィルタ。**除外率そのものも監視**（急増＝実装異常のサイン） |
| **④ 冪等キーで重複排除** | `(sessionId, step, contentItemId, occurredAt秒)` でユニーク制約。二重計測を物理的に防ぐ |
| **⑤ 外れ値検知** | 前日比・4週平均比で10倍／1/10 等を検出。**欠測検知（§3.2）とは別軸**。「ゼロになった」だけでなく「異常に増えた」も拾う |
| **⑥ 集計ロジックの単体テスト** | ゴールデンデータ（既知の入力→既知の出力）で集計関数をテスト。CIをローカルで実行 |

```prisma
model MonitorRun {        // 合成モニタリングの結果
  id, runAt, scenario, expected Json, actual Json, passed Boolean, diff Json
}
model DataQualityCheck {  // 突合・外れ値・ボット率
  id, checkedAt, kind, metric, ourValue, refValue, deviationPct, verdict, note
}
```

> **①だけは必ず入れる。** 他を削っても、合成モニタリングが無いと「計測が生きているか」を誰も保証できない。

### 16.2 ★個人情報・Cookie・同意（法務リスク）

**取得するもの**: 氏名・会社名・メール・電話（フォーム）／行動履歴（1st-party Cookie）／LINE ユーザーID／Threads DM

| 論点 | 対応方針（要弁護士確認） |
|---|---|
| ~~第三者提供の同意~~ | **不要**（2026-07-20 石井確定）。**問い合わせはML事業部として当社で対応しており、第三者提供に該当しない**。同意チェックボックスは実装しない。<br>※ 将来、代理店へリードを配分する運用に変えるなら、その時点で再検討する（`ConsentRecord` モデルは将来用に残す） |
| プライバシーポリシー | 取得情報・利用目的・第三者提供先・保存期間・開示請求窓口を明記。**現行ポリシーの改定が必要** |
| Cookie／外部送信規律 | 電気通信事業法の外部送信規律（2023施行）により、**GA4等で外部送信する場合は通知・公表が必要**。自前1st-partyのみでも、ポリシーへの記載を行う |
| 保存期間と自動削除 | `VisitorSession` は13ヶ月、`FunnelEvent` は25ヶ月、`Lead` の個人情報は取引終了後n年 — **期限到来で自動削除するジョブを持つ** |
| 保護措置 | `Lead` の個人情報カラムは**列単位で暗号化**。アクセスは `AuditLog` に記録 |
| **AIへの受け渡し** | 返信ドラフト生成で氏名・連絡先をLLMに渡すか。**方針を明示的に決める**（推奨: 氏名・連絡先はマスキングし、興味商材と閲覧履歴のみ渡す） |

```prisma
model ConsentRecord {     // 同意の取得記録（いつ・どのバージョンの文言に）
  id, leadId?, visitorId?, consentType, policyVersion, agreedAt, ipHash
}
model DataRetentionPolicy { id, entity, retentionDays, lastPurgedAt }
model AuditLog {          // 誰が/AIが いつ 何を変えたか・個人情報に誰がアクセスしたか
  id, actorType, actorId, action, entity, entityId, before Json, after Json, at
}
```

> ⚠️ **私は弁護士ではない。** 上記は論点整理であり、**第三者提供の同意文言とプライバシーポリシー改定は専門家の確認を推奨**する。

### 16.3 ★コンテンツのバージョン管理とロールバック

**問題**: §5.3 で「効果が negative ならロールバック提案」と書いたが、**戻す先のバージョンが存在しない**。

- WordPress のリビジョンには本文は残るが、**`config.yaml`・タイトル・メタディスクリプション・タグ・Rank Math 設定・CTA構成は残らない**
- `Intervention` に `beforeVersionId` / `afterVersionId` を持たせ、**ワンクリックで復元**できるようにする

```prisma
model ContentVersion {
  id, contentItemId, versionNo, capturedAt
  title, metaDescription, bodyHtml, configYaml Json
  tags Int[], rankMath Json, ctaLayout Json
  capturedBy      // pre_intervention | post_intervention | manual
}
```

### 16.4 障害復旧（Mac が単一障害点）

**問題**: Docker + launchd で全てが石井さんのMac上に載る。**Macが壊れたら全消失**。

| 項目 | 定義 |
|---|---|
| **RPO**（許容データ損失） | **24時間**（日次バックアップ） |
| **RTO**（復旧目標時間） | **4時間** |
| バックアップ3箇所 | ① ローカル `backups/` 30世代 ② Time Machine / 外付けSSD ③ **Google Drive（暗号化・週次）** |
| **復旧手順書** | リポジトリに `RECOVERY.md` を置く（`docker compose up` → `pg_restore` → `.env` 再設定 → 動作確認 の手順） |
| **リストア訓練** | **四半期に1回、実際に別環境で復元して起動確認**。手順書だけでは復旧できない |
| 可視化 | 段7に「最終バックアップ日時」「**最終リストア検証日**」を表示 |
| VPS移行の判断基準 | Macの稼働率が下がる／外出が増える／パートナーが見る必要が出た時点で移行を検討 |

### 16.5 対照群が作れない場合の判定

**問題**: 記事157本しかないため、層別（同カテゴリ×同funnelStage）すると**対照群が数本しか取れない**打ち手がある。統計的に判定できない。

| 対策 | 内容 |
|---|---|
| **最小サンプル基準** | 対照群 **5記事以上かつ合計impressions 500以上**。満たさなければ `verdict=inconclusive`（**「効果なし」とは別物**としてUIに明示） |
| **バッチ判定（最有効）** | 同型の打ち手を**複数記事にまとめて適用し、バッチ単位で判定**。サンプル数を稼ぐ。`Intervention.batchId` |
| 代替補正 | 対照群が作れない場合はサイト全体トレンドで補正し、`confidence=low` を付与 |
| 判定期間の逐次延長 | 14日 → 28日 → 56日。それでも不足なら inconclusive で確定 |

→ `Intervention` に `controlGroupSize` / `confidence` / `batchId` を追加（§3反映済み前提で実装）。

### 16.6 その他の未決事項（着手前に決める）

| # | 論点 | 決めるべきこと | 推奨 |
|---|---|---|---|
| 1 | **タイムゾーン** | GSCはPT基準、GA4はプロパティ設定、自前はJST。**日付境界がズレて集計が合わなくなる典型** | **全てJSTに正規化して保存**。GSCの日付はPT→JST変換ルールを明文化 |
| 2 | アトリビューション定義 | first touch / last touch のどちらを主にするか、Cookie有効期間、クロスデバイス | **両方保持し主指標はlast touch**。Cookie 90日。**クロスデバイスは追わない（割り切る）** |
| 3 | 承認待ちの滞留 | 石井さんが押さないAction が溜まったら | `Action.expiresAt`（14日）→ 自動 expired。段1に「未処理n件」を表示 |
| 4 | operator のAI利用量 | 週次立案・記事レビューのトークン消費が読めない | `JobRun.metrics` にトークン数を記録し月次可視化。**上限アラート**を設定 |
| 5 | WP側改修のリスク | 計測タグをテーマに直書きすると**テーマ更新で消える** | **子テーマ or 専用プラグイン化**。`functions.php` 直書き禁止 |
| 6 | AIO計測のToS | 自前スクレイピングは OpenAI ToS 上グレー（自動UIアクセス） | 頻度を抑え Hot tier のみ。**Otterly（$29/月・MCP対応）への置換パスを常に持つ** |
| 7 | 金額の扱い | 240万は税抜 | **全て税抜で保持**し、表示時に「税抜」と注記 |
| 8 | WordPress と MMS の役割 | 記事本文の正はどちらか | **本文の正はWP**、MMSはメタ・計測・バージョン。二重管理しない |

### 16.7 ロードマップへの追加

> **§9（実装ロードマップ 統合版）に統合済み。** Phase・見積・依存関係は §9 を参照する。
> 本節が追加した Phase: P0.5 / P0.7 / P1.7 / P2.4 / P4.4 / P4.8

---

## 17. リスクと対策

| リスク | 対策 |
|---|---|
| スコープが膨らんで完成しない | P0〜P4（コア7.5日）で一度止め、実際に使ってから P5以降を判断する |
| 既存Python資産の書き直しに引きずられる | **書き直さない**を原則として明文化（§6）。workerから呼ぶだけ |
| Mac再起動でサービスが落ちる | Docker restart policy + launchd。段7に最終実行時刻が出るので気づける |
| Threads APIトークン期限切れ（60日） | 自動リフレッシュ＋残日数を段7に常時表示（9日前から黄） |
| Postgres 運用の手間 | Docker Compose で完結。日次 pg_dump 30世代＋週次Drive退避 |
| operator の提案が的外れ | 却下理由を立案プロンプトに注入。却下率の高い提案タイプは自動停止（§5.3） |
| 「作ること」に時間を吸われる | Claude Code が実装するため石井さんの稼働は**承認とレビューのみ**。ただし P0〜P4 で一度成果を見る運用にする |

---

## 18. 改訂理由（v1 → v5）

- **v1（静的HTML）**: PRJ-033 の設計を踏襲したが、**段4に承認ボタンを置きながら押しても何も起きない**という矛盾を抱えていた。問い合わせ発生も週次バッチまで反映されず、「動いている実感」が構造的に出ない案だった
- **v2（FastAPI + SPA）**: 書き込みとWebhookは解決したが、**単一事業のダッシュボード**の域を出ず、「全社の基本になる」という要件を満たしていなかった
- **v3（本設計）**: 最初から `Business` を軸に置き、汎用メトリクスモデルと施策・意思決定のDB化まで含めた。**Markdownで運用している経営戦略室の資産（施策仮説シート・学びログ・意思決定ログ）をシステムに載せる**ことで、経営戦略室そのものの基盤になる

---

## 19. 石井さんの判断が要る点

### 19.0 ★P0着手前に決めるべきこと（§16）

- [x] **第三者提供の同意** → **不要**（2026-07-20 石井確定・ML事業部として自社対応のため第三者提供に該当しない）
- [x] **AIに個人情報を渡すか** → **渡さない**（氏名・連絡先はマスキングし、興味商材と閲覧履歴のみ）（2026-07-20 石井確定）
- [x] 計測検証（P2.4）を M-A に含める（2026-07-20 石井確定）
- [x] システム名・リポジトリ場所（2026-07-20 石井確定・本文冒頭）
- [ ] **残1件**: プライバシーポリシーの改定を専門家に確認するか（自社利用のみでも利用目的の明示は必要）
- [ ] **残1件**: m2 側に「リード元＝メディア」を記録する項目があるか（無ければm2に1項目追加。P6.10 までに確認）

### 19.1 その他

- [ ] この構成（Next.js 15 + Prisma + PostgreSQL + shadcn/ui + Python worker + Docker）で進めてよいか
- [ ] システム名（メディア管理システム(MMS)）を確定してよいか
- [ ] **スコープ**: 最初から全社（5事業）を載せるか、メディア＋SNSで作ってから他事業を接続するか（推奨は後者＝P0〜P4を節税商材代理店で作り、P10で横展開）
- [ ] 経営戦略室の Markdown 資産（施策仮説シート・学びログ・意思決定ログ）をDBへ移すか、Markdownを正のまま残すか
- [x] リポジトリの置き場所 → `~/システム開発/Next/media-management-system/`（2026-07-20 石井決定）／Git管理あり
