// Threads → 自社サイト/LINE の送客リンク（設計書 §3.2 / §16.2）
//
// ★なぜ要るか
//   Threads の4つの目的のうち「節税総研・LPへの送客」「公式LINEへの送客」は、
//   2026-07-22 時点で投稿583本すべてに article_link が空で、導線が存在しなかった。
//   導線を貼るにあたり、「どの投稿が何人送ったか」を投稿単位で残す。
//   これが無いと、生成側に返せる正解が views といいねしか無いままになる。
//
//   例: https://collect.asset-support.co.jp/r/line/THR-519   （Threads投稿）
//       https://collect.asset-support.co.jp/r/line/site-footer（サイトのフッタ）
//
// ★第2引数は「送り元」。投稿IDに一致すれば投稿単位で、
//   一致しなければサイト単位の指標として記録する。
//   2026-07-22 時点で公式LINEへの導線はサイト側（テーマの header/footer/CTA、
//   /media/ 9箇所・/contact/ 7箇所）が主で、Threads は0本。
//   投稿IDしか受けない作りだと、**いま動いている導線を測れない**。
//
// ★オープンリダイレクトにしない
//   遷移先は環境変数で固定した3つだけ。URL を引数で受け取る作りにすると、
//   自社ドメインを踏み台にした誘導に使われる。dest は識別子のみ。
//
// ★Access の対象外ホスト（collect.）で動く必要がある。
//   訪問者のブラウザから叩かれるため、認証をかけると全部止まる。

import { NextResponse } from "next/server";
import { prisma } from "@mms/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 遷移先の識別子 → 環境変数名。ここに無い dest は 404。
 *
 * ★環境変数はカンマ区切りで複数URLを持てる。診断LPは
 *   setsuzei-diagnosis-a / -b / -c の3本立てで既にABCテスト中のため、
 *   1本に固定するとその振り分けを壊す。
 */
const DESTINATIONS: Record<string, { env: string; label: string }> = {
  soken: { env: "MMS_LINK_DEST_SOKEN", label: "節税総研" },
  lp: { env: "MMS_LINK_DEST_LP", label: "診断LP" },
  line: { env: "MMS_LINK_DEST_LINE", label: "公式LINE" },
};

/**
 * URL から変種名を取る（.../setsuzei-diagnosis-b/ → "setsuzei-diagnosis-b"）。
 * ★どの変種に送ったかを記録しないと、Threads 経由のアーム別成績が出せない。
 */
function variantOf(u: URL): string {
  const seg = u.pathname.split("/").filter(Boolean);
  return seg[seg.length - 1] ?? "root";
}

/**
 * クローラを数えない。
 * ★Threads は投稿のプレビュー生成でリンクを踏む。これを送客に数えると
 *   「投稿しただけでクリック1」になり、実績が水増しされる。
 */
const BOT_UA =
  /bot|crawler|spider|facebookexternalhit|meta-externalagent|slackbot|twitterbot|discordbot|preview|curl|wget|python-requests|headless/i;

