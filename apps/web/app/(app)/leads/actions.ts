"use server";

// リードの手動登録（設計書 §3.8.3 電話から登録 / §14.3）
//   ★個人情報は encryptPii で暗号化して保存（§16.2）。
//   ★経路特定率（§1.1 成功指標1）のため firstTouch を極力埋める。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@mms/db";
import { isOwner } from "@/lib/session";
import { encryptPii, isPiiKeyReady } from "@/lib/crypto";

const schema = z.object({
  type: z.enum(["direct_inquiry", "agency", "line_friend"]),
  // ★受け皿は7つある（2026-07-22 の整理）。フォームに無いと
  //   info メールや診断LPからの問い合わせを手入力できない
  sourceType: z.enum([
    "form",
    "lp_diagnosis",
    "lp_agency",
    "line",
    "threads_dm",
    "phone_manual",
    "email",
  ]),
  // ★きっかけ（送客元）。電話・メールでも聞けば埋まる。
  //   これが無いと「電話は測定不能」のまま施策の成果に繋がらない
  origin: z
    .enum([
      "media_article",
      "threads",
      "line",
      "lp_diagnosis",
      "lp_product",
      "hp",
      "referral",
      "unknown",
    ])
    .default("unknown"),
  occurredAt: z.string().min(1),
  companyName: z.string().trim().optional(),
  contactEmail: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  budgetTier: z.enum(["high", "mid", "low", "unknown"]).default("unknown"),
  // カンマ区切りを配列に
  interestProduct: z.string().optional(),
  competitorsConsidered: z.string().optional(),
  firstTouchExternalId: z.string().trim().optional(),
  status: z
    .enum(["new", "contacted", "qualified", "proposal", "won", "lost"])
    .default("new"),
  closedAmount: z.string().optional(),
  note: z.string().trim().optional(),
});

export type CreateLeadResult = { ok: true; id: string } | { ok: false; error: string };

function splitList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createLead(formData: FormData): Promise<CreateLeadResult> {
  // 認可: owner のみ手動登録できる（§8 Role）
  // ★auth() を直接使わない。localhost の自動ログインでは Cookie 名が違い、
  //   auth() が常に null を返して owner 限定の操作が全部落ちる（lib/session.ts）
  if (!(await isOwner())) {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }

  if (!isPiiKeyReady()) {
    return { ok: false, error: "MMS_PII_KEY が未設定のため個人情報を保存できません" };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const d = parsed.data;

  const occurredAt = new Date(d.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, error: "発生日が不正です" };
  }

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return { ok: false, error: "事業が見つかりません" };

  // 流入記事（externalId → ContentItem）を解決して経路を埋める
  const firstTouch = d.firstTouchExternalId
    ? await prisma.contentItem.findFirst({
        where: { externalId: d.firstTouchExternalId },
        select: { id: true },
      })
    : null;

  const closedAmount =
    d.status === "won" && d.closedAmount ? d.closedAmount.replace(/[^\d.]/g, "") : null;

  const lead = await prisma.lead.create({
    data: {
      businessId: business.id,
      type: d.type,
      sourceType: d.sourceType,
      // ★記事IDが入っていれば、きっかけは記事と分かる（申告より実データを優先）
      origin: firstTouch ? "media_article" : d.origin,
      status: d.status,
      occurredAt,
      budgetTier: d.budgetTier,
      interestProduct: splitList(d.interestProduct),
      competitorsConsidered: splitList(d.competitorsConsidered),
      firstTouchContentId: firstTouch?.id ?? null,
      lastTouchContentId: firstTouch?.id ?? null,
      // ★個人情報は暗号化
      companyName: encryptPii(d.companyName),
      contactEmail: encryptPii(d.contactEmail),
      contactPhone: encryptPii(d.contactPhone),
      note: encryptPii(d.note),
      closedAmount: closedAmount ? closedAmount : null,
      closedAt: d.status === "won" ? occurredAt : null,
    },
  });

  // ★計測開始を記録（§3 規約）。手動でも「直客を計測している」状態にする。
  //   これが無いと段1が —(未計測) のままになる。
  // ★計測開始は「受け皿」単位で記録する。種別（見込み客/代理店見込み）ではない。
  //   /leads の受け皿一覧・ダッシュボード段1 がこの指標を見ている
  const coverageMetric =
    d.sourceType === "line"
      ? "lead_line"
      : d.sourceType === "threads_dm"
        ? "lead_threads_dm"
        : d.sourceType === "lp_diagnosis"
          ? "lp_form_submit_b"
          : d.sourceType === "lp_agency"
            ? "agency_lp_inquiries"
            : "lead_direct_inquiry";
  const existing = await prisma.measurementCoverage.findFirst({
    where: { metric: coverageMetric },
  });
  if (!existing) {
    await prisma.measurementCoverage.create({
      data: {
        metric: coverageMetric,
        startedAt: occurredAt,
        method: d.sourceType === "phone_manual" ? "manual" : "mms_lead",
        note: "P2.6: リード手動登録により計測開始",
      },
    });
  }

  revalidatePath("/leads");
  revalidatePath("/");
  return { ok: true, id: lead.id };
}
