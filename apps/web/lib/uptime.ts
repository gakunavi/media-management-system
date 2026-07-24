// 死活監視（設計書 §3.9.3 / P3.9）
//
// ★なぜ「フォーム送信エンドポイント」まで見るか
//   トップページが 200 でも、問い合わせを受ける口が落ちていれば
//   **獲得はゼロになる**。しかも問い合わせが来ないだけなので、
//   誰も気づかないまま何日も過ぎる。段1の受け皿そのものを直接叩く。
//
// ★軽量 HEAD で叩く（docs/RULES.md §1.2）。
//   5分間隔で自社サイトを叩くので、本文まで取ると自分で負荷をかけることになる。
//   過去にサイト重量化事故を起こしているので、監視が原因になってはいけない。
//
// ★「連続3回失敗で即通知」（§3.9.3）。
//   1回の失敗で鳴らすと、瞬断のたびに通知が飛んで無視されるようになる。
//   3回＝15分落ちていれば本物。逆に鳴らし続けもしない（復旧まで1通）。
import { prisma } from "@mms/db";
import { notify } from "@/lib/notify";

/** 連続何回failで通知するか（§3.9.3） */
const FAIL_STREAK_TO_ALERT = 3;
/** HEAD のタイムアウト。これを超えたら落ちている扱い */
const TIMEOUT_MS = 10_000;

export type UptimeTarget = {
  /** UptimeCheck.target に入る安定キー。★URLが変わっても履歴が切れないようにキーで持つ */
  key: string;
  label: string;
  url: string;
  /**
   * 成功とみなす判定。
   * ★受口によって「正常な応答」が違う。フォームの受口は GET/HEAD を受け付けないので
   *   405 が正常。200 だけを正常にすると、生きているのに落ちている扱いになる。
   */
  ok: (status: number) => boolean;
};

const okIs2xx = (s: number) => s >= 200 && s < 300;

/**
 * 監視対象を組み立てる。
 * ★URLをコードに直書きしない。台帳（LandingPage）と実データから引く（§4-26）。
 *   直書きするとLPが増えたときに監視から漏れ、漏れたことも分からない。
 */
export async function buildTargets(): Promise<UptimeTarget[]> {
  const site = (process.env.MMS_WP_BASE_URL ?? "https://asset-support.co.jp").replace(/\/+$/, "");
  const collect = (process.env.MMS_PUBLIC_COLLECT_URL ?? "https://collect.asset-support.co.jp").replace(/\/+$/, "");
  // ★代表記事は主力商材の記事に固定する（既定 ART-002 即時償却）。
  //   「クリック最多の記事」だと対象が月ごとに変わり、履歴が比較できなくなる。
  const flagshipExternalId = process.env.MMS_UPTIME_FLAGSHIP ?? "ART-002";

  const targets: UptimeTarget[] = [
    { key: "site_top", label: "サイトのトップ", url: `${site}/`, ok: okIs2xx },
  ];

  const flagship = await prisma.contentItem.findFirst({
    where: { externalId: flagshipExternalId, url: { not: null } },
    select: { url: true, title: true },
  });
  if (flagship?.url) {
    targets.push({
      key: "flagship_article",
      label: `代表記事（${flagship.title.slice(0, 18)}）`,
      url: flagship.url,
      ok: okIs2xx,
    });
  }

  // ★LPは台帳が正（§9-D24）。live のものを全部見る
  const lps = await prisma.landingPage.findMany({
    where: { status: "live" },
    select: { slug: true, name: true, url: true },
    orderBy: { slug: "asc" },
  });
  for (const lp of lps) {
    if (!lp.url) continue;
    targets.push({ key: `lp_${lp.slug}`, label: `LP: ${lp.name}`, url: lp.url, ok: okIs2xx });
  }

  // ★問い合わせの受口そのもの。ここが落ちると獲得が丸ごと止まる。
  //   POST 専用なので HEAD には 405 を返すのが正常（= ルートは生きている）。
  //   503 は「鍵が無くて受信拒否」なので**異常**として扱う（fail-closed の状態・§11-9）。
  targets.push({
    key: "ingest_form",
    label: "問い合わせの受口（フォーム）",
    url: `${collect}/api/ingest/form`,
    ok: (s) => s === 405 || s === 400 || s === 401 || okIs2xx(s),
  });

  return targets;
}

async function probe(t: UptimeTarget): Promise<{ statusCode: number | null; responseMs: number; ok: boolean }> {
  const started = Date.now();
  try {
    const res = await fetch(t.url, {
      method: "HEAD", // §1.2 軽量 HEAD
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "MMS-UptimeCheck/1.0" },
      cache: "no-store",
    });
    return { statusCode: res.status, responseMs: Date.now() - started, ok: t.ok(res.status) };
  } catch {
    // ★到達できない（DNS/TLS/タイムアウト）。statusCode は null で残す。
    //   0 を入れると「0 というステータスが返った」と読めてしまう（§2-1 と同じ話）
    return { statusCode: null, responseMs: Date.now() - started, ok: false };
  }
}

/**
 * 通知するかどうかの判定。★純粋関数にして単体で検証できるようにする。
 *
 * ここを実地で検証しようとすると、石井さんに**偽の「サイトが落ちています」通知**を
 * 送ることになる。誤報は通知そのものの信用を落とすので、判定だけ切り出して試す。
 *
 * @param prevOks 直前の結果（新しい順・最大 FAIL_STREAK_TO_ALERT 件）
 * @param nowOk   今回の結果
 */
