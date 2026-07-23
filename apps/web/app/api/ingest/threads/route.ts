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

/** GAS の account シート1行分（§2454 SnsAccountHealth の元データ） */
type IncomingAccountDay = {
  /** "YYYY-MM-DD" */
  date: string;
  followers_count: number;
};

type Payload = {
  /** アカウント識別子。複数アカウント運用に備える（§11.3 投稿の分離ガード） */
  accountRef?: string;
  posts?: IncomingPost[];
  /** フォロワー数の日次履歴。viewsPerFollower の急落検知に使う */
  account?: IncomingAccountDay[];
  /**
   * 投稿キューの残り本数（GAS の pending 件数）。
   * ★未指定/null は「取れなかった」。0（本当に空）と混同しない（§3）。
   */
  queuePending?: number | null;
};

/**
 * 配信制限を疑う閾値（§2454 restrictionSuspected）。
 *
 * ★「投稿は普通にできているのに views だけ落ちる」を捕まえる。
 *   フォロワーが減ったせいで views が落ちたのは制限ではないので、
 *   viewsPerFollower（1フォロワーあたりの到達）で見る必要がある。
 */
const RESTRICTION_DROP_RATIO = 0.5;
/** 基準線を引くのに必要な日数。これ未満は「判定不能」であって「正常」ではない */
const RESTRICTION_MIN_HISTORY_DAYS = 7;

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
        // ★投稿に貼った送客リンク。空文字は null に寄せる。
        //   これが無いと「リンク有りの投稿とリンク無しの投稿でリーチが
        //   どれだけ違うか」を後から比べられない（貼る比率を勘で決めることになる）
        url: p.articleLink?.trim() || null,
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
        // ★Threads 投稿自身の URL は postId から一意に組めない。
        //   ここには「投稿に貼った送客リンク」を入れる（リンク有無の比較用）
        url: p.articleLink?.trim() || null,
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

  // ── アカウント指標（フォロワー数と viewsPerFollower）──
  const accountDays = Array.isArray(body.account) ? body.account : [];
  const healthRows = await upsertAccountHealth(channel.id, accountDays);

  // ── 投稿キューの残り本数（在庫切れを「切れる前」に警告するため）──
  // ★最新の健康度行にだけ載せる。フォロワー数が必須なので行を新規に作れない。
  //   届かなかった日は null のまま＝「不明」として残す（§3）。
  const queuePending =
    typeof body.queuePending === "number" && Number.isFinite(body.queuePending)
      ? Math.max(0, Math.trunc(body.queuePending))
      : null;
  if (queuePending !== null) {
    const latest = await prisma.snsAccountHealth.findFirst({
      where: { channelId: channel.id },
      orderBy: { date: "desc" },
      select: { id: true },
    });
    if (latest) {
      await prisma.snsAccountHealth.update({
        where: { id: latest.id },
        data: { queuePending },
      });
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
          method: "gas_sheet_api",
          note: "Threads GAS（Apps Script ウェブアプリ）から pull した投稿実績により計測開始",
        },
      });
    }
  }

  // ★同期前にクリックされた送客リンクを、投稿に付け替える
  const reclaimed = await reclaimPendingClicks(channel.id);

  return NextResponse.json({
    ok: true,
    upserted,
    metrics: metricRows,
    skipped,
    accountDays: healthRows,
    queuePending,
    reclaimedClicks: reclaimed,
  });
}

/**
 * 同期前にクリックされた送客リンクを、投稿に付け替える。
 *
 * ★なぜ要るか（2026-07-23 に実際に起きた）
 *   Threads 同期は日次（06:30）。その後に公開された投稿のリンクが踏まれると、
 *   リダイレクタは ContentItem を引けず `threads_link_clicks_pending_*` に退避する。
 *   放置すると **Threads のメディア送客が 0 のまま**になり、
 *   「リンクを貼ったのに誰も踏んでいない」という誤った像になる。
 *   実際 THR-034/035/042 の初クリック5件がこれに当たった。
 *
 * ★退避した行は移した後に 0 にする（削除はしない）。
 *   消すと「取りこぼしがあった事実」も消え、次に同じ穴が空いても気づけない。
 */
