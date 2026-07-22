// WordPress フォーム送信の受口（設計書 §9.1 P2「CV配管」）
//
//   §3.10.3-⑤ WordPress 側では一切DB書込みをしない。受けるのは MMS の /api/ingest
//   §8        Webhook 受口は HMAC-SHA256 署名検証（共有シークレット）
//   §5.4      受信 → Lead 起票 → 石井さんへ即通知
//   §3 規約   計測を開始したら MeasurementCoverage に startedAt を記録する
//             （これが無いと「未計測」と「実測ゼロ」を区別できない）
//
// ★この経路が動き始めるまで、問い合わせ件数は「0」ではなく「—(未計測)」である。
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@mms/db";
import { verifySignature } from "@/lib/hmac";
import { rateLimit } from "@/lib/rate-limit";
import { encryptPii, isPiiKeyReady, maskContact } from "@/lib/crypto";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUSINESS_SLUG = process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency";
const RATE_LIMIT_PER_MINUTE = Number(process.env.MMS_INGEST_RATE_LIMIT ?? 30);

/** この受口が計測を担う指標。MeasurementCoverage に記録する（§3 規約） */
const COVERED_METRIC = "lead_direct_inquiry";

type FormPayload = {
  occurredAt?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
  interestProduct?: string[];
  /** CF7 の customer_type / customer-type。Lead.type に対応させる */
  customerType?: string;
  /** ?from=media&article=ART-XXX（§5.4 の経路自動判定） */
  from?: string;
  article?: string;
  sessionId?: string;
  pageUrl?: string;
  /** 送信側が採番するなら使う。無ければ内容から導出する */
  idempotencyKey?: string;
};

function clientKey(req: Request, body: FormPayload): string {
  return (
    body.sessionId ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * ★冪等キー。Lead に専用列を足さず、主キーそのものを内容から導出することで
 *   WP プラグインの再送（タイムアウト時のリトライ）で二重起票されないようにする。
 */
function deriveLeadId(businessId: string, body: FormPayload): string {
  const basis =
    body.idempotencyKey ??
    [body.email ?? "", body.phone ?? "", body.occurredAt ?? "", body.message ?? ""].join(
      "|",
    );
  const digest = createHash("sha256")
    .update(`${businessId}|form|${basis}`)
    .digest("hex")
    .slice(0, 32);
  return `lead_${digest}`;
}

function bad(status: number, reason: string) {
  return NextResponse.json({ ok: false, reason }, { status });
}

/**
 * 顧客区分 → Lead.type
 *
 * ★新しいフィールドは足さない。MMS には既に LeadType.agency があり、
 *   Threads DM 経由の代理店候補がこれで入っている。同じ意味の区分を
 *   2つ持つと、/agency の分母がどちらを見ているか分からなくなる。
 *
 * ★区分を間違えると実害が出る（cowork 指摘）:
 *     資産防衛をご検討の方 → 顧客。営業フローへ
 *     パートナー提携をご検討の方 → 代理店候補。百瀬さんへ
 *   混ざると両方の歩留まりの分母が壊れる。
 *
 * ★CF7 のラベル文言は変わりうるので、完全一致ではなく語で判定する。
 *   それでも判定できなければ通知する（黙って営業に流さない）。
 */
function toLeadType(raw: string | undefined): {
  type: "direct_inquiry" | "agency";
  unmapped: boolean;
} {
  const s = (raw ?? "").trim();
  if (!s) return { type: "direct_inquiry", unmapped: false };
  if (/パートナー|提携|代理店|会計士|税理士/.test(s)) {
    return { type: "agency", unmapped: false };
  }
  if (/資産防衛|経営者|投資家|顧客/.test(s)) {
    return { type: "direct_inquiry", unmapped: false };
  }
  return { type: "direct_inquiry", unmapped: true };
}

/**
 * ★署名検証を通過した後の拒否は「攻撃」ではなく「自分たちのバグ」である。
 *
 *   実際に起きうる事故:
 *     WP側のフォームが email のフィールド名を変えた
 *     → プラグインが値を拾えない → ここで 400
 *     → MMS の問い合わせ件数は 0 のまま増えない
 *     → 石井さんには「LPが効いていない」に見える
 *
 *   これは §3 が禁じている「壊れた計測が実測ゼロに化ける」状態そのもので、
 *   しかも起きる場所がゴール指標（問い合わせ数）の直上なので最も害が大きい。
 *   WPプラグインは debug.log にしか書かないので、MMS 側から鳴らすしかない。
 *
 * ★通知は理由ごとに1時間1通に絞る。壊れたフォームが鳴り続けると
 *   通知そのものが無視されるようになり、結局見落とす。
 */
async function reject(status: number, reason: string, hint: string) {
  if (rateLimit(`ingest:form:reject:${reason}`, 1, 3_600_000).allowed) {
    await notify({
      event: "ingest.rejected",
      title: "⚠️ WPフォームの受信を拒否しました（問い合わせが取りこぼされています）",
      body: [
        `理由: ${reason}`,
        `HTTP: ${status}`,
        "",
        hint,
        "",
        "★署名は正しいので送信元は自社のWordPressです。設定ミスの可能性が高い。",
        "★直すまでの間、この経路の問い合わせは MMS に入りません。",
      ].join("\n"),
      meta: { status, reason },
    });
  }
  return bad(status, reason);
}

/**
 * ★想定外の例外でも必ず鳴らす。
 *
 *   実際に起きた事故（2026-07-22）:
 *     Lead.sessionId の FK 違反で 500 になり、問い合わせが1件消えた。
 *     bad() を通らない例外だったので拒否通知も鳴らず、
 *     気づけたのは受口のログを直接見ていたからだった。
 *
 *   「拒否は鳴る」だけでは不十分で、「落ちても鳴る」必要がある。
 */
export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    return await reject(
      500,
      "受信処理で想定外のエラー",
      `${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}\n\n` +
        "★この問い合わせは MMS に入っていません。WP側の管理画面かメールから拾ってください。",
    );
  }
}

