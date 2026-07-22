# MMS 用語集（GLOSSARY）

> 抽出元: `docs/DESIGN.md`（§3 / §5.2 / §7.5.1 / §14 ほか）
> **★このファイルの enum 値は `prisma/schema.prisma` と完全一致していなければならない。**
> `docs/check-consistency.sh` が機械照合する。**片方だけ変更してはいけない**（`docs/RULES.md` §19-1）。
>
> **記法**: `<!-- enum: 名前 -->` の直後の表が機械照合の対象。**1行目の列は値のみ**（バッククォート囲み）。

---

## 0. 中心概念

| 用語 | 定義 |
|---|---|
| **MMS** | メディア管理システム。メディア／SNS運用の**獲得基盤**。DB名 `mms` / API・MCP接頭辞 `mms_*` / 環境変数接頭辞 `MMS_*` |
| **獲得3ゴール** | ① 直客の問い合わせ（**最優先**） ② 代理店開拓 ③ 公式LINE登録。**3つは訴求も導線も計測も違うため、別物として設計する**（§14.0） |
| **買い手（buyer）** | 240万円の ML を買える層。**法人／個人事業主の別ではなく「投下可能な節税予算（利益規模）」で判別する**（§14.1 の軸の訂正） |
| **buyer fit** | 記事・クリック・PV が買い手に適合しているか。`budgetTier` × `funnelStage` で判定する |
| **未計測** | `MeasurementCoverage` に行が無い状態。**「実測ゼロ（value=0）」とは別物**。UIは `—(未計測)` と表示する（`docs/RULES.md` §2） |
| **段1〜段7** | ダッシュボードのパネル番号。定義は `docs/RULES.md` §4 が正 |
| **ピラー / クラスター** | ピラー=そのトピックのハブ記事、クラスター=そこにぶら下がる個別記事。**本質は「数」ではなく「リンク構造」**（§3.5.2） |
| **対照群補正** | `netEffect = 適用後 − 適用前 − 対照群の同期間トレンド`。**無いと季節変動を施策効果と誤判定する**（§5.3） |
| **上限CPA** | `1成約あたり粗利 × 問い合わせ→成約率`。これを超える獲得単価なら赤字（§3.4.2） |
| **直客プレミアム** | 直客の粗利（48万/台）− 代理店経由の粗利（30万/台）＝ **18万円/台**（§3.4.2） |
| **striking distance** | 順位 11〜20位。**あと少しで1ページ目**の圏。日次抽出して段5に自動起票する（§13.3） |
| **空白地帯** | 自社が圏外（`SerpSnapshot.isOurs=false`）かつ競合も弱いKW。新設クラスタの候補（§3.3.7） |
| **cosmetic 更新** | 実質的な追記を伴わない見た目だけの更新。**`dataUpdatedAt` を触ってはいけない**（§7.5.1） |
| **underpowered** | A/Bテストの必要サンプル数に到達する見込みが3ヶ月を超える状態。**起動を拒否する**（§3.7.2） |
| **inconclusive** | 対照群のサンプル不足で判定できない状態。**「効果なし（neutral）」とは別物**（§16.5） |

---

## 1. 買い手軸

### 1.1 `budgetTier` — 投下可能な節税予算

> 使用: `ContentItem` / `Lead` / `Keyword` / `Idea` / `TopicCluster` / `LandingPage`
> ★**法人格の有無ではなく利益規模が判別軸**。小規模共済（月7万上限）・iDeCo（月6.8万上限）を調べる層は240万商材を買わない（§14.1）

<!-- enum: BudgetTier -->
| 値 | 意味 |
|---|---|
| `high` | 1,000万円〜 |
| `mid` | 300〜1,000万円 |
| `low` | 〜300万円（★ここに投資しても買い手は増えない） |
| `unknown` | 未判定 |

### 1.2 `funnelStage` — 商材の比較検討段階

> 使用: `ContentItem` / `Keyword` / `Idea` / `TopicCluster`
> ★**実際の買い手は「ビーコン / 外貨両替機 / ML」を横断比較していた。比較段階の読者が最も買い手に近い**（§14.1）

<!-- enum: FunnelStage -->
| 値 | 意味 |
|---|---|
| `awareness` | 認知（課題に気づいた段階） |
| `comparison` | **比較検討（★最も買い手に近い）** |
| `product_deep` | 商材の深掘り |
| `decision` | 意思決定直前 |

### 1.3 `productFit` — 商材適合（String[]・enum ではない）

> 使用: `ContentItem` / `Keyword` / `KeywordCluster` / `UnitEconomics` / `TopicCluster` / `LandingPage`
> **設計書の列挙は `…` で打ち切られているため enum 化していない**（`docs/PHASES.md` §8 U15）。以下は設計書に現れる語彙。

- `ML`（マイグレーションライト・**主力商材**）
- `IoTビーコン`
- `外貨両替機`
- `EV充電`
- `GPU`
- `経営強化税制`
- `少額減価償却`
- `オペリース`

### 1.4 `audience` — 読者属性（String[]・enum ではない）

> 使用: `ContentItem`
> 設計書 §3 に「**参考:**」と付記されており確定値ではないため enum 化していない。

