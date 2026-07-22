// ファネル7段の計測受口（設計書 §14.2 / §3.10 / P2.5）
//
//   段2: 表示 → クリック → CTA表示 → CTAクリック → LP到達 → フォーム到達 → 送信
//
// ★HMAC は使わない。ブラウザの計測タグは共有シークレットを持てない（露出する）。
//   代わりに Origin allowlist ＋ セッション単位レート制限 ＋ 冪等キーで守る。
//   → docs/RULES.md §11.5 の I-1 は「Webhook 受口」向け。ブラウザ計測は別扱い。
//
// ★受信形式は計測タグの sendBeacon に合わせて text/plain（CORS プリフライトを
//   起こさないため）。本文は JSON 文字列。
import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@mms/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  isAllowedOrigin,
  isFunnelStep,
  isValidClientId,
  truncateToSecond,
  MAX_EVENTS_PER_REQUEST,
  type FunnelStep,
} from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MINUTE = Number(process.env.MMS_INGEST_RATE_LIMIT ?? 30);

type IncomingEvent = {
  step: string;
  occurredAt?: string;
  /** ART-088 等。ContentItem.externalId で解決する */
  contentExternalId?: string;
  /** Cta テーブルの主キー（cuid）。CTAレジストリを作るまでは通常空 */
  ctaId?: string;
  /** hero / mid / final ... の位置ラベル。ctaId とは別物（下の CTA_POSITIONS 参照） */
  ctaPosition?: string;
  lpId?: string;
  meta?: Record<string, unknown>;
};

/**
 * ★位置ラベルは ctaId とは別物である。
 *
 *   Cta は「記事ごとの1つのCTA」を表す行で、主キーは cuid、contentItemId と
 *   targetUrl が必須。つまり "hero" という id は原理的に存在しえない。
 *   計測タグが送ってくる "hero" は **位置**であって CTA の識別子ではない。
 *
 *   位置別の効き目（hero と final のどちらが押されているか）は
 *   Cta レジストリが無くても出せる。meta に位置を残せば済む。
 *   162記事 × 7位置 = 1134行を先に作る必要はない。
 *
 * ★schema.prisma の CtaPosition と同じ語彙にそろえている。
 *   知らない値は捨てる（ゴミが溜まると位置別集計が信用できなくなる）。
 */
const CTA_POSITIONS = new Set([
  "hero",
  "mid",
  "final",
  "sidebar",
  "header",
  "footer",
  "fixed",
]);

type Payload = {
  visitorId?: string;
  sessionId?: string;
  events?: IncomingEvent[];
  /** セッション初回にだけ送られる（landing 情報） */
  session?: {
    landingContentExternalId?: string;
    referrer?: string;
    utm?: Record<string, unknown>;
    fromParam?: string;
  };
};

function ok(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}
function bad(status: number, reason: string) {
  return NextResponse.json({ ok: false, reason }, { status });
}

