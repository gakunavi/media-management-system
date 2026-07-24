# cowork への報告: JSON-LD 検査を入れたら4種のバグが出ました（2026-07-24）

そのまま cowork に貼って使うプロンプト。**ご提案の予防策を実装した初回実行の結果です。**

---

## 実装しました（ご指定の2点そのまま）

`services/worker/builtin/jsonld_health.py`（毎日 06:10）

- **(a)** JSON-LD 内の全URL（`sameAs` / `BreadcrumbList.item` / `url` / `logo` /
  `contentUrl` / `@id`）を抽出して**実際に叩く**
- **(b)** **301 の先まで辿って最終ステータス**を見る

★動作確認: 既知のパンくず404（`/category/capital-investment/`）で
`status: 404 / hops: 1` を返すことを確認してから流しました。
**検出できない検査を入れても意味がない**ので、先に既知の不良で試しています。

## 初回実行の結果（60本）

```
JSON-LD 内のURL 619 件を検査 ／ 問題のある記事 7 / 60 本
```

**4種類のバグが出ました。うち3種は今まで誰も気づいていなかったものです。**

---

## ① ★`@id` が `/blog/` を指していて 404（100本中 **86本**）

```json
"@id": "https://asset-support.co.jp/blog/executive-retirement-allowance-rules-2026/"
                                     ↑ 公開URLは /media/
```

叩くと **301 → 404**。公開URLは `/media/executive-retirement-allowance-rules-2026/` です。

抜き取り100本の内訳:

```
  @id が /blog/ を含む : 86 本   ← 404
  @id が /media/ 等    :  0 本
  @id が自社URLでない  : 14 本
```

**`@id` を持つ記事は全部 `/blog/`** です。投稿タイプのスラッグ（`blog`）が
そのまま出ており、公開パス（`/media/`）になっていません。

★`@id` は仕様上「識別子」であって必ずしも取得可能である必要はありませんが、
**canonical と食い違っている**ため、エンティティ同定の観点では直す価値があると
考えます。**ただしSEO上の優先度はそちらのご判断にお任せします。**
（`sameAs` の件と同じで、こちらは事実の提示までです）

## ② ★パンくずのリダイレクトループ（ART-161）

```
BreadcrumbList.item: https://asset-support.co.jp/media/jigyo-shokei-tokurei-keikaku-extension-2026-05
  → リダイレクトのループ
```

**ART-142 のピラー301ループと同型**です。あれは表示246・クリック0の原因でした。
**読者もクローラも到達できません。**

## ③ パンくず404（ART-072）— U75 の未対応分

```
BreadcrumbList.item: https://asset-support.co.jp/category/tax-reform-news/
  → 301 → 404
```

先にお送りした `cowork-breadcrumb-404.md` の `tax-reform-news`（14本）が
**実際に404であることを確認**しました。あちらの依頼に含まれています。

## ④ `contentUrl` の動画が404（ART-024 / ART-142）

```
ART-024  contentUrl: .../uploads/2026/04/art-024-hero-reel.mp4   → 404
ART-142  contentUrl: .../uploads/xxx.mp4                          → 404
```

★**ART-142 は `xxx.mp4` というプレースホルダが本番に残っています。**
VideoObject スキーマに実在しない動画を書いていることになります。

なお `contentUrl` は15種類あり、他は
`.../2026/05/ART-016-reel.mp4` のような正しい形でした。
**この2件だけ**が壊れています。

---

## 直す優先順（こちらの見立て・判断はお任せします）

| 優先 | 何 | 理由 |
|---|---|---|
| **高** | ② ループ（ART-161） | 到達不能。ART-142 で実害（表示246・クリック0）が出た型 |
| **高** | ③ パンくず404 | 読者もクローラも404に着く。既存依頼に含む |
| **中** | ④ `xxx.mp4` | プレースホルダが本番に出ている。1件は明確な事故 |
| **要判断** | ① `@id` の `/blog/` | 86本と広範。仕様上は識別子だが canonical と不一致 |

★①は本数が多く、**`sameAs` の再生成と同じバッチで直せる可能性**があります。
生成部（`bind-template.py`）が `@id` をどう組み立てているかを見れば
まとめて直せるかもしれません。`sameAs` の re-bind を検討される際に
**あわせてご確認いただけると効率的**だと思います。

---

## これで何が変わったか

**登録URLしか叩いていなかった穴が塞がりました。**

```
  url_health.py    : MMS 登録URL      = 「記事が開けるか」
  jsonld_health.py : JSON-LD 内のURL  = 「構造化データが正しいか」  ← 新設
  tag_delivery.py  : 読者と同じ条件   = 「計測タグが届いているか」
```

`sameAs` の件も、パンくず404も、**今後は翌朝の自動処理で出ます**。
今回のように手でHTMLを読んで見つける必要はなくなりました。

★結果は `DataQualityCheck(kind=jsonld_health)` に残り、
異常があれば既存の運用アラートに乗ります。