- `corporate`（法人）
- `sole_proprietor`（個人事業主）※★初の直客はここだった。**この軸だけで買い手を判定してはいけない**
- `tax_accountant`（税理士）
- `agency_candidate`（代理店候補）

---

## 2. コンテンツ

### 2.1 `ArticleType` — 記事種別

<!-- enum: ArticleType -->
| 値 | 意味 |
|---|---|
| `pillar` | ピラー記事（トピックのハブ） |
| `cluster` | クラスター記事 |
| `news` | 速報・ニュース |
| `lp` | ランディングページ |
| `reel` | リール動画 |
| `post` | SNS投稿 |

### 2.2 `freshnessTier` — 鮮度3階層ケイデンス（§7.5.1）

> `nextReviewDue = lastReviewedAt + FreshnessRule.intervalDays`

<!-- enum: FreshnessTier -->
| 値 | 対象 | 間隔 |
|---|---|---|
| `breaking` | 速報・税制改正 | **随時**（法改正イベント駆動・intervalDays=0） |
| `commercial` | 商用・税制系（即時償却・経営強化税制・商材比較） | **60〜90日（既定75日）** |
| `evergreen` | エバーグリーン・Pillar（節税の基本ガイド） | **6ヶ月（180日）** |
| `reference` | 定義・リファレンス（用語解説） | **12ヶ月（365日）** |

### 2.3 `reviewState` — レビュー状態

<!-- enum: ReviewState -->
| 値 | 条件 | 表示 |
|---|---|---|
| `fresh` | `nextReviewDue` まで30日超 | — |
| `due_soon` | `nextReviewDue` の**30日前**を過ぎた | 段1に**黄色** |
| `overdue` | `nextReviewDue` を経過 | 段1に**赤** ＋ 段5に Action 自動起票 |
| `in_rewrite` | リライト作業中 | — |

### 2.4 `AioTier` — AI Overview 計測の優先度

<!-- enum: AioTier -->
| 値 | 意味 |
|---|---|
| `hot` | 最優先で計測（ToS配慮のため**自前スクレイピングは Hot tier のみ**・§16.6-6） |
| `warm` | 中優先 |
| `cold` | 低優先 |
| `none` | 計測対象外 |

### 2.5 `CtaPosition` — 記事内CTAの位置

<!-- enum: CtaPosition -->
| 値 | 意味 |
|---|---|
| `hero` | ヒーロー（記事冒頭） |
| `mid` | 中盤 |
| `final` | 最終（記事末尾） |
| `sidebar` | サイドバー |
| `header` | ヘッダー |
| `footer` | フッター |
| `fixed` | 追従（スクロールしても画面に残る） |

### 2.6 `ArticleReviewKind` / `ArticleReviewOutcome` / `ReviewerType`

<!-- enum: ArticleReviewKind -->
| 値 | トリガー |
|---|---|
| `periodic` | `nextReviewDue` 到来 |
| `triggered_by_rank` | 順位下落（4週で3位以上低下） |
| `triggered_by_law` | 税制改正・法令変更（**該当する全記事を一括で対象化**） |
| `triggered_by_gsc` | GSC 由来の異常（表示はあるがクリック0 等） |

<!-- enum: ArticleReviewOutcome -->
| 値 | 意味 | `dataUpdatedAt` |
|---|---|---|
| `no_change` | 変更なし | **★更新しない**（cosmetic回避） |
| `minor_fix` | 軽微な修正 | 実質追記なら更新 |
| `substantive_rewrite` | 実質的な追記・書き直し | **更新する** ＋ `Intervention` に接続 |
| `archived` | アーカイブ | — |

<!-- enum: ReviewerType -->
| 値 | 意味 |
|---|---|
| `ai` | AIによる自動レビュー |
| `ishii` | 石井さんによるレビュー |

### 2.7 `CoverageState` — インデックス状況（GSC URL Inspection API）

> ★**インデックスされていない記事はクリック0が確定する。順位もCTRも意味がない**（§3.6.1）

<!-- enum: CoverageState -->
| 値 | 意味 |
|---|---|
| `indexed` | インデックス済み |
| `crawled_not_indexed` | クロール済み・**未インデックス** |
| `discovered_not_indexed` | 発見済み・**未クロール／未インデックス** |
| `excluded` | 除外（noindex・canonical 等） |
| `error` | 取得エラー |

### 2.8 `LifecycleAction` — 記事の終息管理（プルーニング）

> ★**記事は増やすだけでは結果が出ない。畳む判断をシステムに持たせる**（§3.6.7）

<!-- enum: LifecycleAction -->
| 値 | 自動起票の条件（§3.6.7） |
|---|---|
| `keep` | buyer-fit低 × リード0 × 制作コスト回収不能 → 放置するがリライト投資はしない |
| `improve` | 改善対象 |
| `merge` | 同一クラスタ内でKW重複 × 順位が低い方 → 統合してリダイレクト |
| `noindex` | 公開180日超 × クリック0 × 表示100未満 |
| `redirect` | URL変更（**`UrlRedirect` を必ず作る＝404を出さない**） |
| `delete` | 削除（同上） |

### 2.9 `VersionCapturedBy` — バージョン取得の契機

