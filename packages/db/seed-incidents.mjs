// 過去の事故を記録する（設計書 §3.10.6 / P3.10）
//
// ★なぜ要るか
//   「事故を記録しないと、対策は個別ファイルの1行に埋もれて失われる」（§3.10.6）。
//   実際そうなっていた。対策が docs/RULES.md の1行になっていても、
//   **何が起きてそう決めたのか**が残らないと、次の人（次の私）が同じ道を通る。
//
// ★preventionActions には「実装済みか」のチェックを必ず付ける（§3.10.6）。
//   対策を書いただけで満足すると、書いたのに入っていない状態が残る。
//   done:false のものは**まだ守られていない**ことを意味する。
//
// ★日付は分かっているものだけ入れる。推測で埋めない（§3）。
//   古い事故は「いつ起きたか」の記録が無いので、検知日＝記録日とせず
//   分かる範囲の日付を入れ、note に「日付は概算」と書く。
//
// 実行: npm run seed:incidents
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** JST の日付を UTC の Date にする（§9-4: 日付の1日は JST 00:00〜23:59） */
const jst = (s) => new Date(`${s}T00:00:00+09:00`);

const INCIDENTS = [
  // ───────── 設計書 §3.10.6 の5件 ─────────
  {
    key: "ttfb-spike-selfmade-pv",
    occurredAt: jst("2026-05-01"),
    detectedAt: jst("2026-05-01"),
    resolvedAt: jst("2026-05-01"),
    severity: "critical",
    category: "performance",
    title: "TTFBスパイク（自前PV計測が同期でDB書込みしていた）",
    symptom:
      "サイトの応答が急激に遅くなった。WPテーマに入っていた自前のPV計測が、" +
      "ページ表示のたびに同期でDBへ書き込んでいた。",
    rootCause:
      "★本当の問題は遅さそのものではなく、**何千回発火しても誰も気づかなかったこと**。" +
      "発火回数を見る仕組みが無く、テーマ更新に紛れて入ったため変更点も追えなかった。",
    resolution: "自前PV計測を停止。計測は MMS の /api/ingest へ送る方式に切り替えた。",
    preventionActions: [
      { action: "計測タグの7原則（バッファ→sendBeacon 1発・throttle・冪等キー・非同期・WP側で書かない・defer・自己遮断）", done: true, ref: "docs/RULES.md §1" },
      { action: "TelemetryVolume で発火回数そのものを監視する", done: false, ref: "P2.11（未着手）" },
      { action: "デプロイ前後で PSI を測り、劣化したら失敗扱いにする", done: false, ref: "P1.9（未着手）" },
      { action: "計測タグは子テーマ／専用プラグインに置く（functions.php 直書き禁止）", done: true, ref: "docs/RULES.md §1.2" },
    ],
    relatedPhase: "P2.5",
    note: "日付は概算（2026年5月ごろ）。当時の記録が残っていないため、月のみ確か。",
  },
  {
    key: "zero-vs-unmeasured-lead",
    occurredAt: jst("2026-06-20"),
    detectedAt: jst("2026-07-19"),
    severity: "critical",
    category: "data_quality",
    title: "「未計測」を「0」と表示し、直客2件の成約を見逃した",
    symptom:
      "問い合わせ件数が 0 と表示されていたが、実際には直客から問い合わせが来て成約していた。" +
      "計測していないだけなのに「実績ゼロ」に見えていた。",
    rootCause:
      "計測開始日を持っておらず、記録が無いことと値が0であることを区別できなかった。" +
      "★この2つは打ち手が正反対（前者は計装する・後者は集客を直す）。",
    resolution:
      "MeasurementCoverage を導入し、期間の記録が無い指標は集計から physically 除外して " +
      "「—(未計測)」と表示する。0 とは絶対に書かない。",
    preventionActions: [
      { action: "MeasurementCoverage に計測開始日を記録する", done: true, ref: "docs/RULES.md §2" },
      { action: "UI は未計測を「—(未計測)」と表示し 0 と書かない", done: true, ref: "docs/RULES.md §2-1" },
      { action: "受口は初回受信で計測開始を自動記録する", done: true, ref: "apps/web/app/api/ingest/events/route.ts" },
      { action: "テストが偽の計測記録を作らないよう後片付けする", done: true, ref: "docs/RULES.md §4-100" },
    ],
    relatedPhase: "P2",
    note: "成約2件（粗利96万円）。発生日は最初のリード発生月、検知日は MMS で気づいた日。",
  },
  {
    key: "gsc-10day-gap",
    occurredAt: jst("2026-06-01"),
    detectedAt: jst("2026-06-11"),
    resolvedAt: jst("2026-06-11"),
    severity: "high",
    category: "data_quality",
    title: "GSC日次の取り込みが10日欠測していたが誰も気づかなかった",
    symptom: "検索の実測データが10日ぶん抜けていた。気づいたのは後から grafana 的に眺めたとき。",
    rootCause:
      "日次ジョブが失敗しても誰にも届かず、欠測を検知する仕組みも無かった。" +
      "★GSC API は16ヶ月しか遡れないので、放置すると**取り返しがつかない**。",
    resolution: "欠測の自動補填（最終取得日〜昨日の穴を毎回埋める）と、3日以上の欠測で段7を赤にする検知を入れた。",
    preventionActions: [
      { action: "日次ジョブは欠けている日を毎回チェックして埋める（backfill）", done: true, ref: "docs/RULES.md §2.1" },
      { action: "3日以上の欠測を段7で赤表示する", done: true, ref: "lib/dashboard.ts getJobHealth()" },
      { action: "反映待ち（GSCは2〜3日遅れが正常）と欠測を分けて出す", done: true, ref: "docs/RULES.md §4-10" },
      { action: "ジョブが成功していても指標が更新されていない場合を検知する", done: true, ref: "getMetricFreshness()" },
    ],
    relatedPhase: "P1",
    note: "日付は概算。欠測の期間は timeseries.db の穴から推定した。",
  },
  {
    key: "weekly-summary-pillar-cluster",
    occurredAt: jst("2026-06-01"),
    detectedAt: jst("2026-07-20"),
    resolvedAt: jst("2026-07-23"),
    severity: "medium",
    category: "data_quality",
    title: "週次サマリーの Pillar/Cluster 集計が壊れていた（両方 Cluster と表示）",
    symptom: "ピラー記事とクラスタ記事の区別がつかず、どちらも Cluster として集計されていた。",
    rootCause: "集計スクリプトが役割を判定できておらず、構造の欠陥（ピラー不在・孤児）も見えていなかった。",
    resolution:
      "TopicCluster / ContentCluster に移行し、役割を持たせた。メディア事業部の台帳（pillar-plan.md / " +
      "art-kw-map.yaml）を正として投入した。",
    preventionActions: [
      { action: "クラスタ構造をモデル化し、ピラー不在・thin・孤児を一覧で出す", done: true, ref: "P4.3 / /clusters" },
      { action: "「ピラーが無い」を1種類として扱わない（紐付け漏れと設計上不在を分ける）", done: true, ref: "docs/RULES.md §4-30" },
      { action: "日本語名から slug を作るときは名前のハッシュを付ける", done: true, ref: "docs/RULES.md §4-27" },
      { action: "人が決めた値を実測で上書きしない", done: true, ref: "docs/RULES.md §4-26" },
    ],
    relatedPhase: "P4.3",
    note: "日付は概算。検知は MMS 移行時の突合による。",
  },
  {
    key: "intervention-not-recorded",
    occurredAt: jst("2026-04-01"),
    detectedAt: jst("2026-07-20"),
    severity: "high",
    category: "quality",
    title: "打ち手の記録が9件しか無く、28日後の判定が回っていなかった",
    symptom:
      "リライトなどの打ち手を実施しても記録が残らず、効果があったのかどうかを誰も判定していなかった。" +
      "PDCA の Check が存在しない状態。",
    rootCause: "打ち手の実施と記録が分かれており、記録は手作業だったので続かなかった。",
    resolution: "承認すると Intervention が自動生成され、判定日（実施＋28日）が予約されるようにした。",
    preventionActions: [
      { action: "承認時に Intervention を自動生成し判定日を予約する", done: true, ref: "P4" },
      { action: "対照群補正を必ず入れる（季節変動を効果と誤判定しない）", done: true, ref: "docs/RULES.md §6-1" },
      { action: "サンプル不足は inconclusive とし「効果なし」と区別する", done: true, ref: "docs/RULES.md §3-7 / §3-8" },
      { action: "判定できるかを判定日より前に警告する（実測0日のものを事前に出す）", done: true, ref: "docs/RULES.md §4-72" },
      { action: "前提が壊れていた打ち手は判定日を延ばす（嘘の学習を残さない）", done: true, ref: "docs/RULES.md §4-74" },
    ],
    relatedPhase: "P4",
    note: "日付は概算。件数9件は移行時の実測。",
  },

  // ───────── 移行後に実際に起きた事故（記録しておく価値があるもの） ─────────
  {
    key: "disk-full-postgres-crashloop",
    occurredAt: jst("2026-07-23"),
    detectedAt: jst("2026-07-23"),
    resolvedAt: jst("2026-07-23"),
    severity: "critical",
    category: "availability",
    title: "ディスクが満杯になり Postgres がクラッシュループした",
    symptom:
      "画面が開かなくなった。Postgres が pg_logical のチェックポイントを書けず " +
      "PANIC で落ち、再起動してまた満杯、の無限ループになっていた。",
    rootCause:
      "Docker のビルドキャッシュとタグ無しイメージが溜まり続けていた。" +
      "★ジョブの成否では気づけない。DBが落ちればジョブ自体が動けず、失敗の記録すら残らない。",
    resolution: "不要なイメージとビルドキャッシュを削除。日次の掃除を自動化した。",
    preventionActions: [
      { action: "ストレージ使用率を段7に独立した監視項目として持つ（90%警告 / 95%赤）", done: true, ref: "docs/RULES.md §11.9-1 / getStorageHealth()" },
      { action: "掃除を人手に頼らない（docker-gc.sh を日次04:30・日次ジョブの前）", done: true, ref: "docs/RULES.md §11.9-3" },
      { action: "docker image prune に -a を付けない／volume prune は絶対に使わない", done: true, ref: "docs/RULES.md §11.9-4" },
      { action: "DB接続を開いたまま外部I/Oをしない（autocommit にする）", done: true, ref: "docs/RULES.md §4-51" },
    ],
    relatedPhase: "P0",
  },
  {
    key: "pillar-301-loop",
    occurredAt: jst("2026-07-23"),
    detectedAt: jst("2026-07-23"),
    resolvedAt: jst("2026-07-23"),
    severity: "critical",
    category: "availability",
    title: "P1ピラー記事が301の無限ループに陥り、読者もクローラも到達できなかった",
    symptom:
      "ART-142（中小企業経営強化税制）が表示246・クリック0。記事は存在するのに誰も読めていなかった。",
    rootCause:
      "統合時のリダイレクト設定が相互に向き合ってループしていた。" +
      "★台帳・config・MMS の三者は一致していたため、静的な突合では一切引っかからなかった。" +
      "さらに Cloudflare APO が古い301をキャッシュし続けていた。",
    resolution: "リダイレクト設定を修正し、URLを実際に叩いて到達を確認する日次チェックを入れた。",
    preventionActions: [
      { action: "URLは登録の突合だけでなく実際に叩いて挙動を確かめる（url_health.py 日次）", done: true, ref: "docs/RULES.md §4-40 / §4-42" },
      { action: "エッジキャッシュを迂回して叩く（クエリを1つ足す）", done: true, ref: "docs/RULES.md §4-44 / §4-59" },
      { action: "301元を競合記事・カニバリの集計に混ぜない", done: true, ref: "docs/RULES.md §4-39" },
      { action: "異常が正常なもの（301元・下書き・旧URL）をチェック対象から外す", done: true, ref: "docs/RULES.md §4-43 / §4-45" },
      { action: "前提が壊れていた打ち手は判定日を延ばす（統合が効かないという誤った学習を残さない）", done: true, ref: "docs/RULES.md §4-74" },
    ],
    relatedPhase: "P8.2",
  },
  {
    key: "tag-not-delivered-apo",
    occurredAt: jst("2026-07-23"),
    detectedAt: jst("2026-07-24"),
    resolvedAt: jst("2026-07-24"),
    severity: "high",
    category: "data_quality",
    title: "計測タグが6記事で読者に届いておらず、その記事の行動が1件も残っていなかった",
    symptom:
      "オリジンにはタグが入っているのに、読者に届くHTMLには入っていなかった。" +
      "該当は即時償却（主力商材）とピラー2本を含む6本。",
    rootCause:
      "Cloudflare APO のキャッシュが古いままだった。" +
      "★確認するときURLにクエリを足して叩いていたため、キャッシュを素通りして" +
      "**オリジンの正しいHTML**を見ていた。読者と同じ条件で見ていなかった。",
    resolution:
      "該当6本をパージ。読者と同じ条件（ブラウザのUA＋Accept: text/html・クエリなし）で" +
      "毎日確認し、ズレていれば自動でパージする日次処理を入れた。",
    preventionActions: [
      { action: "実訪問者と同じ条件で叩いて配信を確認する（tag-delivery-daily 毎日05:50）", done: true, ref: "docs/RULES.md §4-95 / builtin/tag_delivery.py" },
      { action: "Cloudflare のトークンを設定し、ズレたら該当URLだけ自動パージする", done: true, ref: ".env MMS_CLOUDFLARE_API_TOKEN" },
      { action: "計測を「人が data 属性を貼る」設計にしない", done: true, ref: "docs/RULES.md §4-94" },
      { action: "Purge Everything を使わない（全ページ取り直しで自分で重量化事故を再現することになる）", done: true, ref: "builtin/tag_delivery.py MAX_AUTO_PURGE" },
    ],
    relatedPhase: "P2.5",
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const inc of INCIDENTS) {
    const { key, note, ...data } = inc;
    // ★key で冪等にする。Incident に自然キーが無いので title で照合する。
    //   何度実行しても増えないようにしないと、seed のたびに事故が水増しされる。
    const existing = await prisma.incident.findFirst({ where: { title: data.title } });
    const payload = {
      ...data,
      preventionActions: data.preventionActions,
      relatedContentIds: data.relatedContentIds ?? [],
      symptom: note ? `${data.symptom}\n\n（${note}）` : data.symptom,
    };
    if (existing) {
      await prisma.incident.update({ where: { id: existing.id }, data: payload });
      updated += 1;
      console.log(`  ↻ ${data.title.slice(0, 44)}`);
    } else {
      await prisma.incident.create({ data: payload });
      created += 1;
      console.log(`  ✓ ${data.title.slice(0, 44)}`);
    }
  }

  // ★対策のうち「まだ入っていない」ものを必ず出す。
  //   書いただけで満足すると、書いたのに実装されていない状態が残る。
  const pending = INCIDENTS.flatMap((i) =>
    (i.preventionActions ?? []).filter((a) => !a.done).map((a) => `${i.title.slice(0, 20)}… → ${a.action}（${a.ref}）`),
  );
  console.log(`\n登録 ${created}件 / 更新 ${updated}件 / 合計 ${INCIDENTS.length}件`);
  if (pending.length > 0) {
    console.log(`\n★まだ入っていない再発防止策 ${pending.length}件:`);
    for (const p of pending) console.log(`  ・${p}`);
  } else {
    console.log("\n再発防止策はすべて実装済み");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
