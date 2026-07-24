# cowork への報告: deploy 検証結果 — ②③①は成功、★`article-cta` だけ効いていません（2026-07-24）

そのまま cowork に貼って使うプロンプト。**本番を実際に取得して検証しました。**

---

## 結果（先に）

| # | 対象 | 結果 |
|---|---|---|
| ② ヘッダ帯 | `media-header` / `-material` / `-question` | ✅ **成功** |
| ③ フッタ | `media-footer-tabbar` / `-sns` / `-link` | ✅ **成功** |
| ① 記事末・サイドバー | `media-article-bottom` / `-sidebar` | ✅ **成功** |
| ★ **本文側** | **`article-cta`** | ❌ **効いていません** |
| 二重付与 | `-ART-xxx-ART-xxx` | ✅ **0件**（3記事で確認） |
| JSON-LD の `sameAs` | | ✅ **書き換わっていません**（意図どおり） |

**テンプレート側（①②③）は完璧です。`the_content` フィルタだけが当たっていません。**

---

## 実際のHTML（ART-002・キャッシュ迂回で取得）

```
   4 /r/line/article-cta                      ← ★ID無し
   1 /r/line/media-header-ART-002             ✅
   1 /r/line/media-header-material-ART-002    ✅
   1 /r/line/media-header-question-ART-002    ✅
   1 /r/line/media-article-bottom-ART-002     ✅
   1 /r/line/media-article-sidebar-ART-002    ✅
   1 /r/line/media-footer-tabbar-ART-002      ✅
   1 /r/line/media-footer-sns-ART-002         ✅
   1 /r/line/media-footer-link-ART-002        ✅
```

★ART-088 / ART-086 でも同じ結果でした（記事ID付き8件・`article-cta` は素のまま）。

### `article-cta` 4件の内訳（1件ずつ文脈を確認しました）

| # | 種別 | 直前のHTML |
|---|---|---|
| 1 | **本文のリンク** | `…いたします。</p><a href="https://collect.asset-support.co.jp/r/line/article-cta"` |
| 2 | **本文のリンク** | `…</a></li><li><a href="https://collect.asset-support.co.jp/r/line/article-cta"` |
| 3 | **本文のリンク** | `…ください。</p> <a href="https://collect.asset-support.co.jp/r/line/article-cta"` |
| 4 | JSON-LD | `"sameAs": [ "https://collect.asset-support.co.jp/r/line/article-cta"` |

**4番目（sameAs）が触られていないのは正しい挙動です**（ご指摘どおり href 限定が効いています）。
問題は **1〜3の本文リンクにも当たっていない**ことです。

---

## 切り分けで分かっていること

- **`functions.php` は deploy されています。** ヘルパー
  `asset_support_article_line_suffix()` が①②③で正しく `-ART-002` を返しています
- **同一ページ内**でテンプレート側は成功し、本文側だけ失敗しています
  → ヘルパーの問題ではなく、**`the_content` フィルタが本文に届いていない**
- Cloudflare のキャッシュではありません（`?nc=乱数` で迂回して取得。
  同じ応答でテンプレート側の `-ART-002` は見えています）

## 疑わしいところ（優先順）

### ① 正規表現が**絶対URL**に当たっていない ← 最有力

実際の本文の markup はこうです。**ホスト名込みの絶対URL**です。

```html
<a href="https://collect.asset-support.co.jp/r/line/article-cta" target="_blank" rel="noopener" style="…">
```

パターンが `href="/r/line/article-cta`（ルート相対）を前提にしていると当たりません。
`href="` から `/r/line/article-cta` までの間に **`https://collect.asset-support.co.jp`** が入ります。

```php
// 当たらない例
'#(href="/r/line/article-cta)(?!-ART-)#'

// 当たる例（ホスト部分を許す）
'#(href="[^"]*?/r/line/article-cta)(?!-ART-)#'
```

★検証されたケースは `<a href=".../r/line/article-cta">` と書かれていたので、
テスト時は絶対URLで通っていた可能性もあります。**実物と同じ文字列**
（上のホスト込み・`target` `rel` `style` 付き）で再検証していただけますか。

### ② 記事本文が `the_content` を通っていない

テーマが `get_the_content()` や `$post->post_content` を直接出力していると、
`the_content` フィルタは走りません。`single-media.php` の本文出力箇所が
`the_content()` になっているかご確認ください。

### ③ 優先度の競合

priority 20 より後で別のフィルタが本文を差し替えている可能性。
`999` など十分大きい値で試すと切り分けられます。

---

## 補足: なぜこれが最重要か（再掲）

MMS の実測で、記事内で**最も見られているのが `article-cta`** です。

```
article-cta            表示22回 / 17記事   ← 記事内で最多・3箇所ある
media-header系          9〜14回 / 6〜9記事  （②で成功）
media-article-bottom     0回              （①で成功したが実測0）
media-article-sidebar    0回              （画面幅により非表示のことが多い）
```

**いま成功している①②③だけでは、記事別データの主要部分が取れません。**
`article-cta` が入って初めて狙いどおりになります。

## 直ったら教えてください

同じ4点を再検証します（複数記事・二重付与・カテゴリ未付与・sameAs 不干渉）。
MMS 側の受け口はそのままで動きます。

★deploy 後は Cloudflare のパージもお願いします（毎朝05:50に自動で直りますが、
すぐ確認したい場合は手動が早いです）。
