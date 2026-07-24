// ページ体験（Core Web Vitals）の取得（設計書 §3.6.4 / P3.4）
//
// ★`source` を crux / psi に分ける理由（2026-07-24 の失敗から）
//   PSI のモバイル値は**低速4G＋CPU4倍遅の模擬条件**であって、実際の体感ではない。
//   私はこれを「サイトが遅い」と報告して石井さんに訂正された（§4-106）。
//   実ブラウザでは読込完了1.39秒だった。
//
//   - `psi`  … ラボ値。**いつでも取れるが、体感ではない**。相対比較と劣化検知に使う
//   - `crux` … 実ユーザーの実測（Chrome UX Report）。**これが体感**。
//              ただし訪問数が少ないとGoogleが集計せず、**取れないことがある**
//              （2026-07-24 時点、このサイトは crux データ無し）
//
//   両方を同じ列に混ぜると、また同じ間違いをする。分けて持つ。
//
// ★全記事を毎回測らない。159記事 × 2デバイス = 318回で、1回30〜60秒かかる。
//   「最後に測った日が古い順」に少しずつ回して、全体を時間をかけて覆う。
import { prisma } from "@mms/db";
import { measure } from "@/lib/perf-gate";

/** 1回の実行で測る記事数（× mobile/desktop で PSI 呼び出し回数はこの2倍） */
const BATCH = Number(process.env.MMS_PAGE_EXPERIENCE_BATCH ?? 8);

type Device = "mobile" | "desktop";

