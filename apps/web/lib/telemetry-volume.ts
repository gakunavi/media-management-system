// 計測タグの発火回数を監視する（設計書 §3.10.4 / docs/RULES.md §1.1 / P2.11）
//
// ★なぜ要るか
//   過去の TTFB スパイク事故で本当に問題だったのは遅さそのものではなく、
//   **何千回発火しても誰も気づかなかったこと**。同じ設計にしない、というのが
//   §3.10.3 の出発点で、その「気づく」側がこれ。
//
// ★いま特に要る理由（2026-07-24）
//   §4-94 で計測タグを data 属性依存から外し、リンクとCTAを自動で拾うようにした。
//   拾う量が増える方向の変更なので、暴走の可能性も上がっている。
//
// ★見るのは合計ではなく「1セッションあたり」。
//   合計は訪問者が増えれば増える。異常かどうかは1人あたりで見ないと分からない。
import { prisma, type Prisma } from "@mms/db";

/** §1.1 の閾値。想定は 7〜15 件/セッション */
export const EVENTS_PER_SESSION_WARN = 30;
export const EVENTS_PER_SESSION_BAD = 50;
/** 重複比率がこれを超えたら実装バグの疑い（§1.1） */
export const DUPLICATE_RATIO_WARN = 0.2;
/** 前日比でこの倍率を超えたら緊急停止を提案する（§1.1） */
export const SPIKE_RATIO = 3;

/** JST の「日付」と「時」に落とす。★日付列は JST の1日（§9-4） */
function jstDateHour(d: Date): { date: Date; hour: number } {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hour = jst.getUTCHours();
  const date = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  return { date, hour };
}

/**
 * 受口から呼ぶ。★実測できるのはここだけの値（受信バイト数・重複で捨てた数）。
 * 集計ジョブでは復元できないので、受け取った瞬間に足す。
 *
 * ★失敗しても受信は成功させる。計測の計測が原因でイベントを落としたら本末転倒。
 */
export async function recordIngestVolume(input: {
  accepted: number;
  duplicated: number;
  bytes: number;
  at?: Date;
}): Promise<void> {
  const { date, hour } = jstDateHour(input.at ?? new Date());
  try {
    await prisma.telemetryVolume.upsert({
      where: { date_hour: { date, hour } },
      create: {
        date,
        hour,
        events: input.accepted,
        bytesReceived: input.bytes,
        rejectedDuplicates: input.duplicated,
      },
      update: {
        events: { increment: input.accepted },
        bytesReceived: { increment: input.bytes },
        rejectedDuplicates: { increment: input.duplicated },
      },
    });
  } catch {
    // ★握り潰す。ここで例外を上げると、監視のせいで計測が止まる
  }
}

/**
 * 1時間ぶんの sessions / eventsPerSession / anomaly を確定させる。
 * ★sessions は受口では正確に数えられない（同じセッションが何度も来る）ので、
 *   実データ（FunnelEvent の distinct sessionId）から後で確定させる。
 */
export async function aggregateTelemetryVolume(
  hoursBack = 25,
): Promise<{ updated: number; anomalies: number }> {
  const now = new Date();
  let updated = 0;
  let anomalies = 0;

  for (let i = 0; i < hoursBack; i++) {
    const at = new Date(now.getTime() - i * 60 * 60 * 1000);
    const { date, hour } = jstDateHour(at);

    // その1時間（JST）の範囲を UTC の境界に直す
    const startUtc = new Date(date.getTime() + (hour - 9) * 60 * 60 * 1000);
    const endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);

    const rows = await prisma.funnelEvent.findMany({
      where: { occurredAt: { gte: startUtc, lt: endUtc } },
      select: { sessionId: true },
    });
    const sessions = new Set(rows.map((r) => r.sessionId)).size;
    const events = rows.length;

    // ★1件も無い時間に行を作らない。作ると「0件の時間」が延々と並び、
    //   本当に止まったのか元々無いのかが読めなくなる
    const existing = await prisma.telemetryVolume.findUnique({
      where: { date_hour: { date, hour } },
      select: { id: true, rejectedDuplicates: true, events: true },
    });
    if (!existing && events === 0) continue;

    const eventsPerSession = sessions > 0 ? events / sessions : 0;
    const dup = existing?.rejectedDuplicates ?? 0;
    const received = events + dup;
    const anomaly =
      eventsPerSession > EVENTS_PER_SESSION_WARN ||
      (received > 0 && dup / received > DUPLICATE_RATIO_WARN);

    if (anomaly) anomalies += 1;

    await prisma.telemetryVolume.upsert({
      where: { date_hour: { date, hour } },
      create: { date, hour, sessions, events, eventsPerSession, anomaly },
      // ★events はここで**実データの件数に揃える**。受口側の加算は
      //   再送や失敗でズレうるので、実データを正とする（§0-1 正確さ > 効率）
      update: { sessions, events, eventsPerSession, anomaly },
    });
    updated += 1;
  }

  return { updated, anomalies };
}

