# cowork への返信: ②③も当ててください。ただし ① に**抜け**があります（2026-07-24）

そのまま cowork に貼って使うプロンプト。

---

## 結論（先に）

**②③も当てて、ワンショットで deploy でお願いします。**

理由: ヘルパーが `is_singular('blog')` で自己ガードしているので、②③を足しても
**リスクは①と同じ**です。呼び出し箇所が増えるだけで、仕組みは1つ。
分けても検証の精度は上がらず、deploy が2回になるだけです。

**ただし、その前に1つ直していただきたいことがあります。**

---

## ★① に最も重要な設置場所が入っていません: `article-cta`

記事ページの本番HTMLを実際に取得して数えました（ART-002 / ART-088 で確認）。

| 設置場所 | 1記事あたりの出現数 | ①に含まれる？ |
|---|---:|---|
| **`article-cta`** | **3〜4箇所** | ❌ **入っていない** |
| `media-header` / `-material` / `-question` | 各1 | ②で対応予定 |
| `media-article-bottom` | 1 | ✅ ①で対応済み |
| `media-article-sidebar` | 1 | ✅ ①で対応済み |
| `media-footer-tabbar` / `-sns` / `-link` | 各1 | ③で対応予定 |

そして MMS の実測でも、**`article-cta` が記事内で最も見られています**。

```
設置場所                  表示回数  関与した記事数
site-header                   24        14
article-cta                   22        17   ← 記事内で最多
header-strip-material         14         9
header-strip-question         12         9
media-header                   9         6
media-footer-tabbar            1         1
media-article-bottom           0         0   ← ①で対応した先
media-article-sidebar          0         0   ← ①で対応した先（非表示のことが多い）
```

★`media-article-sidebar` は実測でも**高さ0**（画面幅によって非表示）でした。

**つまり ① だけを deploy しても、記事別のデータはほぼ増えません。**
検証にも使えません（0件のままなので、動いているのか壊れているのか判別できない）。

---

## なぜ ① に入らなかったか（原因は分かっています）

`article-cta` は**テンプレートではなく記事本文（post_content）の中**にあります。

WP REST API で ART-002 の本文を取得して確認しました。

```
本文の長さ: 82,897 文字
★本文の中の article-cta: 4 箇所
  本文の中の media-article-bottom : 0 箇所
  本文の中の media-article-sidebar: 0 箇所
  本文の中の media-header         : 0 箇所
  本文の中の media-footer-tabbar  : 0 箇所
```

`media-*` は全部テンプレート側、**`article-cta` だけが本文側**です。
だから `single-media.php` を直しても届きません。

さらに、公開済み20本を抜き取って調べたところ **20本すべての本文に `article-cta` があり**、
**20本すべてに `article_id` meta が入っていました**（そちらの Q2 の回答どおりです）。

---

## お願い: `the_content` フィルタで付けてください

記事159本を手で直すのは非現実的なので、**出力時に置換する**のが妥当だと考えます。

```php
// 記事本文の中の /r/line/article-cta に記事IDを付ける
add_filter('the_content', function ($html) {
    if (!is_singular('blog')) return $html;          // 記事ページだけ
    $suffix = asset_support_article_line_suffix();    // 既存のヘルパーをそのまま使う
    if ($suffix === '') return $html;                 // article_id が無ければ従来どおり

    // ★既に -ART-xxx が付いているものは二重に付けない
    return preg_replace(
        '#(/r/line/article-cta)(?!-ART-)#',
        '$1' . $suffix,
        $html
    );
}, 20);
```

### 注意していただきたい点

1. **二重付与を防ぐ**（上の `(?!-ART-)`）。将来 `article-cta` を本文に足したときに
   二度置換されると `-ART-002-ART-002` になり、40字制限と正規表現の両方に引っかかります

2. **JSON-LD の `article-cta` は置換しないでください**
   ART-002 のHTMLで、Organization スキーマの `sameAs` に
   `https://collect.asset-support.co.jp/r/line/article-cta` が入っていました。
   ここに記事IDが入ると、**構造化データに記事ごとに違うURLが出る**ことになります。
   `the_content` フィルタなら本文だけなので通常は当たりませんが、
   スキーマを本文内で出力している場合はご確認ください。
   ★そもそも `sameAs` にリダイレクタURLを入れるのが適切かは別途ご判断ください
   （`sameAs` は公式SNSアカウント等を指す項目です）。

3. **設置場所名は変えない**（`article-cta` のまま）。変えると過去の実績と繋がりません

---

## まとめ: この順でお願いします

1. `the_content` フィルタで **`article-cta`** に対応（★これが最重要）
2. ②ヘッダ帯（`media-header` / `-material` / `-question`）
3. ③フッタ（`media-footer-tabbar` / `-sns` / `-link`）
4. ①と合わせて **1回で deploy**

## deploy 後にこちらで確認すること

石井さんが deploy された後、MMS 側で以下を確認します。

1. 記事ページのHTMLを実際に取得し、**`/r/line/article-cta-ART-002`** のように
   なっているかを数える（複数記事で）
2. 二重付与（`-ART-002-ART-002`）が無いか
3. トップ・カテゴリページでは **付いていない**こと（仕様どおり）
4. 実際にクリックが来たら、記事別に `ContentMetric` へ入るか

MMS 側の受け口は動作確認済みです（`/r/line/media-article-bottom-ART-002` を叩いて、
ART-002 に記事別で1件記録され、設置場所の内訳に記事IDが混ざらないことを確認済み）。

---

## 参考: いまクリックがほぼ0であることについて

上の表で**クリックが全設置場所で0**なのは、計測タグ側（JS）の数字です。
リダイレクタ側（サーバー実測）では本日7件のクリックが記録されています。

両者が一致しないのは想定どおりで、
**合計はリダイレクタが正・内訳は計測タグ**という使い分けにしています。
記事IDが入れば、**内訳もサーバー実測で取れる**ようになります。これが今回の狙いです。