<!-- enum: VersionCapturedBy -->
| 値 | 意味 |
|---|---|
| `pre_intervention` | 施策適用の直前（**ロールバック先**） |
| `post_intervention` | 施策適用の直後 |
| `manual` | 手動取得 |

### 2.10 `ProductionCostKind` — 制作コストの種別

<!-- enum: ProductionCostKind -->
| 値 | 意味 |
|---|---|
| `new` | 新規制作 |
| `rewrite` | リライト |
| `image` | 画像生成 |
| `video` | 動画制作 |

### 2.11 `DeviceType` / `PageExperienceSource` — ページ体験

<!-- enum: DeviceType -->
| 値 | 意味 |
|---|---|
| `mobile` | モバイル（★経営者層はモバイル閲覧が多い可能性・CVRが低いなら最優先の改善点） |
| `desktop` | デスクトップ |

<!-- enum: PageExperienceSource -->
| 値 | 意味 |
|---|---|
| `crux` | CrUX（**実ユーザー実測**） |
| `psi` | PageSpeed Insights（**ラボ値**） |

---

## 3. ファネル7段

### 3.1 `FunnelStep` — 計測点

> 由来: §3 `FunnelEvent.step`（7値）＋ §3.8.3 の `phone_click`（8値目）
> ★**GA4に頼らず自前で持つ**。GA4は集計が粗く、記事単位×CTA位置単位のアトリビューションに弱い（§14.2）

<!-- enum: FunnelStep -->
| 値 | 段 | 分かること |
|---|---|---|
| `cta_view` | 1 | 記事内CTAまでスクロールされたか |
| `cta_click` | 2 | **どの記事のどの位置のCTAが効くか** |
| `lp_view` | 3 | 記事→LPの離脱率 |
| `lp_scroll` | 4 | LPのどこで離脱するか（深度は **25/50/75/100% の4段のみ**・`docs/RULES.md` §1-②） |
| `form_view` | 5 | CTAは押されたが入力に至らない層 |
| `form_field` | 6 | どの項目が重いか |
| `submit` | 7 | 問い合わせ |
| `phone_click` | ※ | **`tel:` リンクのクリック**（§3.8.3・架電したかは不明）。★§4.1 の「ファネル7段」の外（`docs/PHASES.md` §8 U25） |

### 3.2 `TrafficSource` / `AiEngine` — 流入元（§3.6.6）

> ★AIO引用率（**先行指標**）と AI流入（**結果指標**）を並べて見ることで、GEO施策の実効性が初めて評価できる

<!-- enum: TrafficSource -->
| 値 | 意味 |
|---|---|
| `organic` | 自然検索 |
| `ai_search` | **AI検索（referrer で判別）** |
| `social` | SNS |
| `direct` | 直接 |
| `referral` | 参照 |
| `paid` | 有料広告 |

<!-- enum: AiEngine -->
| 値 | referrer 例 |
|---|---|
| `chatgpt` | `chat.openai.com` |
| `perplexity` | `perplexity.ai` |
| `copilot` | Microsoft Copilot |
| `gemini` | Google Gemini |

---

## 4. リード・獲得

### 4.1 `LeadType` — 獲得3ゴール

<!-- enum: LeadType -->
| 値 | ゴール | 欲しい相手 | 導線 |
|---|---|---|---|
| `direct_inquiry` | ① 直客の問い合わせ（**最優先**） | 利益の出ている法人・事業主 | 記事 → LP → フォーム |
| `agency` | ② 代理店開拓 | 節税商材を売れる人・会社 | Threads代理店募集 → DM → 自己選別 → 百瀬へ |
| `line_friend` | ③ 公式LINE登録 | ①②の手前の温め層 | **未実装**（登録理由＝軽オファーが存在しない） |

> ⚠️ §11.1 が `note_purchase` に言及するが §3 の定義に無いため未採用（`docs/PHASES.md` §8 U26）。

### 4.2 `LeadStatus` — 商談ステータス

> ★**商談以降は m2（ML営業管理システム）が正**。MMS はリードまで（§3.8.4）

<!-- enum: LeadStatus -->
| 値 | 意味 |
|---|---|
| `new` | 新規受信 |
| `contacted` | 初動接触済み（`firstResponseAt` を記録・SLA 1時間） |
| `qualified` | 見込みあり |
| `proposal` | 提案中 |
| `won` | 成約 |
| `lost` | 失注 |

### 4.3 `LeadSourceType` — 受け皿（問い合わせがどこに着地したか）

> ★2026-07-22 に石井さんと構造を整理した（`docs/PHASES.md` §8 U60）。
> **送客**（HP／メディア／記事／Threads）と **受け皿**（この enum）は層が違う。
> 以前は「直客／代理店／LINE」（＝`LeadType`＝ゴールの種類）しか画面に出しておらず、
> 経路が見えていなかった。

