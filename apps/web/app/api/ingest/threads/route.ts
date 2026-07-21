// Threads 投稿実績の受口（設計書 §6「Threads GAS は継続。Insights を
// /api/ingest/threads へ POST するよう1関数追加するだけ」/ §13.4-④）
//
// ★MMS は Threads API を叩かない。トークンは GAS 側に置いたままでよい。
//   認証は他の Webhook と同じ HMAC-SHA256（§8 / docs/RULES.md §11.5）。
//
// 目的: 「投稿はしているが反応が測れていない」を解消する。
//   views/いいね等を蓄積すると、平均の1.5倍跳ねた投稿を記事化ネタとして
//   自動起票できる（§13.4-④ チャネル間でネタが循環する）。
import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@mms/db";
import { verifySignature } from "@/lib/hmac";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MINUTE = Number(process.env.MMS_INGEST_RATE_LIMIT ?? 30);
const MAX_POSTS = 500;
/** この受口が計測を担う指標（§3 規約: 記録が無ければ「未計測」） */
const COVERED_METRIC = "threads_post_metrics";

type IncomingPost = {
  /** シートの id 列（THR-001 など）。必須 */
  id: string;
  /** Threads 側の投稿ID */
  postId?: string;
  text?: string;
  target?: string;
  coreMessage?: string;
  scheduledAt?: string;
  postedAt?: string;
  status?: string;
  articleLink?: string;
  notes?: string;
  metrics?: Record<string, unknown>;
};

type Payload = {
  /** アカウント識別子。複数アカウント運用に備える（§11.3 投稿の分離ガード） */
  accountRef?: string;
  posts?: IncomingPost[];
};

const METRIC_KEYS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;

function bad(status: number, reason: string) {
  return NextResponse.json({ ok: false, reason }, { status });
}

function firstLine(s: string | undefined, max = 60): string {
  if (!s) return "";
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.trim().slice(0, max);
}

function toDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 日付だけに丸める（ContentMetric は日次） */
function dayOf(d: Date): Date {
  const j = new Date(d.getTime() + 9 * 3600_000); // JST基準の日付
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  // ── HMAC 署名検証（§8）──
  const verified = verifySignature(req.headers, rawBody);
  if (!verified.ok) return bad(verified.status, verified.reason);

  let body: Payload;
  try {
    body = JSON.parse(rawBody) as Payload;
  } catch {
    return bad(400, "JSON として解釈できません");
  }

  const posts = Array.isArray(body.posts) ? body.posts : [];
  if (posts.length === 0) return NextResponse.json({ ok: true, upserted: 0, metrics: 0 });
  if (posts.length > MAX_POSTS) {
    return bad(413, `1リクエストの件数が上限（${MAX_POSTS}）を超えています`);
  }

  const accountRef = (body.accountRef ?? "setsuzei_masa").trim();
  const limited = rateLimit(`ingest:threads:${accountRef}`, RATE_LIMIT_PER_MINUTE);
  if (!limited.allowed) {
    return NextResponse.json(
      { ok: false, reason: "レート制限を超過しました" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return bad(500, "Business がありません。npm run db:seed を実行してください");

  // ── Threads チャネルを確保（★accountRef 単位で分離・§11.3）──
  const channel = await prisma.channel.upsert({
    where: {
      businessId_type_accountRef: {
        businessId: business.id,
        type: "threads",
        accountRef,
      },
    },
    update: {},
    create: {
      businessId: business.id,
      type: "threads",
      accountRef,
      name: `Threads（${accountRef}）`,
      config: { source: "gas_sheet" } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  let upserted = 0;
  let metricRows = 0;
  let skipped = 0;

  for (const p of posts) {
    if (!p.id || typeof p.id !== "string") {
      skipped += 1;
      continue;
    }
    const postedAt = toDate(p.postedAt) ?? toDate(p.scheduledAt);

    const item = await prisma.contentItem.upsert({
      where: {
        channelId_externalId: { channelId: channel.id, externalId: p.id },
      },
      update: {
        title: firstLine(p.text) || p.notes || p.id,
        status: p.status ?? "unknown",
        publishedAt: postedAt,
        targetLabel: p.target ?? null,
        category: p.coreMessage ?? null,
        note: p.notes ?? null,
      },
      create: {
        channelId: channel.id,
        externalId: p.id,
        type: "post",
        articleType: "post",
        title: firstLine(p.text) || p.notes || p.id,
        status: p.status ?? "unknown",
        publishedAt: postedAt,
        targetLabel: p.target ?? null,
        category: p.coreMessage ?? null,
        note: p.notes ?? null,
        // Threads 投稿の URL は postId から一意に組めないため保持しない
        url: null,
      },
      select: { id: true },
    });
    upserted += 1;

    // ── 指標（views 等）を ContentMetric へ ──
    const m = p.metrics ?? {};
    if (postedAt) {
      const date = dayOf(postedAt);
      const rows: Prisma.ContentMetricCreateManyInput[] = [];
      for (const key of METRIC_KEYS) {
        const raw = m[key];
        const num = typeof raw === "number" ? raw : Number(raw);
        if (raw === undefined || raw === null || raw === "" || Number.isNaN(num)) continue;
        rows.push({
          contentItemId: item.id,
          metric: `threads_${key}`,
          value: num,
          date,
        });
      }
      for (const r of rows) {
        // 同日・同指標は最新値で上書き（インサイトは後から増える）
        await prisma.contentMetric.upsert({
          where: {
            contentItemId_metric_date: {
              contentItemId: r.contentItemId,
              metric: r.metric,
              date: r.date as Date,
            },
          },
          update: { value: r.value },
          create: r,
        });
        metricRows += 1;
      }
    }
  }

  // ── 計測開始の記録（§3 規約）──
  if (metricRows > 0) {
    const cov = await prisma.measurementCoverage.findFirst({
      where: { metric: COVERED_METRIC },
    });
    if (!cov) {
      await prisma.measurementCoverage.create({
        data: {
          metric: COVERED_METRIC,
          channelId: channel.id,
          startedAt: new Date(),
          method: "gas_sheet_webhook",
          note: "Threads GAS からの投稿実績連携により計測開始",
        },
      });
    }
  }

  return NextResponse.json({ ok: true, upserted, metrics: metricRows, skipped });
}