export type TelemetryHealth = {
  /** 直近24時間 */
  events24h: number;
  sessions24h: number;
  eventsPerSession: number | null;
  duplicateRatio: number | null;
  bytes24h: number;
  alert: "ok" | "warn" | "red";
  reason: string;
  /** 前日比（直近24h ÷ その前の24h）。null = 前日の記録が無い */
  dayOverDay: number | null;
  spiking: boolean;
  /** 計測を止めているか（止めた日時） */
  disabledAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function sumWindow(since: Date, until: Date) {
  // ★date+hour は JST。UTC の窓と厳密には合わないが、24時間の合計を見るには十分。
  //   1時間の誤差で判定が変わるような閾値の使い方をしない（3倍・30件/セッション）
  const rows = await prisma.telemetryVolume.findMany({
    where: { date: { gte: new Date(since.getTime() - DAY_MS), lte: until } },
    select: { date: true, hour: true, events: true, sessions: true, rejectedDuplicates: true, bytesReceived: true },
  });
  let events = 0;
  let sessions = 0;
  let dup = 0;
  let bytes = 0;
  for (const r of rows) {
    const at = new Date(r.date.getTime() + (r.hour - 9) * 60 * 60 * 1000);
    if (at < since || at >= until) continue;
    events += r.events;
    sessions += r.sessions;
    dup += r.rejectedDuplicates;
    bytes += r.bytesReceived;
  }
  return { events, sessions, dup, bytes };
}

export async function getTelemetryHealth(): Promise<TelemetryHealth> {
  const now = new Date();
  const [cur, prev, disabledAt] = await Promise.all([
    sumWindow(new Date(now.getTime() - DAY_MS), now),
    sumWindow(new Date(now.getTime() - 2 * DAY_MS), new Date(now.getTime() - DAY_MS)),
    getTrackingDisabledAt(),
  ]);

  const eventsPerSession = cur.sessions > 0 ? cur.events / cur.sessions : null;
  const received = cur.events + cur.dup;
  const duplicateRatio = received > 0 ? cur.dup / received : null;
  // ★前日が0件のときに「∞倍」を出さない。増えたことは分かるが倍率に意味が無い
  const dayOverDay = prev.events > 0 ? cur.events / prev.events : null;
  const spiking = dayOverDay !== null && dayOverDay >= SPIKE_RATIO;

  let alert: TelemetryHealth["alert"] = "ok";
  const reasons: string[] = [];

  if (disabledAt) {
    // ★止めていることは異常ではないが、止めっぱなしを見逃さないよう必ず出す
    return {
      events24h: cur.events,
      sessions24h: cur.sessions,
      eventsPerSession,
      duplicateRatio,
      bytes24h: cur.bytes,
      alert: "warn",
      reason: `計測を停止中（${disabledAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}〜）。再開するまで記事の行動は記録されません`,
      dayOverDay,
      spiking,
      disabledAt,
    };
  }

  if (eventsPerSession === null) {
    // ★0 件を「異常なし」と書かない。記録が無いのか誰も来ていないのかは別（§2-1）
    return {
      events24h: 0,
      sessions24h: 0,
      eventsPerSession: null,
      duplicateRatio: null,
      bytes24h: 0,
      alert: "ok",
      reason: "直近24時間の記録がありません（訪問が無いか、計測が届いていない）",
      dayOverDay,
      spiking: false,
      disabledAt: null,
    };
  }

  if (eventsPerSession > EVENTS_PER_SESSION_BAD) {
    alert = "red";
    reasons.push(`1人あたり ${eventsPerSession.toFixed(1)}件（赤: ${EVENTS_PER_SESSION_BAD}件超・想定は7〜15件）`);
  } else if (eventsPerSession > EVENTS_PER_SESSION_WARN) {
    alert = "warn";
    reasons.push(`1人あたり ${eventsPerSession.toFixed(1)}件（黄: ${EVENTS_PER_SESSION_WARN}件超・想定は7〜15件）`);
  }
  if (spiking) {
    alert = "red";
    reasons.push(`前日比 ${dayOverDay!.toFixed(1)}倍`);
  }
  if (duplicateRatio !== null && duplicateRatio > DUPLICATE_RATIO_WARN) {
    if (alert === "ok") alert = "warn";
    reasons.push(`重複 ${(duplicateRatio * 100).toFixed(0)}%（実装バグの疑い）`);
  }

  return {
    events24h: cur.events,
    sessions24h: cur.sessions,
    eventsPerSession,
    duplicateRatio,
    bytes24h: cur.bytes,
    alert,
    reason:
      reasons.length > 0
        ? reasons.join(" / ")
        : `1人あたり ${eventsPerSession.toFixed(1)}件（想定の範囲）`,
    dayOverDay,
    spiking,
    disabledAt: null,
  };
}

// ── 緊急停止のスイッチ ────────────────────────────────────────────────
//
// ★どこに持つか: 計測タグが載っているのはメディアサイトなので
//   `Channel(type=media)` の config に置く。設定用のモデルを新設しない（§18）。
//
// ★何が止まるか: **受口が受信を止める**。タグ自体は WordPress 側にあるので
//   ブラウザからの送信は続くが、こちらは一切保存も処理もしない。
//   媒体側の作業を待たずに、DBとサーバへの負荷を即座に止められる。
//   ★タグそのものを剥がすのは別作業（画面に明記する）。

type MediaConfig = { trackingDisabledAt?: string; trackingDisabledReason?: string };

async function mediaChannel() {
  return prisma.channel.findFirst({ where: { type: "media" }, select: { id: true, config: true } });
}

export async function getTrackingDisabledAt(): Promise<Date | null> {
  const ch = await mediaChannel();
  const cfg = (ch?.config ?? {}) as MediaConfig;
  if (!cfg.trackingDisabledAt) return null;
  const d = new Date(cfg.trackingDisabledAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function setTrackingDisabled(disabled: boolean, reason?: string): Promise<void> {
  const ch = await mediaChannel();
  if (!ch) return;
  const cfg = { ...((ch.config ?? {}) as MediaConfig) };
  if (disabled) {
    cfg.trackingDisabledAt = new Date().toISOString();
    if (reason) cfg.trackingDisabledReason = reason;
  } else {
    delete cfg.trackingDisabledAt;
    delete cfg.trackingDisabledReason;
  }
  await prisma.channel.update({
    where: { id: ch.id },
    data: { config: cfg as Prisma.InputJsonValue },
  });
}

/**
 * 前日比3倍を検知したら「ワンクリック停止」を段5に起票する（§1.1）。
 * ★自動では止めない。止めると記事の行動が測れなくなるので、押すのは人（§15）。
 */
export async function proposeStopIfSpiking(): Promise<{ proposed: boolean; reason: string }> {
  const health = await getTelemetryHealth();
  if (health.disabledAt) return { proposed: false, reason: "すでに停止中" };
  if (!health.spiking && health.alert !== "red") {
    return { proposed: false, reason: `異常なし（${health.reason}）` };
  }

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return { proposed: false, reason: "事業が見つかりません" };

  // ★同じ提案を毎時間積み上げない。未処理のものがあれば作らない
  const existing = await prisma.action.findFirst({
    where: { type: "stop_tracking_tag", state: { in: ["proposed", "awaiting_approval"] } },
    select: { id: true },
  });
  if (existing) return { proposed: false, reason: "すでに停止の提案が出ています" };

  await prisma.action.create({
    data: {
      businessId: business.id,
      type: "stop_tracking_tag",
      title: "計測タグの受信を止める（発火が急増しています）",
      rationale: [
        `直近24時間: ${health.events24h}件 / ${health.sessions24h}セッション`,
        `1人あたり ${health.eventsPerSession?.toFixed(1) ?? "—"}件（想定は7〜15件）`,
        health.dayOverDay !== null ? `前日比 ${health.dayOverDay.toFixed(1)}倍` : "前日の記録が無く倍率は出せません",
        "",
        "★過去に自前のPV計測が暴走してサイトが重くなる事故を起こしています。",
        "　そのとき問題だったのは遅さではなく、誰も気づかず止められなかったことでした。",
        "",
        "承認すると受口が受信を止めます（保存も処理もしません）。",
        "★タグ自体は WordPress 側に残るので、送信は続きます。剥がすのは別作業です。",
      ].join("\n"),
      // §5-1 impacts 必須。これは記事の指標ではなくサイトを守る操作
      impacts: ["サイト速度", "計測の健全性"],
      proposedBy: "telemetry-volume",
      state: "proposed",
      expiresAt: new Date(Date.now() + 14 * DAY_MS),
    },
  });

  return { proposed: true, reason: health.reason };
}
