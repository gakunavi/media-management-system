# メディア管理システム（MMS）

節税総研（asset-support.co.jp）のメディア・SNS運用から、**問い合わせ・代理店・LINE登録の獲得を増やす**ための自社基盤。

| | |
|---|---|
| 正式名称 | メディア管理システム |
| 略称 | **MMS** |
| DB名 | `mms` |
| API／MCPツール接頭辞 | `mms_*` |
| 環境変数接頭辞 | `MMS_*` |
| 起案 | 2026-07-20 / 石井政隆 |
| 現在の状態 | **ジョブ監視 完了**。実画面7つ（ダッシュボード/リード/記事/KW/クラスタ/施策/ジョブ）＋PDCA自動運転 |

---

## 目的

**① 直客の問い合わせ（最優先） ② 代理店開拓 ③ 公式LINE登録** を増やす。

そのために3つを実現する。

1. **見える化** — 結果と、そこに至るファネル全段が1画面で分かる
2. **自動運用** — 石井がコマンドを打つ回数をゼロにする
3. **PDCA** — 打った手が効いたかを対照群補正つきで自動判定し、次の手に活かす

**人を雇わない代わりの装置。** 従業員がやる「集計・報告・催促・記録・初動対応」を全部システムに寄せる。

---

## 技術構成

| 層 | 採用 |
|---|---|
| アプリ | Next.js 15（App Router）+ TypeScript |
| UI | shadcn/ui + Tailwind CSS + Recharts |
| DB | PostgreSQL 16（Docker Compose・ローカル） |
| ORM | Prisma |
| 認証 | Auth.js（Email magic link）+ Cloudflare Access |
| ジョブ | `jobs` テーブル + Python worker（既存 `.claude/scripts/` 40本超を書き直さず呼ぶ） |
| 常駐 | Docker Compose + launchd（`localhost:3000`） |
| 外部公開 | Cloudflare Tunnel + Access（スマホ閲覧） |

**追加固定費 0円**（DataForSEO 約110円/月を除く）

---

## ディレクトリ構成

```
media-management-system/
├─ README.md                      このファイル
├─ docker-compose.yml             db / migrate / web / worker
├─ .env.example                   環境変数のひな形（.env は絶対にコミットしない）
├─ docs/
│  ├─ DESIGN.md                   ★設計書（2,713行・全ての判断の根拠）
│  ├─ PHASES.md                   ★59 Phase の定義・依存・完了条件 ＋ 決定記録(§9)
│  ├─ RULES.md                    ★実装規約（全Phaseが読む）
│  ├─ GLOSSARY.md                 ★用語と取りうる値（enum は schema と機械照合）
│  ├─ check-consistency.sh        整合の機械検査（npm run check）
│  └─ prompts/P0-a.md             P0-a の依頼プロンプト
├─ apps/web/                      Next.js 15（App Router + Auth.js v5）
├─ packages/
│  ├─ db/                         ★Prisma schema（82モデル）+ migrations + seed
│  └─ shared/                     共有定数・型（段番号 / 未計測の表示）
├─ services/worker/               Python 常駐（jobs をポーリング）
│  └─ legacy/                     既存 .claude/scripts/ の置き場（P1で配置）
├─ launchd/com.mms.stack.plist    Mac 起動時の自動立ち上げ
└─ scripts/mms-up.sh              launchd から呼ばれる起動スクリプト
```

---

## 起動方法

### 初回セットアップ

```bash
cp .env.example .env
# .env を開いて最低限これらを埋める:
#   MMS_POSTGRES_PASSWORD  … openssl rand -hex 16
#   MMS_DATABASE_URL       … 上のパスワードを反映
#   AUTH_SECRET            … openssl rand -base64 32
#   MMS_OWNER_EMAIL        … 自分のメール（role=owner になる）

npm install
docker compose up -d          # db → migrate → web / worker の順に立ち上がる
npm run db:seed               # FreshnessRule 4件 + owner ユーザー
open http://localhost:3000
```

> ⚠️ ホストで別の PostgreSQL が 5432 を使っている場合は `.env` の
> `MMS_POSTGRES_PORT` を 5433 などに変える（コンテナ内は常に 5432）。

### 日常のコマンド

| 目的 | コマンド |
|---|---|
| 起動 / 停止 | `npm run up` / `npm run down` |
| ログ | `npm run logs` |
| 死活確認 | `curl -s localhost:3000/api/health` |
| 整合チェック | `npm run check` |
| 型チェック | `npm run typecheck` |
| スキーマ変更 | `npm run db:migrate`（★下の注意を必読） |
| DB を GUI で見る | `npm run db:studio` |
| 既存データの再移行 | `npm run migrate:legacy`（冪等） |
| 計測受口のテスト送信 | `npm run ingest:test -- --dup` |
| ファネル計測のテスト | `npm run events:test` |
| 定期ジョブの登録 | `npm run seed:jobs` |
| 計測開始/終了の記録 | `npm run measurement -- list` |

### ログイン

**このMac（localhost）では自動ログイン。** `MMS_DEV_AUTOLOGIN_EMAIL` を設定してあるので、
`http://localhost:3000` を開くとメール入力なしで owner としてログインされる。

