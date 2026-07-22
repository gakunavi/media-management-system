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
  url.searchParams.set("from", "threads");
  url.searchParams.set("utm_source", "threads");
  url.searchParams.set("utm_medium", "social");
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
    // ★投稿に紐づかない送り元。捨てずにサイト単位で残す。
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
async function recordSiteClick(source: string, dest: string): Promise<void> {
  // ★任意の文字列を指標名にしない。指標が無限に増えると鮮度チェックが壊れる
  if (!SAFE_SOURCE.test(source)) return;

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return;

  const metric = `site_link_clicks_${dest}`;
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

  // 送り元別の内訳も持つ（どのCTAが効いたか）
  const detail = `${metric}__${source}`;
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

  await ensureCoverage(metric, null, `サイトから ${dest} への送客`);
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