<!-- enum: LeadSourceType -->
| 値 | 意味 | provenance |
|---|---|---|
| `form` | **HPの問い合わせ**フォーム送信（Webhook）。★送信は info@ に届く。「info メール」は同じものを指す（2026-07-23 石井さん訂正） | `measured` |
| `lp_form` | **@deprecated**。診断LPと代理店LPを区別できないため下2つに分割 | `measured` |
| `lp_diagnosis` | **診断LP**（`setsuzei-diagnosis-*`・CF7 601652） | `measured` |
| `lp_agency` | **商品LP（代理店経由）**（`bousai-bouhan-light.com`・`?ag=AG-XXXX`）。★代理店を募集するLPではなく、既存代理店が顧客に配る**商品LP**。`?ag=` はどの代理店が送客したかの印（2026-07-23 訂正） | `measured` |
| `email` | **@deprecated（2026-07-23 訂正）**。info メールは HPの問い合わせフォームの届き先であって別経路ではない。受け皿は `form` に一本化した。既存行が残る場合に備えて値は残す | **`declared`** |
| `phone_manual` | **電話受電時の手動登録**（§3.8.3・入力は3項目のみ） | **`declared`** |
| `line` | 公式LINE（Messaging API Webhook） | `measured` |
| `threads_dm` | Threads DM（cowork の `dm-log.md` から取り込み） | `measured` |

> ★電話受電時は**「何を見てお電話いただきましたか」を必ず聞く**（これが唯一の経路情報）。
> コールトラッキング（月数千円）は**件数が月10件を超えたら再検討**。

### 4.3.1 `LeadOrigin` — 送客元（何がきっかけで問い合わせに至ったか）

> ★2026-07-23 追加（石井さん）。**受け皿（`LeadSourceType`）と直交する軸**。
> 施策（メディア・Threads・LP・LINE）はすべて「見込み客募集」か「代理店募集」の
> ために動いており、各施策のゴールは問い合わせ増加。だから
> **どの施策がきっかけで来たか**を受け皿と別に持つ。
>
> ★電話・info メールは自動取得できないが**測定不能ではない**。
> いきなり連絡してくる人はほとんどおらず、何かの施策に触れている。
> ヒアリングして記録すれば施策の成果として数えられる。
> 「自動で取れない」と「測れない」を混同しない（§2 欠測とゼロの区別）。

<!-- enum: LeadOrigin -->
| 値 | 意味 | provenance |
|---|---|---|
| `media_article` | メディア記事（記事が特定できれば `firstTouchContentId` も埋める） | `measured` / `declared` |
| `threads` | Threads（投稿・DM） | `measured` / `declared` |
| `line` | 公式LINE | `measured` / `declared` |
| `lp_diagnosis` | 診断LP | `measured` |
| `lp_product` | 商品LP（防災防犯ライト・代理店経由） | `measured` |
| `hp` | HP（記事以外のページ） | `declared` |
| `referral` | 紹介・既存顧客・名刺交換など施策外の接点 | `declared` |
| `unknown` | 聞けていない。★「施策に触れていない」ではない | — |

> ★`unknown` の割合は**ヒアリングの実行率**。ここが高いままだと施策を評価できない。
> `/leads` の「きっかけ別」に割合を出している。

### 4.4 `TouchpointRole` — アシスト貢献（§3.6.2）

> ★first/last だけだと**間の記事が評価ゼロになり、"効いていない記事" として畳まれる危険がある**

<!-- enum: TouchpointRole -->
| 値 | 意味 |
|---|---|
| `first` | 初回接触記事 |
| `assist` | **アシスト（間の記事）** |
| `last` | 最終接触記事（**主指標**・§16.6-2） |

### 4.5 `AgencyLeadStage` — 代理店DMの状態遷移

<!-- enum: AgencyLeadStage -->
| 値 | 意味 |
|---|---|
| `received` | DM受信 |
| `screening_sent` | 自己選別質問を送信 |
| `answered` | 回答あり |
| `qualified` | 有効DM |
| `forwarded` | 百瀬へ転送 |
| `contracted` | 契約成立 |
| `rejected` | 見送り |

---

## 5. 打ち手（Action）

### 5.1 `ActionType` — 打ち手タイプ・効く指標・判定期間（§5.2）

> ★設計書は「打ち手8タイプ」と記すが表の行は9値（`cta_move` / `cta_variant` が同一行）。**9値を採用**（`docs/PHASES.md` §8 U24）
> ★2026-07-22 に `rewrite` / `merge` を追加して11値（§8 U61）。人が主導した施策
> （改正対応リライト・記事統合＋301）が既存の9値では表せず、`/experiments` の
> 手動記録が作れなかったため。timeseries.db の実績9件の大半が `rewrite` だった。
> **判定期間 = `Intervention.evaluateAt` − `appliedAt`**

<!-- enum: ActionType -->
| 値 | 効く指標 | 判定期間 | 自動実行の範囲 |
|---|---|---|---|
| `rewrite` | clicks / position | **28日** | 提案のみ |
| `merge` | clicks / position | **56日** | 提案のみ |
| `title_meta_rewrite` | CTR / clicks | **28日** | draft生成 |
| `cta_move` | cta_click率 | **14日** | 実装まで |
| `cta_variant` | cta_click率 | **14日** | 実装まで |
| `lp_section_edit` | form_view率 | **14日** | draft生成 |
| `internal_link` | 回遊 / lp_view | **28日** | 実装まで |
| `new_article` | impressions / clicks | **56日** | draft生成 |
| `kw_pivot` | position | **56日** | 提案のみ |
| `threads_format_shift` | views / DM数 | **14日** | 配分変更まで |
| `stop_low_fit` | 投入時間の再配分 | **—** | 提案のみ |

