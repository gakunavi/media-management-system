# cowork への返信: sameAs の出所を特定しました（差分あり・承認待ち）

そのまま cowork に貼って使うプロンプト。

---

## 結論（先に）

**出所は「MMS 側の JSON-LD 生成部」ではありませんでした。**
`bind-template.py` も `organization.yaml` も**正しい値を持っています**。

原因は **`lp-link-inject.py` の `track_line_links()` が、本文中の `lin.ee` を
無差別に置換していて、JSON-LD の中まで当たっている**ことです。

つまり **①で作った計測用の置換（生 lin.ee → `/r/line/article-cta`）が、
意図せず `sameAs` にも及んでいた**、というのが実体です。

---

## 出所（ファイルと行）

### ✅ ここは正しい（直す必要なし）

**`shared/brand/organization.yaml` 70行目**

```yaml
# 外部アカウント（整備後に追加）
same_as:
  - "https://lin.ee/szd8e1x"      ← ★正しい公式LINE URL が入っている
```

**`.claude/scripts/bind-template.py` 2285-2286行目**

```python
    if o.get('same_as'):
        obj['sameAs'] = o['same_as']     ← yaml の値をそのまま入れているだけ
```

生成の時点では **`"sameAs": ["https://lin.ee/szd8e1x"]`** と正しく出ています。

### ❌ ここが原因

**`.claude/scripts/lp-link-inject.py` 130-139行目**

```python
LINE_TRACK_URL = 'https://collect.asset-support.co.jp/r/line/article-cta'
RAW_LINE_RE = re.compile(r'https://lin\.ee/[A-Za-z0-9]+')


def track_line_links(content: str):
    """本文中の生 lin.ee を MMS 計測URLへ置換する。冪等。"""
    n = len(RAW_LINE_RE.findall(content))
    if n:
        content = RAW_LINE_RE.sub(LINE_TRACK_URL, content)   # ← ★ここ
    return content, {"line_tracked": n}
```

`RAW_LINE_RE.sub()` が**本文全体**に当たるため、
`<a href="…">` だけでなく **`<script type="application/ld+json">` の中の
`"sameAs": ["https://lin.ee/szd8e1x"]` も置換**されています。

---

## 提案する差分（before → after）

**方針**: 置換対象を「リンクの href」に限定します。
そちらの `the_content` フィルタで採用いただいた考え方と同じです。

```diff
 LINE_TRACK_URL = 'https://collect.asset-support.co.jp/r/line/article-cta'
 RAW_LINE_RE = re.compile(r'https://lin\.ee/[A-Za-z0-9]+')
+# ★href= の中だけを置換する。本文全体に当てると
+#   JSON-LD の "sameAs" まで書き換わる（2026-07-24 実測で判明）。
+#   sameAs は「同一主体を指す公式プロフィール」で、計測用URLを入れる項目ではない。
+#   identity（誰か）と計測（どこが押されたか）を混ぜない。
+RAW_LINE_HREF_RE = re.compile(r'(href=")https://lin\.ee/[A-Za-z0-9]+(")')


 def track_line_links(content: str):
     """本文中の生 lin.ee を MMS 計測URLへ置換する。冪等。"""
-    n = len(RAW_LINE_RE.findall(content))
+    n = len(RAW_LINE_HREF_RE.findall(content))
     if n:
-        content = RAW_LINE_RE.sub(LINE_TRACK_URL, content)
+        content = RAW_LINE_HREF_RE.sub(r'\g<1>' + LINE_TRACK_URL + r'\g<2>', content)
     return content, {"line_tracked": n}
```

★これで **`sameAs` は `https://lin.ee/szd8e1x` のまま残ります**。
ご指定の「リダイレクタの転送先＝本物のLINE公式アカウントURLに差し替え」と
**同じ結果**になります（差し替えるのではなく、そもそも書き換えないだけで済みます）。

★ご指定の「sameAs には計測ソースIDも `-ART-` も付けない」も自動的に満たされます。

### 転送先の一致を確認済みです

```
MMS の /r/line/ の転送先設定  MMS_LINK_DEST_LINE = https://lin.ee/szd8e1x
organization.yaml の same_as                     = https://lin.ee/szd8e1x
```

**一致しています。** 別途 LINE 管理画面から共有いただく必要はありません。

---

## 影響範囲（実測）

公開済み記事を30本抜き取って調べました。

```
  リダイレクタになっている  25 本   ← 要修正
  正しい lin.ee              0 本
  sameAs が無い              5 本
```

**sameAs を持つ記事は、いま全部リダイレクタになっています。**
（`wp/archive/*/output/*.html` にも 265ファイル該当がありますが、
これは生成物の履歴なので実害はありません）

---

## 進め方（ご提案）

1. 上の差分を当てる（**新規記事はこれ以降ズレなくなります**）
2. 既存記事の JSON-LD を再生成
   ★ここは**そちらの再生成フローに乗せていただく**のが安全だと考えます。
     本文全体を触るので、MMS 側から REST で書き換えるのは避けたいです
     （`§8-1 WordPress への書き込みは MMS API 経由に一本化` という規約があり、
     かつ本文の正は WordPress 側という設計にしています）
3. 再生成後、MMS 側で**全記事の `sameAs` が `lin.ee` になっているか**を
   一括で検査して報告します（すでに検査スクリプトの当てはあります）

---

## 補足: なぜ気づけなかったか（こちらの反省点）

MMS には日次でURLを叩く検査（`url_health.py`）がありますが、
**登録URLしか見ておらず、JSON-LD の中身は見ていません**でした。
先日のパンくず404（`/category/capital-investment/` → 301 → 404）も同じ理由で
検出できず、記事のHTMLを手で読んで初めて分かっています。

**「JSON-LD の中のURLも検査する」を入れるべき**だと考えています。
これがあれば、今回の sameAs もパンくず404も自動で出ます。
実装するかはこちらで判断し、入れたらご連絡します。
