# 石井さんへの依頼: テーマを deploy する（U72・cowork 実装完了済み）

cowork 側の実装は**4ファイルすべて完了**しています。あとは反映だけです。

---

## やること

`wp-theme/.v84_build/asset-support/` を zip にして、WordPress の
「外観 → テーマ → テーマのアップロード」で上書きしてください。
**1回の deploy で①②③すべて反映されます。**

編集されたファイル:

```
functions.php     ← the_content フィルタ（article-cta・★最重要）＋ヘルパー
single-media.php  ← media-article-bottom / media-article-sidebar
header-media.php  ← media-header / -material / -question
footer-media.php  ← media-footer-tabbar / -sns / -link
```

## deploy 後にやっていただきたいこと（1つだけ）

**Cloudflare のキャッシュをパージしてください。**

APO が古いHTMLを返すと、直したのに反映されていないように見えます
（7/24 に実際に起きました。6記事でタグが届いていませんでした）。

★MMS 側の自動パージは**毎朝05:50の検査時**なので、いま反映を確認したい場合は
手動パージが早いです。手順は `docs/prompts/ishii-cloudflare-purge.md`。

面倒であればパージ無しでも構いません。翌朝の自動処理で直ります。

---

## 現状（2026-07-24 時点・deploy 前）

本番を確認したところ、まだ反映されていません。

```
immediate-depreciation-tax-saving   記事ID付き = 0 ／ ID無し = 12
data-center-tax-saving              記事ID付き = 0 ／ ID無し = 11
```

## deploy が終わったら教えてください

私の方で、cowork と約束した4点を実際に確認します。

| # | 確認すること |
|---|---|
| 1 | 記事ページに `/r/line/article-cta-ART-xxx` が**複数**あるか（本文側・実測最多の場所） |
| 2 | 二重付与（`-ART-002-ART-002`）が無いか |
| 3 | トップ・カテゴリページでは**付いていない**こと |
| 4 | JSON-LD の `sameAs` が**書き換わっていない**こと |
| 5 | 実際にクリックが来たら、記事別に記録されるか |

★1〜4は**複数記事**で確認します。1本だけだと、たまたま通っただけかもしれません。

---

## 補足: これができると何が変わるか

いま「どの設置場所が押されたか」までは分かりますが、
**「どの記事から送られたか」がサーバー実測では分かりません**。

deploy 後は、**広告ブロックの影響を受けない数字**で
「この記事が公式LINEにどれだけ送ったか」が出せるようになります。

★実測で最も見られているのは `article-cta`（表示22回・17記事）で、
これは**記事本文の中**にあるためテンプレート修正では届かず、
cowork が `the_content` フィルタで対応しました。ここが今回の肝です。
