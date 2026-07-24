# cowork 依頼: パンくず（JSON-LD）が404を指している（U75・2026-07-24）

そのまま cowork に貼って使うプロンプト。**本番を実際に叩いて確認した結果です。**

---

## 見つけたこと（実測・2026-07-24）

記事のパンくず構造化データ（BreadcrumbList / JSON-LD）が、**存在しないカテゴリURL**を指しています。

例: **ART-090「GPU 節税 否認 7事例」** の JSON-LD

```json
{ "position": 2,
  "name": "設備投資・減税",
  "item": "https://asset-support.co.jp/category/capital-investment/" }
```

このURLを実際に叩くと、

```
/category/capital-investment/
  → 301 → /media/category/capital-investment/
  → 404  ★ここで行き止まり
```

**最終的に404**です。読者がパンくずを押すと404に着き、クローラも同じものを見ています。

一方、**正しいカテゴリページは実在します**。

```
/media/category/capex-tax-reduction/  → 200 ✅（カテゴリ名「設備投資・減税」と一致）
```

つまり **JSON-LD の slug が実在するカテゴリと違う**、というのが原因です。

### そのほか実測した挙動

| URL | 実際の挙動 | 判断 |
|---|---|---|
| `/media/category/capex-tax-reduction/` | **200** | ✅ これが正しい行き先 |
| `/category/capital-investment/` | 301 → **404** | ❌ **要修正**（JSON-LD がこれを指している） |
| `/media/category/cases-interviews/` | 301 → `/media/`（最終200） | ⚠️ **要判断**（下記） |
| `/media/category/partner/` | 301 → `/partners/`（最終200） | ⚠️ **要判断**（下記） |

---

## 依頼1: パンくずの slug を実在するものに直す（★これが本題）

**JSON-LD の `item` を、実在するカテゴリURLに合わせてください。**

```
変更前: https://asset-support.co.jp/category/capital-investment/     （→404）
変更後: https://asset-support.co.jp/media/category/capex-tax-reduction/  （→200）
```

2点あります。

1. **`/category/` ではなく `/media/category/`**（`/media/` が抜けています）
2. **slug が `capital-investment` ではなく `capex-tax-reduction`**

★同じ形の間違いが他のカテゴリにもある可能性があります。
**JSON-LD が出力しているカテゴリURLを全種類洗い出して、実在するものと突き合わせて**いただけますか。

★MMS 側でも `url_health.py`（日次）でURLを叩いていますが、**JSON-LD の中のURLまでは見ていません**でした。今回は記事ページのHTMLを直接読んで気づきました。

---

## 依頼2（要判断）: カテゴリページが無い2種をどうするか

パンくずに使う先として、この2つは**カテゴリページが存在しません**。

### ① `cases-interviews`（事例・インタビュー）— 該当3記事

| 記事 | タイトル |
|---|---|
| ART-054 | 節税提案の判断基準｜税理士インタビュー |
| ART-090 | GPU 節税 否認 7事例 |
| ART-102 | 節税商品 出口 切り替え事例集 |

- `/media/category/cases-interviews/` は **`/media/` へ301**（カテゴリページが無い）
- ★ただし**サイトのメガメニューには「カテゴリTOPへ →」としてこのURLが載っています**
  （ART-090 のHTMLで確認）。押すと `/media/` に飛ばされます

**どちらにしますか。**

| 案 | 内容 | 向き不向き |
|---|---|---|
| **A. カテゴリページを作る** | `/media/category/cases-interviews/` を実在させる | 3記事とまだ少ないが、事例は今後増える見込みなら有効 |
| **B. パンくずを別カテゴリに寄せる** | 例: ART-090 は「設備投資・減税」に寄せる | すぐ直る。ただし記事の性質（事例）が構造に出ない |
| **C. パンくずから外す** | ホーム → 記事 の2段にする | 最も安全だが、構造化データの情報量が減る |

★**SEO 上どれが良いかの判断はそちら（cowork）にお任せします。**
私（MMS側）は「404を指している」という事実と、選択肢の整理までです。

### ② `partner`（1記事）

- `/media/category/partner/` は **`/partners/` へ301**
- `/partners/` は**固定ページであってカテゴリではありません**

パンくずの2段目を固定ページにするのは構造として不自然なので、
**B案（別カテゴリに寄せる）か C案（外す）** が妥当だと考えていますが、こちらもご判断ください。

---

## 優先度

| | 内容 | 優先 |
|---|---|---|
| 依頼1 | `capital-investment` → `capex-tax-reduction`（**404を解消**） | **高**（読者もクローラも404に着いている） |
| 依頼1' | 他のカテゴリにも同じズレが無いか全種類の突合 | 高 |
| 依頼2① | `cases-interviews` の扱い（3記事） | 中 |
| 依頼2② | `partner` の扱い（1記事） | 低 |

## 直したら教えてください

MMS 側で以下を確認します。

1. 該当記事の JSON-LD を読み直し、**カテゴリURLが200を返すか**を実際に叩いて確認
2. `url_health.py` に「**JSON-LD の中のカテゴリURLも叩く**」検査を足すかを検討
   （今回は手で見つけました。同じ見落としを繰り返さないため）
