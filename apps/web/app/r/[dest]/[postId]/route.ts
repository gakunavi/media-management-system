// Threads → 自社サイト/LINE の送客リンク（設計書 §3.2 / §16.2）
//
// ★なぜ要るか
//   Threads の4つの目的のうち「節税総研・LPへの送客」「公式LINEへの送客」は、
//   2026-07-22 時点で投稿583本すべてに article_link が空で、導線が存在しなかった。
//   導線を貼るにあたり、「どの投稿が何人送ったか」を投稿単位で残す。
//   これが無いと、生成側に返せる正解が views といいねしか無いままになる。
//
//   例: https://collect.asset-support.co.jp/r/line/THR-519
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

/** 遷移先の識別子 → 環境変数名。ここに無い dest は 404 */
const DESTINATIONS: Record<string, { env: string; label: string }> = {
  soken: { env: "MMS_LINK_DEST_SOKEN", label: "節税総研" },
  lp: { env: "MMS_LINK_DEST_LP", label: "LP" },
  line: { env: "MMS_LINK_DEST_LINE", label: "公式LINE" },
};

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

  const target = (process.env[def.env] ?? "").trim();
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
  if (!isBot) {
    try {
      await recordClick(postId, dest.toLowerCase());
    } catch {
      // 握りつぶす。ここで 500 を返すと送客そのものが止まる
    }
  }

  const url = new URL(target);
  // 遷移先でも出所が分かるようにする（GA等で見る用。個人情報は載せない）
  url.searchParams.set("utm_source", "threads");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", postId);

  return NextResponse.redirect(url.toString(), 302);
}

/** 投稿単位・日次でクリックを積む（ContentMetric に threads_link_clicks_<dest>） */
async function recordClick(postId: string, dest: string): Promise<void> {
  const item = await prisma.contentItem.findFirst({
    where: { externalId: postId, type: "post" },
    select: { id: true, channelId: true },
  });
  // ★存在しない投稿IDは記録しない。作ってしまうと投稿数の集計が狂う
  if (!item) return;

  const metric = `threads_link_clicks_${dest}`;
  const date = jstDate(new Date());

  await prisma.contentMetric.upsert({
    where: { contentItemId_metric_date: { contentItemId: item.id, metric, date } },
    update: { value: { increment: 1 } },
    create: { contentItemId: item.id, metric, value: 1, date },
  });

  // ★計測開始を1度だけ記録する（§3）。これが無いと 0 と未計測を区別できない
  const cov = await prisma.measurementCoverage.findFirst({ where: { metric } });
  if (!cov) {
    await prisma.measurementCoverage.create({
      data: {
        metric,
        channelId: item.channelId,
        startedAt: new Date(),
        method: "redirect_link",
        note: `Threads から ${dest} への送客リンク（/r/${dest}/<投稿ID>）の初回クリックにより計測開始`,
      },
    });
  }
}