### 5.2 `ActionState` — 承認フロー

> `Action.expiresAt` は **14日**。超えたら自動 `expired`（§16.6-3）

<!-- enum: ActionState -->
| 値 | 意味 |
|---|---|
| `proposed` | operator が起票 |
| `prepared` | 先に実行して draft 化済み |
| `awaiting_approval` | 段5で承認待ち |
| `approved` | 承認（→ `Intervention` が自動生成され判定日が予約される） |
| `rejected` | 却下（**`ActionEvent.reason` が学習データになる**・§5.6） |
| `done` | 実行完了 |
| `failed` | 実行失敗 |

### 5.3 `InterventionVerdict` — 判定結果（§5.3）

<!-- enum: InterventionVerdict -->
| 値 | 条件 | 自動アクション |
|---|---|---|
| `pending` | 判定日未到来 | — |
| `positive` | netEffect > 期待効果の下限 | `Learning` 生成 → **同型の打ち手を他記事へ横展開提案** |
| `neutral` | 有意差なし | `Learning` 生成 → 立案の重みを下げる |
| `negative` | 悪化 | `Learning` 生成 → **ロールバック提案** ＋ 同型の打ち手を一時停止 |
| `inconclusive` | **サンプル不足**（対照群5記事未満 or 合計impressions 500未満） | 判定期間を延長（14→28→56日）。★**`neutral` と区別してUI表示する** |

### 5.4 `ConfidenceLevel` — 判定の信頼度（§16.5）

> ★設計書は `confidence=low` にのみ言及。**3段階を P0-a で決定**（[docs/PHASES.md](docs/PHASES.md) §9-D3）

<!-- enum: ConfidenceLevel -->
| 値 | 条件 |
|---|---|
| `high` | **対照群5記事以上 かつ 合計impressions 500以上**（§16.5 の最小サンプル基準を満たす） |
| `medium` | **バッチ判定**（`Intervention.batchId`）で複数記事をまとめてサンプル数を稼いだ場合 |
| `low` | 対照群が作れず**サイト全体トレンドで補正**した場合 |

### 5.5 `ExperimentState` — 施策の生死（段6）

<!-- enum: ExperimentState -->
| 値 | 意味 |
|---|---|
| `running` | 実行中（段6に撤退期限までのカウントダウン） |
| `won` | 成功指標を達成 |
| `lost` | 未達 |
| `withdrawn` | 撤退条件に抵触して撤退 |

---

## 6. ネタ（Idea）

### 6.1 `IdeaSource` — 供給源

> ★`Idea` は**手で書くものではなく、システムが自動で起票する**（§13.4）
> ⚠️ §3 は7値だが §13.4 の表は「5供給源」。**7値を採用**（`docs/PHASES.md` §8 U23）

<!-- enum: IdeaSource -->
| 値 | ロジック | 起票例 |
|---|---|---|
| `gsc_gap` | ① 表示回数はあるのに対応記事が無い／順位が低いクエリを**日次抽出** | 「"経営力向上計画 却下" 表示82・記事なし → 新規記事」 |
| `rakko_paa` | ② `KeywordResearch.qaQuestions` のうち**未回答**のものを抽出 | 「"即時償却は中古でも使える？" → ART-015 のFAQに追加」 |
| `news` | ③ News monitor（税制改正・倒産・行政指導の検知） | 「令和9年度税制改正大綱 → 速報記事」 |
| `threads_hit` | ④ **平均viewsの1.5倍**を超えた投稿を記事化候補に（★統合システムでしか作れない価値） | 「"決算賞与の落とし穴" 投稿が3,200views → 記事化」 |
| `aio_miss` | ⑤ AIO計測で hit しなかったプロンプトをコンテンツギャップとして起票 | 「"中小企業 節税 おすすめ" で未引用 → 比較記事の強化」 |
| `lead_competitor` | **`Lead.competitorsConsidered`**（★比較対象＝次に書くべきKWの直接の情報源）※§13.4 の表に記載なし | 「初の直客が"ビーコン/外貨両替機"を比較 → 比較記事」 |
| `manual` | 手動起票 ※§13.4 の表に記載なし | — |

> **全 `Idea` に `impacts`（効く結果指標）が必須。** 結果に効かないネタは起票された時点で下位に沈む（§5.5）。

---

## 7. クラスタ・リンク構造

### 7.1 `ClusterState` — 構造欠陥の検知（§3.5.4）

<!-- enum: ClusterState -->
| 値 | 条件 | 対応 |
|---|---|---|
| `healthy` | 適正（ピラーあり・クラスター5〜15本・`linkHealthScore` ≥ 0.8） | — |
| `pillar_missing` | **ピラー記事が無い**（クラスターだけあって受け皿が無い） | ピラー新設 |
| `thin` | **クラスター3本未満**（受け皿が薄い） | 記事投下 |
| `cannibalized` | 同一クラスタ内で main KW が重複 | **1件でも要整理** |
| `orphan` | どのクラスタにも属さない孤児記事 | 戦略上の位置づけを与える |
| `overgrown` | **クラスター20本超** | 分割候補 |