/** JST の今日（日付列は JST の1日・§9-4） */
function jstToday(): Date {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

/**
 * 測る対象を選ぶ。★「最後に測った日が古い順」＝一度も測っていないものが先。
 *   クリック数の多い順にすると、少ない記事が永久に測られない。
 */
async function pickTargets(limit: number) {
  const articles = await prisma.contentItem.findMany({
    where: { type: "article", status: "publish", url: { not: null }, redirectsToId: null },
    select: {
      id: true,
      externalId: true,
      url: true,
      pageExperiences: {
        orderBy: { date: "desc" },
        take: 1,
        select: { date: true },
      },
    },
  });

  return articles
    .map((a) => ({
      id: a.id,
      externalId: a.externalId,
      url: a.url as string,
      lastMeasured: a.pageExperiences[0]?.date ?? null,
    }))
    .sort((x, y) => {
      // 未計測を先頭に、次に古い順
      if (x.lastMeasured === null && y.lastMeasured !== null) return -1;
      if (x.lastMeasured !== null && y.lastMeasured === null) return 1;
      if (x.lastMeasured === null && y.lastMeasured === null) return 0;
      return x.lastMeasured!.getTime() - y.lastMeasured!.getTime();
    })
    .slice(0, limit);
}

export type PageExperienceRunResult = {
  measured: number;
  failed: number;
  cruxAvailable: number;
  /** 測れなかった理由（先頭のみ）。★黙って0件にしない */
  firstError: string | null;
};

export async function collectPageExperience(limit = BATCH): Promise<PageExperienceRunResult> {
  const targets = await pickTargets(limit);
  const date = jstToday();
  let measured = 0;
  let failed = 0;
  let cruxAvailable = 0;
  let firstError: string | null = null;

  for (const t of targets) {
    for (const device of ["mobile", "desktop"] as Device[]) {
      const m = await measure(t.url, device);
      if (m.error) {
        failed += 1;
        firstError ??= m.error;
        continue;
      }

      // ── ラボ値（psi）──
      await prisma.pageExperience.upsert({
        where: {
          contentItemId_date_device_source: {
            contentItemId: t.id,
            date,
            device,
            source: "psi",
          },
        },
        create: {
          contentItemId: t.id,
          date,
          device,
          source: "psi",
          lcp: m.lcp,
          inp: m.inp,
          cls: m.cls,
          ttfb: m.ttfb,
          performanceScore: m.performanceScore,
        },
        update: {
          lcp: m.lcp,
          inp: m.inp,
          cls: m.cls,
          ttfb: m.ttfb,
          performanceScore: m.performanceScore,
        },
      });
      measured += 1;

      // ── 実ユーザー（crux）──
      // ★あるときだけ入れる。無いのに0を入れると「実測で0秒」に見える（§2-1）
      if (m.field) {
        cruxAvailable += 1;
        await prisma.pageExperience.upsert({
          where: {
            contentItemId_date_device_source: {
              contentItemId: t.id,
              date,
              device,
              source: "crux",
            },
          },
          create: {
            contentItemId: t.id,
            date,
            device,
            source: "crux",
            lcp: m.field.lcp,
            inp: m.field.inp,
            cls: m.field.cls,
            ttfb: m.field.ttfb,
          },
          update: {
            lcp: m.field.lcp,
            inp: m.field.inp,
            cls: m.field.cls,
            ttfb: m.field.ttfb,
          },
        });
      }
    }
  }

  // 計測開始を記録（§2-3）。これが無いと 0 と未計測が区別できない
  if (measured > 0) {
    for (const metric of ["page_experience_psi", ...(cruxAvailable > 0 ? ["page_experience_crux"] : [])]) {
      const cov = await prisma.measurementCoverage.findFirst({ where: { metric } });
      if (cov) continue;
      await prisma.measurementCoverage.create({
        data: {
          metric,
          startedAt: new Date(),
          method: metric.endsWith("crux") ? "crux" : "psi_lab",
          note:
            metric.endsWith("crux")
              ? "実ユーザーのページ体験（Chrome UX Report）。訪問数が少ないと取れない"
              : "PageSpeed Insights のラボ値。★低速4G相当の模擬条件で、体感ではない（§4-106）",
        },
      });
    }
  }

  return { measured, failed, cruxAvailable, firstError };
}

export type PageExperienceSummary = {
  /** 測れている記事数 / 対象記事数 */
  measuredArticles: number;
  totalArticles: number;
  /** 実ユーザー（CrUX）のデータがある記事数。0 なら「実際の体感は分からない」 */
  cruxArticles: number;
  lastMeasuredAt: Date | null;
  /** ラボ値の中央値（モバイル）。★体感ではないと明記して使う */
  medianLcpMobile: number | null;
  /** ラボ値が悪い順の上位。★「遅い記事」ではなく「重い記事」として出す */
  worst: { externalId: string; title: string; lcp: number | null; device: string }[];
};

export async function getPageExperienceSummary(): Promise<PageExperienceSummary> {
  const totalArticles = await prisma.contentItem.count({
    where: { type: "article", status: "publish", url: { not: null }, redirectsToId: null },
  });

  const rows = await prisma.pageExperience.findMany({
    where: { source: "psi", device: "mobile" },
    orderBy: { date: "desc" },
    select: {
      contentItemId: true,
      date: true,
      lcp: true,
      device: true,
      contentItem: { select: { externalId: true, title: true } },
    },
  });

  // 記事ごとに最新の1件だけ残す
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.contentItemId)) latest.set(r.contentItemId, r);
  const list = [...latest.values()];

  const lcps = list.map((r) => r.lcp).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const medianLcpMobile = lcps.length > 0 ? lcps[Math.floor(lcps.length / 2)] : null;

  const cruxArticles = await prisma.pageExperience
    .findMany({ where: { source: "crux" }, select: { contentItemId: true }, distinct: ["contentItemId"] })
    .then((r) => r.length);

  return {
    measuredArticles: list.length,
    totalArticles,
    cruxArticles,
    lastMeasuredAt: list.length > 0 ? list[0].date : null,
    medianLcpMobile,
    worst: list
      .filter((r) => r.lcp !== null)
      .sort((a, b) => (b.lcp ?? 0) - (a.lcp ?? 0))
      .slice(0, 5)
      .map((r) => ({
        externalId: r.contentItem.externalId,
        title: r.contentItem.title,
        lcp: r.lcp,
        device: r.device,
      })),
  };
}