export function decideAlert(
  prevOks: boolean[],
  nowOk: boolean,
): { kind: "alert" | "recovered" | "none"; streak: number } {
  let prevFails = 0;
  for (const ok of prevOks) {
    if (ok) break;
    prevFails += 1;
  }

  if (!nowOk) {
    const streak = prevFails + 1;
    // ★ちょうど3回目でだけ鳴らす。4回目以降は復旧まで黙る
    //   （5分ごとに鳴らし続けると、通知そのものが無視されるようになる）
    return { kind: streak === FAIL_STREAK_TO_ALERT ? "alert" : "none", streak };
  }
  // ★鳴らした障害だけ復旧を知らせる。鳴らしていない瞬断の復旧まで送らない
  return { kind: prevFails >= FAIL_STREAK_TO_ALERT ? "recovered" : "none", streak: 0 };
}

export type UptimeRunResult = {
  checked: number;
  down: { key: string; label: string; url: string; statusCode: number | null; streak: number }[];
  recovered: { key: string; label: string }[];
  notified: boolean;
};

export async function runUptimeChecks(): Promise<UptimeRunResult> {
  const targets = await buildTargets();
  const now = new Date();

  // ★直前の状態を先に読む。書いた後だと「今回の失敗」を含んでしまい、
  //   連続回数の数え方がズレる
  const prevByKey = new Map<string, { ok: boolean }[]>();
  await Promise.all(
    targets.map(async (t) => {
      const rows = await prisma.uptimeCheck.findMany({
        where: { target: t.key },
        orderBy: { checkedAt: "desc" },
        take: FAIL_STREAK_TO_ALERT,
        select: { ok: true },
      });
      prevByKey.set(t.key, rows);
    }),
  );

  const results = await Promise.all(
    targets.map(async (t) => ({ t, r: await probe(t) })),
  );

  await prisma.uptimeCheck.createMany({
    data: results.map(({ t, r }) => ({
      target: t.key,
      checkedAt: now,
      statusCode: r.statusCode,
      responseMs: r.responseMs,
      ok: r.ok,
    })),
  });

  const down: UptimeRunResult["down"] = [];
  const recovered: UptimeRunResult["recovered"] = [];

  for (const { t, r } of results) {
    const prev = prevByKey.get(t.key) ?? [];
    const d = decideAlert(prev.map((p) => p.ok), r.ok);
    if (d.kind === "alert") {
      down.push({ key: t.key, label: t.label, url: t.url, statusCode: r.statusCode, streak: d.streak });
    } else if (d.kind === "recovered") {
      // ★復旧も知らせる。落ちたことだけ伝えると、直ったかどうかを人が確かめに行くことになる
      recovered.push({ key: t.key, label: t.label });
    }
  }

  let notified = false;
  if (down.length > 0 || recovered.length > 0) {
    const lines: string[] = [];
    for (const d of down) {
      lines.push(
        `・落ちています: ${d.label}`,
        `　　${d.url}`,
        `　　応答: ${d.statusCode === null ? "つながらない（タイムアウト等）" : d.statusCode} ／ ${d.streak * 5}分連続`,
      );
    }
    for (const rc of recovered) lines.push(`・復旧しました: ${rc.label}`);

    await notify({
      event: "uptime.alert",
      title:
        down.length > 0
          ? `🚨 サイトが落ちています（${down.length}件）`
          : `✅ 復旧しました（${recovered.length}件）`,
      body: lines.join("\n"),
      url: process.env.MMS_PUBLIC_URL ?? "http://localhost:3000",
    });
    notified = true;
  }

  return {
    checked: targets.length,
    down,
    recovered,
    notified,
  };
}

export type UptimeSummary = {
  key: string;
  label: string;
  ok: boolean | null;
  statusCode: number | null;
  responseMs: number | null;
  checkedAt: Date | null;
  /** 直近24時間の成功率。null = 記録が無い（未計測） */
  uptime24h: number | null;
  samples24h: number;
};

/** 段7に出す用。★異常の件数だけでなく「動いている数」も出せるようにする（§4-53） */
export async function getUptimeSummary(): Promise<UptimeSummary[]> {
  const targets = await buildTargets();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return Promise.all(
    targets.map(async (t) => {
      const [latest, total, okCount] = await Promise.all([
        prisma.uptimeCheck.findFirst({
          where: { target: t.key },
          orderBy: { checkedAt: "desc" },
          select: { ok: true, statusCode: true, responseMs: true, checkedAt: true },
        }),
        prisma.uptimeCheck.count({ where: { target: t.key, checkedAt: { gte: since } } }),
        prisma.uptimeCheck.count({ where: { target: t.key, checkedAt: { gte: since }, ok: true } }),
      ]);
      return {
        key: t.key,
        label: t.label,
        ok: latest?.ok ?? null,
        statusCode: latest?.statusCode ?? null,
        responseMs: latest?.responseMs ?? null,
        checkedAt: latest?.checkedAt ?? null,
        uptime24h: total > 0 ? (okCount / total) * 100 : null,
        samples24h: total,
      };
    }),
  );
}