### 7.2 `PillarType` — 3本柱（manuals/three-pillar-strategy.md）

<!-- enum: PillarType -->
| 値 | 意味 |
|---|---|
| `A_standard` | A柱: 標準・王道 |
| `B_news` | B柱: 速報・ニュース |
| `C_risk` | C柱: リスク中立（★速報性と `RegulatoryEvent` の相性が良い） |

### 7.3 `ClusterRole` / `AssignmentRole`

> ★記事は**複数クラスタに所属可（多対多）**。ただし `role=primary` を1つだけ決める。ツリー表示は primary で描き、分析は多次元で行う（§3.5.1）

<!-- enum: ClusterRole -->
| 値 | 意味 |
|---|---|
| `primary` | **1記事1つ**（ツリー表示に使う） |
| `secondary` | 副次的な所属 |

> ★`KeywordAssignment` の `@@unique([keywordId, role])` により **main 重複＝カニバリを DB 制約で検出**する（§3.1）

<!-- enum: AssignmentRole -->
| 値 | 意味 |
|---|---|
| `main` | メインKW（**1KWにつき1記事のみ**） |
| `sub` | サブKW |

### 7.4 `InternalLinkType` — 内部リンクの種別

> ★**トピッククラスタの本質は「数」ではなく「リンク構造」。** ピラーが10本あってもリンクが無ければただの記事の山（§3.5.2）

<!-- enum: InternalLinkType -->
| 値 | 意味 | 欠落時の症状 |
|---|---|---|
| `cluster_to_pillar` | クラスター → ピラー | **権威がピラーに集約されない（最も多い不備）** |
| `pillar_to_cluster` | ピラー → クラスター | ピラーがハブとして機能しない |
| `cluster_to_cluster` | クラスター同士 | **過剰だと権威が横に分散しピラーが育たない** |
| `cross_pillar` | 別クラスタのピラーへ | — |

---

## 8. 市場・競合

### 8.1 `VolumeSource` — 検索ボリュームの取得元

> ⚠️ **検索ボリュームは推定値**（Keyword Plannerの丸め・各ツールの推定）。**絶対値を信じず、相対比較と推移で使う**（§3.3.1）

<!-- enum: VolumeSource -->
| 値 | 意味 |
|---|---|
| `rakko` | ラッコキーワード（既に3ヶ月分・40KW超取得済み） |
| `dataforseo` | DataForSEO Keyword Data API |

### 8.2 `LinkTier` — 外部出典の階層（§3.9.2）

> `news-article.md` は外部出典3本以上・tier1 を1本以上必須にしている。**157記事 × 出典3本以上 = 500本超を誰も見ていない**

<!-- enum: LinkTier -->
| 値 | 意味 |
|---|---|
| `tier1` | 一次ソース（`nta.go.jp` / `mof.go.jp` / `e-gov` 等）★**404 になったら最優先で段5に起票** |
| `tier2` | 準一次ソース |
| `other` | その他 |

---

## 9. 広告・ユニットエコノミクス

### 9.1 `AdPlatform` — 媒体（§3.4.6）

<!-- enum: AdPlatform -->
| 値 | 適性 | 注意 |
|---|---|---|
| `google_ads` | ◎ 最有力（インテントKWを直接買える） | ⚠️ **金融・投資関連の広告ポリシー**に抵触する可能性。要事前確認 |
| `meta` | △〜○ 経営者ターゲティング可（顕在層ではない） | 同上＋クリエイティブ審査 |
| `yahoo` | ○ 経営者層の利用が一定ある | 同上 |
| `line` | △ LINE登録との相性は良い | — |

### 9.2 `AcquisitionChannel` — 獲得経路（★粗利が違うので必ず分ける）

<!-- enum: AcquisitionChannel -->
| 値 | 粗利 / 台 | 備考 |
|---|---|---|
| `direct` | **48万円** | ★直客1件は代理店経由1.6件分の価値 |
| `agency` | **30万円**（12.5%） | 代理店手数料 7.5% = 18万円/台を差し引いた後 |

### 9.3 `Provenance` — 数値の出所

<!-- enum: Provenance -->
| 値 | 意味 | 扱い |
|---|---|---|
| `measured` | 自社の実測値 | そのまま使える |
| `declared` | 人の申告値（電話問い合わせの手動記録など） | 実測と混ぜて集計しない |
| `estimated` | 推定値・ベンチマーク（LP CVR の業界一般値・検索ボリューム） | **相対比較と推移でのみ使う** |

### 9.4 `SimulationMode` / `SimulationScenario`（§3.4.4）

<!-- enum: SimulationMode -->
| 値 | 計算方向 |
|---|---|
| `forward` | **順算**: 予算 → ÷CPC → クリック数 → ×LP CVR → 問い合わせ数 → ×成約率 → 成約数 → ×粗利 → 利益/ROAS |
| `reverse` | **★逆算（実務ではこちらが重要）**: 「問い合わせを月5件取りたい」→ ÷成約率・CVR → 必要クリック数 → ×CPC → 必要予算 |

<!-- enum: SimulationScenario -->
| 値 | 意味 |
|---|---|
| `conservative` | 保守（★初期の判断線。成約率10〜20%・1台想定＝上限CPA 5〜10万円） |
| `base` | 基準 |
| `optimistic` | 楽観 |