async function handle(req: Request) {
  // ── 1. 生ボディを取得（署名は生の文字列に対して検証する）──
  const rawBody = await req.text();

  // ── 2. HMAC-SHA256 署名検証（§8）──
  const verified = verifySignature(req.headers, rawBody);
  if (!verified.ok) return bad(verified.status, verified.reason);

  // ── 3. 個人情報を平文で保存しないための fail-closed（§16.2）──
  if (!isPiiKeyReady()) {
    return await reject(
      503,
      "MMS_PII_KEY が未設定です。個人情報を暗号化できないため受信を拒否しました",
      "MMS 側の環境変数が落ちています。この状態では問い合わせが1件も入りません。",
    );
  }

  let body: FormPayload;
  try {
    body = JSON.parse(rawBody) as FormPayload;
  } catch {
    return await reject(
      400,
      "JSON として解釈できません",
      "プラグインが送っているボディが JSON になっていません。",
    );
  }

  // ── 4. レート制限（§3.10.4 サーバー側の歯止め）──
  const limited = rateLimit(`ingest:form:${clientKey(req, body)}`, RATE_LIMIT_PER_MINUTE);
  if (!limited.allowed) {
    return NextResponse.json(
      { ok: false, reason: "レート制限を超過しました" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  if (!body.email && !body.phone) {
    return await reject(
      400,
      "email か phone のどちらかは必須です",
      "WP側のフォームで email/tel のフィールド名が変わった可能性があります。" +
        "プラグイン（mms-connector）の候補リストにそのフィールド名を足してください。",
    );
  }

  // ── 5. 事業とチャネルを解決 ──
  const business = await prisma.business.findUnique({ where: { slug: BUSINESS_SLUG } });
  if (!business) {
    return await reject(
      500,
      `Business(slug=${BUSINESS_SLUG}) がありません`,
      "npm run db:seed を実行してください。この状態では問い合わせが1件も入りません。",
    );
  }

  // ── 6. 経路の自動判定（§5.4）──
  //   ?article=ART-XXX から first touch を引く。無ければ null（＝経路不明として残す）
  const firstTouch = body.article
    ? await prisma.contentItem.findFirst({
        where: { externalId: body.article },
        select: { id: true },
      })
    : null;

  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return await reject(
      400,
      "occurredAt が不正です",
      "プラグインが送っている日時の形式を確認してください（ISO8601）。",
    );
  }

  // ── 7. Lead 起票（冪等）──
  const leadId = deriveLeadId(business.id, body);
  const existing = await prisma.lead.findUnique({ where: { id: leadId } });

  if (existing) {
    // 再送。二重に通知しない
    return NextResponse.json({ ok: true, leadId, duplicate: true });
  }

  const leadType = toLeadType(body.customerType);

  // ★存在しないセッションは null 化する（/api/ingest/events と同じ方針）。
  //
  //   Lead.sessionId は VisitorSession への外部キー。WPのフォームは
  //   hidden の mms-sid をそのまま送ってくるが、そのセッションが MMS に
  //   まだ無いことがある（計測タグがイベントを1件も送る前に
  //   フォームを送信した場合など）。
  //   検証せずに渡すと FK 違反で 500 になり、**問い合わせが丸ごと消える**。
  //   セッションの紐づけは「あると嬉しい」情報であって、
  //   問い合わせ本体を落としてまで守るものではない。
  const sessionId =
    body.sessionId &&
    (await prisma.visitorSession.findUnique({
      where: { id: body.sessionId },
      select: { id: true },
    }))
      ? body.sessionId
      : null;

  const lead = await prisma.lead.create({
    data: {
      id: leadId,
      businessId: business.id,
      type: leadType.type,
      sourceType: "form",
      occurredAt,
      // ★個人情報は必ず暗号化して保存する（§16.2）
      contactName: encryptPii(body.name),
      contactEmail: encryptPii(body.email),
      contactPhone: encryptPii(body.phone),
      companyName: encryptPii(body.company),
      note: encryptPii(body.message),
      interestProduct: body.interestProduct ?? [],
      firstTouchContentId: firstTouch?.id ?? null,
      lastTouchContentId: firstTouch?.id ?? null,
      sessionId,
    },
  });

  // ── 8. 計測期間の記録（★これが「未計測」と「0」を分ける・§3 規約）──
  const coverage = await prisma.measurementCoverage.findFirst({
    where: { metric: COVERED_METRIC },
  });
  if (!coverage) {
    await prisma.measurementCoverage.create({
      data: {
        metric: COVERED_METRIC,
        startedAt: new Date(),
        method: "wp_form_webhook",
        note: "P2: WPフォーム Webhook の初回受信時に自動作成",
      },
    });
  }

  // ── 9. 即時通知（§5.4・★個人情報はマスキングして渡す）──
  await notify({
    event: "lead.created",
    title:
      leadType.type === "agency"
        ? "🔵 代理店候補の問い合わせが入りました"
        : "🔴 直客の問い合わせが入りました",
    body: [
      `受信: ${occurredAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
      // ★区分は行き先（営業 / 百瀬さん）を決めるので必ず出す。
      //   判定できなかった場合は直客扱いで起票しているが、
      //   代理店候補を営業に流すと歩留まりの分母が壊れるので明示する。
      leadType.unmapped
        ? `区分: ★判定できず（直客として起票）「${body.customerType}」`
        : `区分: ${leadType.type === "agency" ? "代理店候補" : "直客"}`,
      `会社: ${body.company ? maskContact(body.company) : "—"}`,
      `連絡先: ${maskContact(body.email ?? body.phone)}`,
      `興味商材: ${(body.interestProduct ?? []).join(" / ") || "—"}`,
      `流入記事: ${body.article ?? "—(経路未特定)"}`,
      "",
      "★初動速度でCVRが決まります（SLA 1時間）。",
    ].join("\n"),
    url: `${process.env.MMS_PUBLIC_URL ?? "http://localhost:3000"}/leads/${lead.id}`,
    meta: { leadId: lead.id, article: body.article ?? null, from: body.from ?? null },
  });

  return NextResponse.json({ ok: true, leadId: lead.id, duplicate: false }, { status: 201 });
}