- ★**外部からは作動しない**: Cloudflare Tunnel 経由（Host が公開ドメイン）では
  この自動ログインは無効で、通常の認証になる（`apps/web/app/api/dev-login/route.ts`）。
- 自動ログインを止めるには `.env` の `MMS_DEV_AUTOLOGIN_EMAIL` を空にする。

自動ログインを使わない場合は **Email マジックリンク方式**。`MMS_SMTP_HOST` が
未設定でもログインでき、リンクは web のログに出る（`docker compose logs -f web`）。
本番運用では `.env` に SMTP を設定すること。

### Mac 起動時の自動立ち上げ（launchd）

```bash
cp launchd/com.mms.stack.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.mms.stack.plist
```

> ★これは**Mac に常駐設定を入れる操作**なので、内容を確認してから実行すること。
> 解除は `launchctl unload ~/Library/LaunchAgents/com.mms.stack.plist`。

### ★スキーマ変更時の注意

`packages/db/prisma/migrations/*_nulls_not_distinct_unique/` は**手書きの
マイグレーション**で、NULL を含む一意制約を実際に効かせている
（`NULLS NOT DISTINCT`）。Prisma はこれを表現できないため、
`prisma migrate dev` がこれを打ち消す SQL を提案することがある。

**必ず `--create-only` で生成された SQL を目視し、
`DROP INDEX ... _key` が混ざっていたら消してから適用する。**
→ 詳細は `docs/RULES.md` §20-6

---

## 次にやること

`docs/PHASES.md` に従って **P2.5**（ファネル7段）→ **P2.6**（Lead属性・直客2件の遡及入力）と進める。

WordPress フォームの接続手順は `docs/INTEGRATIONS.md`。
着手順は「#」ではなく**依存**に従う。**M-A（15.0日）で一度止めて実際に使う。**

---

## 重要な決定事項（2026-07-20 石井確定）

| 項目 | 決定 |
|---|---|
| 主力商材 | **ML（マイグレーションライト）**。240万円/台・当社取り分20% |
| 粗利 | **直客 48万円/台** ／ 代理店経由（7.5%） 30万円/台 ／ **直客プレミアム 18万円/台** |
| 上限CPA | 直客・成約率20%想定で **9.6万円/台** |
| 買い手の軸 | **法人/個人事業主ではなく「投下可能な節税予算 × 比較検討段階」**（実データで訂正） |
| 商談以降 | **m2（ML営業管理システム）に載せる**。MMSはリードまで |
| 電話問い合わせ | **手動記録**（tel:クリックのみ自動計測） |
| 第三者提供の同意 | **不要**（ML事業部として自社対応） |
| AIへの個人情報 | **渡さない**（氏名・連絡先はマスキング） |
| Notion | **廃止**（プロパティ全件を移行後） |
| note / 新Threadsアカウント | **初期スコープ外**（将来追加） |

---

## 未決事項

**なし**（2026-07-20 に全て決定済み。判断の根拠は `docs/PHASES.md` §9 決定記録）。

| かつての論点 | 決定 |
|---|---|
| プライバシーポリシーの専門家確認 | **行わない**（ポリシー改定自体は P0.5 で実施） |
| m2 側の「リード元＝メディア」項目 | **m2 は改修しない。** 紐付けの正は MMS 側の `Lead.m2DealId` |
| 広告審査に通るか | **事前確認しない。** 小額テストで実地に判明させ、不承認なら P7.5/P7.6 を中止 |

---

## 成功条件と撤退条件

**M-A 到達（15日）後の30日間で判定。**

| # | 指標 | 目標 |
|---|---|---|
| 1 | **問い合わせの経路特定率** | **100%** |
| 2 | リード数 | 月2件以上 |
| 3 | 石井がコマンドを打つ回数 | **0回** |
| 4 | 週1回以上ダッシュボードを開いているか | — |

**2つ以上未達なら以降の Phase を止めて設計を見直す。**
各 Phase 完了時に「予定日数の1.5倍を超えていないか」を確認し、超過ならその時点でスコープを削る。

---

## 関連（経営戦略室）

| 資産 | パス |
|---|---|
| ML着金予定と直客初成約の実データ | `経営戦略室/10_事業_節税商材代理店/04_数値KPI/2026-07-20_ML着金予定と直客初成約.md` |
| ツール調査（build vs buy・市場調査の根拠） | `経営戦略室/92_ナレッジ/2026-07-20_メディアSNS統合管理システム_ツール調査.md` |
| 経営方針・マイルストーン | `経営戦略室/00_全社/経営方針.md` |

## 関連（メディア事業部）

既存資産は書き直さず、worker から呼ぶ。

| 資産 | 扱い |
|---|---|
| `.claude/scripts/` 40本超（Python） | worker の `legacy/` に配置しそのまま呼ぶ |
| `tools/media-console/media.db`（14テーブル） | P1 で Postgres へ移行後、退役 |
| `shared/gsc-data/timeseries.db` | 同上 |
| `console.html` | P7 で `/content` へ移植後、退役 |
| Threads GAS | **継続**。Insights を `/api/ingest/threads` へPOSTする関数を1つ追加 |