async function reclaimPendingClicks(channelId: string): Promise<number> {
  const pending = await prisma.metricSnapshot.findMany({
    where: { metric: { startsWith: "threads_link_clicks_pending_" }, value: { gt: 0 } },
    select: { id: true, metric: true, value: true, date: true },
  });
  if (pending.length === 0) return 0;

  let moved = 0;
  for (const row of pending) {
    // threads_link_clicks_pending_{dest}__{THR-xxx}
    const m = /^threads_link_clicks_pending_([a-z]+)__(THR-\d+)$/i.exec(row.metric);
    if (!m) continue;
    const [, dest, externalId] = m;

    const item = await prisma.contentItem.findFirst({
      where: { channelId, externalId, type: "post" },
      select: { id: true },
    });
    if (!item) continue; // まだ同期されていない。次回に持ち越す

    const metric = `threads_link_clicks_${dest.toLowerCase()}`;
    const existing = await prisma.contentMetric.findFirst({
      where: { contentItemId: item.id, metric, date: row.date },
      select: { id: true, value: true },
    });
    if (existing) {
      await prisma.contentMetric.update({
        where: { id: existing.id },
        data: { value: existing.value + row.value },
      });
    } else {
      await prisma.contentMetric.create({
        data: { contentItemId: item.id, metric, value: row.value, date: row.date },
      });
    }
    // ★計測開始を記録する（§3）。これが無いと画面が「未計測」のまま
    //   実測が入り、0件と区別できなくなる（実際そうなった）
    const covered = await prisma.measurementCoverage.findFirst({
      where: { metric },
      select: { id: true },
    });
    if (!covered) {
      await prisma.measurementCoverage.create({
        data: {
          metric,
          startedAt: row.date,
          method: "redirect_link",
          note: `Threads投稿から ${dest} への送客。同期前のクリックを付け替えて計測開始`,
        },
      });
    }

    // ★退避行は 0 にするだけ。削除すると取りこぼしの記録も消える
    await prisma.metricSnapshot.update({ where: { id: row.id }, data: { value: 0 } });
    moved += row.value;
  }
  return moved;
}

/**
 * フォロワー数の履歴から SnsAccountHealth を作る（§2454）。
 *
 * 求めるのは「その日に投稿した分がフォロワー数に対してどれだけ届いたか」。
 *   viewsPerFollower = その日の投稿の平均views / その日のフォロワー数
 *
 * ★フォロワーが横ばいなのに viewsPerFollower だけ落ちたら配信制限を疑う。
 *   views の生値で見ると「フォロワーが減った」のか「配信が絞られた」のか
 *   区別できず、書き直しても直らない問題に打ち手を打つことになる。
 */
async function upsertAccountHealth(
  channelId: string,
  days: IncomingAccountDay[],
): Promise<number> {
  if (days.length === 0) return 0;

  // 日付順に整える（差分と基準線の計算に順序が要る）
  const sorted = days
    .map((d) => ({ date: new Date(`${d.date}T00:00:00Z`), followers: Number(d.followers_count) }))
    .filter((d) => !Number.isNaN(d.date.getTime()) && Number.isFinite(d.followers) && d.followers > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (sorted.length === 0) return 0;

  // その日に公開された投稿の views 平均（★未計測の投稿は平均に入れない・§3）
  const since = sorted[0].date;
  const posts = await prisma.contentItem.findMany({
    where: { channelId, type: "post", publishedAt: { gte: since } },
    select: { id: true, publishedAt: true },
  });
  const viewsByItem = new Map<string, number>();
  if (posts.length > 0) {
    const metrics = await prisma.contentMetric.groupBy({
      by: ["contentItemId"],
      where: { metric: "threads_views", contentItemId: { in: posts.map((p) => p.id) } },
      _max: { value: true },
    });
    for (const m of metrics) viewsByItem.set(m.contentItemId, m._max.value ?? 0);
  }

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const postsByDay = new Map<string, { delivered: number; views: number[] }>();
  for (const p of posts) {
    if (!p.publishedAt) continue;
    const k = dayKey(p.publishedAt);
    const cur = postsByDay.get(k) ?? { delivered: 0, views: [] };
    cur.delivered += 1;
    const v = viewsByItem.get(p.id);
    if (v !== undefined) cur.views.push(v); // 未計測は入れない
    postsByDay.set(k, cur);
  }

  const vpfHistory: number[] = [];
  let written = 0;

  for (let i = 0; i < sorted.length; i++) {
    const { date, followers } = sorted[i];
    const prev = i > 0 ? sorted[i - 1].followers : null;
    const stat = postsByDay.get(dayKey(date));
    const avgViews =
      stat && stat.views.length > 0
        ? stat.views.reduce((s, v) => s + v, 0) / stat.views.length
        : null;
    const vpf = avgViews !== null ? avgViews / followers : null;

    // ★基準線が無いうちは判定しない。false は「正常」ではなく「まだ判定できない」
    let suspected = false;
    if (vpf !== null && vpfHistory.length >= RESTRICTION_MIN_HISTORY_DAYS) {
      const base = [...vpfHistory].sort((a, b) => a - b)[Math.floor(vpfHistory.length / 2)];
      const followersStable = prev === null || followers >= prev * 0.98;
      suspected = base > 0 && vpf < base * RESTRICTION_DROP_RATIO && followersStable;
    }
    if (vpf !== null) vpfHistory.push(vpf);

    await prisma.snsAccountHealth.upsert({
      where: { channelId_date: { channelId, date } },
      update: {
        followers,
        followersDelta: prev === null ? 0 : followers - prev,
        postsDelivered: stat?.delivered ?? 0,
        avgViews,
        viewsPerFollower: vpf,
        restrictionSuspected: suspected,
      },
      create: {
        channelId,
        date,
        followers,
        followersDelta: prev === null ? 0 : followers - prev,
        postsDelivered: stat?.delivered ?? 0,
        avgViews,
        viewsPerFollower: vpf,
        restrictionSuspected: suspected,
      },
    });
    written += 1;
  }
  return written;
}
