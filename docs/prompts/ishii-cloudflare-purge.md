# 石井さんへの依頼: Cloudflare のキャッシュを6本だけパージする（2026-07-24）

作業は **Cloudflare のダッシュボードで2分**。

---

## 何が起きているか

**6本の記事で、読者に届いているHTMLに計測タグが入っていません。**
サーバー側（オリジン）にはちゃんと入っています。**Cloudflare のキャッシュが古いだけ**です。

| 記事 | 内容 |
|---|---|
| ART-002 | 即時償却とは？中小企業経営強化税制… ← **主力商材** |
| ART-007 | 法人節税の完全ガイド【2026年版】 ← **ピラー** |
| ART-086 | GPU 節税の完全ガイド ← **ピラー** |
| ART-088 | データセンター 節税のスキーム |
| ART-009 | 即時償却 税額控除の違いと選び方 |
| ART-041 | 2026年 法人税制改正の全体像 |

残り153本は正常に配信されています。

★**なぜ今まで気づかなかったか**: 確認するときにURLへクエリを足して叩いていたため、
Cloudflare を素通りして**オリジンの正しいHTML**を見ていました。
読者と同じ条件（ブラウザとして叩く）で確認して初めて出ました。
この確認手順は `docs/RULES.md` §4-95 に規約として追加済みです。

## 影響

この6本を読んだ人の行動が**1件も記録されていません**。
記事内のリンククリック・CTA表示・LPへの送客が、この6本ぶんだけ欠けています。

★ただし**GSCの表示・クリックは別経路（Search Console API）なので影響ありません**。
欠けているのは記事内の行動計測だけです。

---

## 作業手順

1. **Cloudflare ダッシュボード** → 対象ドメイン `asset-support.co.jp`
2. 左メニュー **Caching** → **Configuration**
3. **Purge Cache** → **Custom Purge** を選ぶ
4. **URL** を選び、以下6本を貼る

```
https://asset-support.co.jp/media/immediate-depreciation-tax-saving/
https://asset-support.co.jp/media/houjin-setsuzei-complete-guide-2026/
https://asset-support.co.jp/media/gpu-server-tax-saving-pillar/
https://asset-support.co.jp/media/data-center-tax-saving/
https://asset-support.co.jp/media/sokuji-shokyaku-vs-zeigaku-koujyo-comparison/
https://asset-support.co.jp/media/reiwa-8-tax-reform-2026/
```

5. **Purge** を押す

> ★**「Purge Everything」は押さないでください。** 全ページがオリジンから
> 取り直しになり、一時的にサイトが重くなります。過去に重量化事故を起こしているので、
> 必要な6本だけにします。

## 終わったら教えてください

私の方で、読者と同じ条件（ブラウザとして）で6本を叩き直して、
タグが配信されているかを確認します。

---

## お願いしたいこと（今後のために）

**WordPress のテーマ・プラグイン・計測タグを変更したら、その直後に
Cloudflare のキャッシュをパージする**——これを作業の一部にしていただけると、
同じことが起きません。

パージしていない間は「実装した」であって「配信された」ではない、という状態です。

★MMS 側でも自動で検知できるようにします（`url_health.py` に
「読者と同じ条件で叩いてタグの有無を見る」検査を足す）。ただしそれは検知であって、
**パージ自体は Cloudflare の権限が要る**ので、当面は手作業でお願いします。

## 確認したいこと（1点）

Cloudflare の **API トークン**（キャッシュパージ権限のみ）を発行して
`.env` に置いていただけると、**MMS 側から自動でパージできます**。
WP を更新したら自動でパージ → 検証、まで閉じられます。

必要かどうかは石井さんの判断でお願いします。いまは手作業でも回ります。