---

## 10. 検証手法（A/B・スプリットテスト）

### 10.1 `SplitTestState` / `SplitArm` — SEOスプリットテスト（★主判定手法・§3.7.1）

> 同一URLで訪問者ごとに title を出し分けることは**不可能**だが、
> **ページ群を2グループに分けて期間中の推移を比較する split test は成立する**（記事157本あれば足りる）

<!-- enum: SplitTestState -->
| 値 | 意味 |
|---|---|
| `running` | 実行中 |
| `concluded` | 判定済み |
| `aborted` | 中止 |

<!-- enum: SplitArm -->
| 値 | 意味 |
|---|---|
| `treatment` | 処置群（変更を適用） |
| `control` | 対照群（変更しない） |

> ★**層別ランダム化**（`stratum` = clusterId × 順位帯 × funnelStage）。無作為に分けると初期条件がズレて結論が歪む。

### 10.2 `ExperimentationTarget` / `ExperimentationMetric` / `ExperimentationState` — LP/CTA の A/B（§3.7.2）

<!-- enum: ExperimentationTarget -->
| 値 | 意味 |
|---|---|
| `lp` | ランディングページ |
| `cta` | CTA |
| `form` | フォーム |

<!-- enum: ExperimentationMetric -->
| 値 | 意味 |
|---|---|
| `submit_rate` | 送信率 |
| `cta_click_rate` | CTAクリック率 |

<!-- enum: ExperimentationState -->
| 値 | 意味 |
|---|---|
| `draft` | 下書き |
| `running` | 実行中 |
| `concluded` | 判定済み |
| `underpowered` | **必要サンプル数への到達見込みが3ヶ月超 → 起動を拒否**。代わりに「大きく変えて before/after」を提案する |

---

## 11. 運用・監視

### 11.1 `RegulatoryEventType` / `RegulatoryEventStatus` — 税制改正カレンダー（§3.8.2）

> **毎年12月に大綱 → 3月に成立 → 4月に施行**と予定が決まっている。
> ★期日の**60日前**に段5へ「記事準備」Action を自動起票する（**現状は「改正が起きてから反応」**）

<!-- enum: RegulatoryEventType -->
| 値 | 意味 |
|---|---|
| `outline` | 税制改正大綱（12月） |
| `enactment` | 成立（3月） |
| `enforcement` | 施行（4月） |
| `expiry` | 適用期限（★該当記事を一括で `overdue` にする） |
| `public_comment` | パブリックコメント |

<!-- enum: RegulatoryEventStatus -->
| 値 | 意味 |
|---|---|
| `scheduled` | 予定 |
| `occurred` | 発生済み |
| `cancelled` | 中止 |

### 11.2 `LpType` / `LandingPageStatus`（§3.8.6）

<!-- enum: LpType -->
| 値 | 意味 |
|---|---|
| `consultation` | 無料相談LP（PRJ-029 診断LP） |
| `product` | 商材別LP |
| `comparison_hub` | 比較ハブ |
| `agency` | 代理店LP（PRJ-034） |

<!-- enum: LandingPageStatus -->
| 値 | 意味 |
|---|---|
| `draft` | 下書き |
| `live` | 公開中 |
| `paused` | 停止中 |
| `retired` | 退役 |

> `LandingPage.offer`（`無料相談` / `資料DL` / `診断`）は**値が日本語のため Prisma enum にできず String**（`docs/PHASES.md` §8 U14）。

### 11.3 `Sentiment` — レピュテーション（§3.9.5）

<!-- enum: Sentiment -->
| 値 | 対応 |
|---|---|
| `positive` | — |
| `neutral` | — |
| `negative` | **即通知**（対応判断は石井さん。**AIは自動返信しない**） |

### 11.4 `IncidentSeverity` / `IncidentCategory` — インシデント（§3.10.6）

> ★**事故を記録しないと、対策は個別ファイルの1行に埋もれて失われる。** 今回まさにそれが起きていた。

<!-- enum: IncidentSeverity -->
| 値 | 意味 |
|---|---|
| `critical` | 事業停止級 |
| `high` | 高 |
| `medium` | 中 |
| `low` | 低 |

<!-- enum: IncidentCategory -->
| 値 | 初期登録される過去事故（P3.10） |
|---|---|
| `performance` | ① **TTFBスパイク**（自前PV計測の同期DB書込み） |
| `data_quality` | ② **問い合わせを「未計測」なのに「0」と表示し、直客2件の成約を見逃した** ／ ③ **GSC日次が10日欠測していたが誰も気づかなかった** ／ ④ 週次サマリーの Pillar/Cluster 集計が壊れていた |
| `availability` | （該当なし・`UptimeCheck` が検知する） |
| `security` | （該当なし） |
| `quality` | ⑤ intervention 記録が9件しか無く28日判定が回っていなかった |

### 11.5 `PerfGatePhase` / `PerfGateTarget` — デプロイ前後の性能ゲート（§3.10.5）

> ★**TTFB が 20%以上悪化、または LCP が 0.5秒以上悪化したらデプロイを失敗扱い**にして段7に赤