export async function POST(req: Request) {
  // ── 1. オリジン検証（ブラウザ計測の第一の防御）──
  if (!isAllowedOrigin(req.headers.get("origin"))) {
    return bad(403, "許可されていないオリジンです");
  }

  // ── 2. 本文（text/plain を JSON として読む）──
  const raw = await req.text();
  let body: Payload;
  try {
    body = JSON.parse(raw) as Payload;
  } catch {
    return bad(400, "JSON として解釈できません");
  }

  const { visitorId, sessionId } = body;
  if (!isValidClientId(visitorId) || !isValidClientId(sessionId)) {
    return bad(400, "visitorId / sessionId の形式が不正です");
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0) return ok({ accepted: 0 });
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    // §3.10.3-⑦ 暴走の自己遮断。サーバー側でも上限を超える塊は拒否する
    return bad(413, `1リクエストのイベント数が上限（${MAX_EVENTS_PER_REQUEST}）を超えています`);
  }

  // ── 3. レート制限（§3.10.4「同一セッションから毎分N件超は429」）──
  const limited = rateLimit(`ingest:events:${sessionId}`, RATE_LIMIT_PER_MINUTE);
  if (!limited.allowed) {
    return NextResponse.json(
      { ok: false, reason: "レート制限を超過しました" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const now = new Date();

  // ── 4. landing 記事の解決 ──
  const landingExt = body.session?.landingContentExternalId;
  const landing = landingExt
    ? await prisma.contentItem.findFirst({
        where: { externalId: landingExt },
        select: { id: true },
      })
    : null;

  // ── 5. VisitorSession を確保（初回作成・以降は更新しない冪等 upsert）──
  await prisma.visitorSession.upsert({
    where: { id: sessionId },
    // ★2回目以降は landing/referrer を上書きしない（最初のタッチを保持する）
    update: { pageviews: { increment: 0 } },
    create: {
      id: sessionId,
      visitorId,
      firstSeenAt: now,
      landingContentId: landing?.id ?? null,
      referrer: body.session?.referrer ?? null,
      utm: (body.session?.utm as Prisma.InputJsonValue) ?? undefined,
      fromParam: body.session?.fromParam ?? null,
    },
  });

  // ── 6. 外部参照をまとめて解決（N+1 回避）──
  //   ★存在しない ID は null 化する。計測タグの属性ミス1つで
  //     バッチ全体が FK 違反で全滅するのを防ぐ（堅牢性 > 厳密性）。
  const extIds = [
    ...new Set(events.map((e) => e.contentExternalId).filter(Boolean) as string[]),
  ];
  const ctaIds = [...new Set(events.map((e) => e.ctaId).filter(Boolean) as string[])];
  const lpIds = [...new Set(events.map((e) => e.lpId).filter(Boolean) as string[])];

  const [items, ctas, lps] = await Promise.all([
    extIds.length
      ? prisma.contentItem.findMany({
          where: { externalId: { in: extIds } },
          select: { id: true, externalId: true },
        })
      : Promise.resolve([]),
    ctaIds.length
      ? prisma.cta.findMany({ where: { id: { in: ctaIds } }, select: { id: true } })
      : Promise.resolve([]),
    lpIds.length
      ? prisma.landingPage.findMany({ where: { id: { in: lpIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  const idByExt = new Map(items.map((i) => [i.externalId, i.id]));
  const knownCta = new Set(ctas.map((c) => c.id));
  const knownLp = new Set(lps.map((l) => l.id));

  // ── 7. FunnelEvent を投入（冪等キーで重複排除・§16.1-④）──
  //   一意制約 (sessionId, step, contentItemId, occurredAt) が NULLS NOT DISTINCT で
  //   効くので、同一秒の重複は DB 側で弾かれる。skipDuplicates でまとめて入れる。
  const rows: Prisma.FunnelEventCreateManyInput[] = [];
  let rejected = 0;
  for (const e of events) {
    if (!isFunnelStep(e.step)) {
      rejected += 1;
      continue;
    }
    const occurredAt = e.occurredAt ? new Date(e.occurredAt) : now;
    if (Number.isNaN(occurredAt.getTime())) {
      rejected += 1;
      continue;
    }
    // ★位置を meta に残す。
    //   計測タグは位置ラベルを ctaId フィールドに入れて送ってくる（現行のプラグイン）。
    //   ctaPosition で明示されていればそれを使い、無ければ
    //   「解決できなかった ctaId が位置ラベルなら位置とみなす」で拾う。
    //   こうしないと ctaId は null 化されて位置が消え、
    //   「どの位置のCTAが効いているか」が永久に出せなくなる。
    const position =
      e.ctaPosition && CTA_POSITIONS.has(e.ctaPosition)
        ? e.ctaPosition
        : e.ctaId && !knownCta.has(e.ctaId) && CTA_POSITIONS.has(e.ctaId)
          ? e.ctaId
          : null;

    const meta = position ? { ...(e.meta ?? {}), ctaPosition: position } : e.meta;

    rows.push({
      sessionId,
      step: e.step as FunnelStep,
      occurredAt: truncateToSecond(occurredAt),
      contentItemId: e.contentExternalId
        ? (idByExt.get(e.contentExternalId) ?? null)
        : null,
      // 存在しない ctaId / lpId は null にする（FK 違反でバッチを落とさない）
      ctaId: e.ctaId && knownCta.has(e.ctaId) ? e.ctaId : null,
      lpId: e.lpId && knownLp.has(e.lpId) ? e.lpId : null,
      meta: (meta as Prisma.InputJsonValue) ?? undefined,
    });
  }

  const created = rows.length
    ? await prisma.funnelEvent.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };

  // ── 8. submit があればセッションを converted に（段1の CV に直結）──
  if (rows.some((r) => r.step === "submit")) {
    await prisma.visitorSession.update({
      where: { id: sessionId },
      data: { converted: true },
    });
  }

  return ok({
    accepted: created.count,
    deduplicated: rows.length - created.count,
    rejected,
  });
}