function jstDate(now: Date): Date {
  const d = new Date(now.getTime() + 9 * 3600 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ dest: string; postId: string }> },
) {
  const { dest, postId } = await params;
  const def = DESTINATIONS[dest.toLowerCase()];
  if (!def) {
    return NextResponse.json({ ok: false, reason: `未知の遷移先: ${dest}` }, { status: 404 });
  }

  const candidates = (process.env[def.env] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const target = candidates.length
    ? // ★一様ランダム。既存の記事側JS（localStorage固定）と同じ配分にする。
      //   ここで Cookie 固定はしない。記事側は localStorage、こちらは Cookie と
      //   別々に固定すると、同じ人が記事経由と Threads 経由で違う変種を見て
      //   両方のアームを汚す。滞留させず毎回引く方が混入が読める。
      candidates[Math.floor(Math.random() * candidates.length)]
    : "";
  if (!target) {
    // ★遷移先が未設定のまま踏まれたら、黙って落とさず理由を返す。
    //   投稿にリンクを貼った後に気づけないと、送客が丸ごと消える
    return NextResponse.json(
      { ok: false, reason: `${def.label} の遷移先URL（${def.env}）が未設定です` },
      { status: 503 },
    );
  }

  const ua = req.headers.get("user-agent") ?? "";
  const isBot = BOT_UA.test(ua);

  // ★計測に失敗しても遷移は必ず通す。記録のために訪問者を止めない
  const url = new URL(target);
  const variant = candidates.length > 1 ? variantOf(url) : null;

  // ★送り元が投稿IDかどうかで UTM を変える。
  //   以前は一律 utm_source=threads を付けていたため、サイトのフッタから
  //   踏まれたクリックまで「Threads から来た」と記録され、
  //   GA4 側の流入元集計が汚れていた。
  const isPost = /^THR-\d+$/i.test(postId);
  const source = isPost ? "threads" : "site";
  const medium = isPost ? "social" : "owned";

  if (!isBot) {
    try {
      await recordClick(postId, dest.toLowerCase(), variant);
    } catch {
      // 握りつぶす。ここで 500 を返すと送客そのものが止まる
    }
  }

  // 遷移先でも出所が分かるようにする（GA等で見る用。個人情報は載せない）
  // ★from= は既存の lp-ab-weekly-report.py が pagePath（クエリ非含有）で
  //   集計しているため、そのままでは効かない。レポート側の対応が要る。
  url.searchParams.set("from", source);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", postId);

  return NextResponse.redirect(url.toString(), 302);
}

/** 送り元が投稿IDでないときの記録先（サイト単位）。英数字と - _ だけ通す */
const SAFE_SOURCE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * クリックを日次で積む。
 *   送り元が投稿ID     → ContentMetric（投稿単位）
 *   それ以外（site-*）  → MetricSnapshot（サイト単位）
 */
async function recordClick(
  postId: string,
  dest: string,
  variant: string | null,
): Promise<void> {
  const item = await prisma.contentItem.findFirst({
    where: { externalId: postId, type: "post" },
    select: { id: true, channelId: true },
  });

  if (!item) {
    // ★投稿IDの形をしているのに ContentItem が無い＝**まだ同期していない投稿**。
    //   Threads 同期は日次（06:30）なので、その後に公開された投稿は
    //   最大24時間このルートを通る。実際 2026-07-23 に THR-034/035/042 の
    //   初クリック5件がこれに当たった。
    //
    //   これを recordSiteClick に落とすと「サイト（HP・記事）からのクリック」に
    //   化け、**Threads のメディア送客が0のまま**になる。同期後に移す前提で
    //   別の指標名に退避する（api/ingest/threads が引き取る）。
    if (/^THR-\d+$/i.test(postId)) {
      await recordSiteClick(postId, dest, "threads_link_clicks_pending");
      return;
    }
    // ★投稿に紐づかない送り元（サイトのCTA等）。捨てずにサイト単位で残す。
    //   捨てると「サイトからは誰も来ていない」という誤った像になる
    await recordSiteClick(postId, dest);
    return;
  }

  const metric = `threads_link_clicks_${dest}`;
  const date = jstDate(new Date());

  // 遷移先ごとの合計
  await prisma.contentMetric.upsert({
    where: { contentItemId_metric_date: { contentItemId: item.id, metric, date } },
    update: { value: { increment: 1 } },
    create: { contentItemId: item.id, metric, value: 1, date },
  });

  // ★ABCの変種別も別指標で積む。合計だけだと
  //   「Threads から来た人にどの変種が効いたか」が出せない
  if (variant) {
    const vm = `${metric}__${variant}`;
    await prisma.contentMetric.upsert({
      where: { contentItemId_metric_date: { contentItemId: item.id, metric: vm, date } },
      update: { value: { increment: 1 } },
      create: { contentItemId: item.id, metric: vm, value: 1, date },
    });
  }

  await ensureCoverage(metric, item.channelId, `Threads から ${dest} への送客`);
}

/** サイト（記事のCTA・フッタ等）からの送客。MetricSnapshot に日次で積む */
async function recordSiteClick(
  source: string,
  dest: string,
  /** 指標の接頭辞。未同期の投稿を退避するときだけ差し替える */
  base = "site_link_clicks",
): Promise<void> {
  // ★任意の文字列を指標名にしない。指標が無限に増えると鮮度チェックが壊れる
  if (!SAFE_SOURCE.test(source)) return;

  // ── 送り元から記事IDを取り出す（U72）────────────────────────────────
  //
  // ★なぜ要るか: リダイレクタはサーバー側の実測なので**広告ブロックの影響を受けない**。
  //   一方いまは「どの設置場所か」しか持たず、「どの記事から送ったか」が出せない。
  //   計測タグ側（link_click）では記事別に出せるが、あちらは JS が動いた分だけで、
  //   両者の合計は一致しない（§4-21）。記事IDを URL に入れれば、
  //   **合計と内訳の両方をサーバー実測だけで**出せる。
  //
  // ★記事IDは指標名に混ぜない。混ぜると
  //   `site_link_clicks_line__media-article-bottom-ART-159` が記事数×設置場所ぶん
  //   増え、指標が無限に増える（鮮度チェックが壊れる）。
  //   記事別は ContentMetric（記事単位の入れ物）に置き、
  //   MetricSnapshot の内訳は**設置場所だけ**に保つ。
  // ★末尾の `-ART-\d+` を**全部**剥がす。記事IDは（いちばん末尾の）1つだけ使う。
  //   2026-07-24 の検証で、二重付与 `article-cta-ART-002-ART-002` を送ったとき
  //   1つしか剥がさず、設置場所が `article-cta-ART-002` として残った。
  //   テーマ側は二重付与しない設計だが、**残ると設置場所の内訳が記事数ぶん増える**
  //   （＝指標が無限に増えて鮮度チェックが壊れる）。ここで吸収する。
  // ★桁数は可変（ART-2 も ART-189 もある）。`\d+` で受ける。
  let placement = source;
  let articleExternalId: string | null = null;
  for (;;) {
    const m = /-?(ART-\d+)$/i.exec(placement);
    if (!m) break;
    // 最初に取れたもの＝いちばん末尾＝テーマが最後に付けたもの
    articleExternalId ??= m[1].toUpperCase();
    placement = placement.slice(0, m.index);
  }
  if (placement === "") placement = "unknown";

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return;

  const metric = `${base}_${dest}`;
  const date = jstDate(new Date());

  // ★MetricSnapshot は channelId NULL だと一意制約が効かない（§13 記録済）。
  //   加算のため、既存行を読んでから入れ直す
  const existing = await prisma.metricSnapshot.findFirst({
    where: { businessId: business.id, metric, date, channelId: null },
    select: { id: true, value: true },
  });
  if (existing) {
    await prisma.metricSnapshot.update({
      where: { id: existing.id },
      data: { value: existing.value + 1 },
    });
  } else {
    await prisma.metricSnapshot.create({
      data: { businessId: business.id, metric, value: 1, date, granularity: "daily" },
    });
  }

  // ── 記事別の送客（U72）──
  //   ★記事IDが付いていないリンクは今までどおり。設置場所だけが残る。
  //     付いているものだけ記事単位で積むので、移行途中でも壊れない。
  if (articleExternalId) {
    const article = await prisma.contentItem.findFirst({
      where: { externalId: articleExternalId },
      select: { id: true },
    });
    // ★存在しない記事IDは黙って捨てる（貼り間違いで送客そのものを落とさない）。
    //   サイト単位の合計には既に入っているので、数字は失われない
    if (article) {
      await prisma.contentMetric.upsert({
        where: { contentItemId_metric_date: { contentItemId: article.id, metric, date } },
        update: { value: { increment: 1 } },
        create: { contentItemId: article.id, metric, value: 1, date },
      });
    }
  }

  // 送り元別の内訳も持つ（どのCTAが効いたか）
  // ★記事IDを除いた設置場所だけを使う（指標の数を有限に保つ）
  const detail = `${metric}__${placement}`;
  const d2 = await prisma.metricSnapshot.findFirst({
    where: { businessId: business.id, metric: detail, date, channelId: null },
    select: { id: true, value: true },
  });
  if (d2) {
    await prisma.metricSnapshot.update({ where: { id: d2.id }, data: { value: d2.value + 1 } });
  } else {
    await prisma.metricSnapshot.create({
      data: { businessId: business.id, metric: detail, value: 1, date, granularity: "daily" },
    });
  }

  await ensureCoverage(
    metric,
    null,
    base === "site_link_clicks" ? `サイトから ${dest} への送客` : `未同期の投稿から ${dest} への送客（同期後に移す）`,
  );
}

/** 計測開始を1度だけ記録する（§3）。これが無いと 0 と未計測を区別できない */
async function ensureCoverage(
  metric: string,
  channelId: string | null,
  what: string,
): Promise<void> {
  const cov = await prisma.measurementCoverage.findFirst({ where: { metric } });
  if (cov) return;
  await prisma.measurementCoverage.create({
    data: {
      metric,
      channelId,
      startedAt: new Date(),
      method: "redirect_link",
      note: `${what}。初回クリックにより計測開始`,
    },
  });
}