<!-- enum: PerfGatePhase -->
| 値 | 意味 |
|---|---|
| `before` | デプロイ前の計測 |
| `after` | デプロイ後の計測 |

<!-- enum: PerfGateTarget -->
| 値 | 意味 |
|---|---|
| `wp_theme` | WordPress テーマ（★過去の事故はここに紛れて入った） |
| `tracker` | 計測タグ |
| `lp` | ランディングページ |
| `plugin` | WordPress プラグイン |

---

## 12. 目標・KPI

### 12.1 `TargetTier` — KPIツリーの階層

> `inquiries ← lp_view ← cta_click ← clicks ← impressions`（`Target.parentMetric` で繋ぐ）

<!-- enum: TargetTier -->
| 値 | 意味 |
|---|---|
| `north_star` | 北極星指標（獲得3ゴール） |
| `leading` | 先行指標 |
| `guardrail` | ガードレール指標（悪化させてはいけない指標） |

---

### 12.2 `UserRole` — 認証ロール（§8）

> ★Auth.js 用の4モデル（`User` / `Account` / `Session` / `VerificationToken`）は**設計書 §3 の82モデルには含まれない**（`check-consistency.sh` が model 数から除外）。
> ただし **Role 自体は §8 で「最初から持たせる」と定められている**ため、ここに定義する。

<!-- enum: UserRole -->
| 値 | 権限 |
|---|---|
| `owner` | 全機能（石井さん） |
| `partner` | 一部のみ閲覧（将来パートナーに見せる場合） |
| `readonly` | 閲覧のみ（**新規ユーザーの既定値**） |

---

## 12.5 ツールのコスト管理（`/costs`）

> ★2026-07-21 追加（`docs/PHASES.md` §8 U62）。設計書 §3 には無いモデルだが、
> 「どのツールをどの目的で・いくらで・どの状態で使っているか」が
> どこにも記録されておらず、DataForSEO の残高が $0.137 まで枯渇して
> 週次SERP取得が途中で止まる状態を誰も見ていなかったため追加した。

### 12.5.1 `ToolBillingType` — 課金形態

<!-- enum: ToolBillingType -->
| 値 | 意味 |
|---|---|
| `monthly` | 月額課金 |
| `prepaid` | **前払い（残高を消費）**。枯渇すると無言でジョブが止まる |
| `free` | 無料プラン |

### 12.5.2 `ToolState` — 利用状態

> ★`stopped` を残すのは「やめた理由」を残すため。行ごと消すと
> 同じツールを再検討するたびに同じ調査を繰り返すことになる。

<!-- enum: ToolState -->
| 値 | 意味 |
|---|---|
| `considering` | 検討中（まだ契約していない） |
| `trial` | トライアル中 |
| `active` | 稼働中 |
| `stopped` | 停止・解約済み |

---

## 13. enum 化していない項目（String のまま・★推測で埋めない）

> 設計書に値の列挙が無い／`…` で打ち切られている／日本語値のため enum にできない項目。
> **値を決めるのは石井さんの判断**（`docs/PHASES.md` §8 U11 / U14 / U15）。

| model.field | 状況 |
|---|---|
| `Business.status` / `Partner.status` / `LineFriend.status` / `Keyword.status` / `Idea.state` / `AdCampaign.status` / `AdCreative.status` / `JobRun.status` | 列挙なし |
| `Channel.type` | `media \| threads \| instagram \| line \| agency_lp \| note …`（`…` で打切） |
| `ContentItem.type` / `.category` / `.eyecatchType` / `.eyecatchColor` / `.targetLabel` / `.complianceVerdict` / `.factCheckVerdict` | 列挙なし（旧Notion の select 値） |
| `Lead.companyType` / `.urgency` | 列挙なし |
| `Keyword.intent` | §14.1 が informational / commercial に言及するが §3 に列挙なし |
| `Keyword.priority` | 列挙なし（`/keywords` 画面では 🔴 / 🟠 で表現） |
| `MetricSnapshot.granularity` / `ClusterMetric.granularity` | 列挙なし（日次 / 週次 / 月次を想定） |
| `MeasurementCoverage.method` | 列挙なし |
| `Intervention.type` | 列挙なし（`ActionType` と同一かどうかも不明） |
| `Job.kind` | 列挙なし |
| `CrossPromotion.direction` | 列挙なし |
| `DataQualityCheck.kind` / `.verdict` | 列挙なし |
| `AuditLog.actorType` | 列挙なし（human / ai を想定） |
| `CtrCurve.segment` | `all \| comparison \| product_deep …`（`…` で打切） |
| `SplitTest.changeType` | `title \| meta \| cta_position \| intro_structure …`（`…` で打切） |
| `BrandMention.source` | `threads \| x \| google \| note \| 5ch …`（`…` で打切） |
| `BrandMention.entity` | 例示のみ（節税総研 / アセットサポート / ML / 石井 …） |
| `LandingPage.offer` | **値が日本語**（`無料相談` / `資料DL` / `診断`）→ Prisma enum 不可 |
| `AdCampaign.objective` | 列挙なし |
| `SeasonalityIndex.source` | 列挙なし |
| `ContentItem.productFit` / `.audience` / `.impacts` | `String[]`（語彙は §1.3 / §1.4 参照） |
