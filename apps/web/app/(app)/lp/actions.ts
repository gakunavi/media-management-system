"use server";

// LP台帳の登録・更新（設計書 §3.8.6）
//
// ★LPは手入力で登録する。WordPress から自動検出はできない
//   （そのページがLPかどうかを機械が判別できない）。
//   代わりに、登録した瞬間から他のLPと同じ読み方で数字が出るようにする。
//
// ★計測の接頭辞（metricPrefix）を持たせる理由
//   LPごとに GA4 のイベント名が違う。台帳に書いておかないと、
//   LPを足すたびに画面のコードを直すことになる（それが旧実装の破綻理由）。
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@mms/db";
import { isOwner } from "@/lib/session";

const schema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "slug は必須です")
    // ★URLの一部になるので英数字とハイフンだけ
    .regex(/^[a-z0-9-]+$/, "slug は英小文字・数字・ハイフンのみ"),
  name: z.string().trim().min(1, "名前は必須です"),
  url: z.string().trim().url("URLの形式が不正です"),
  lpType: z.enum(["consultation", "product", "comparison_hub", "agency"]),
  offer: z.string().trim().min(1, "オファーは必須です"),
  status: z.enum(["draft", "live", "paused", "retired"]),
  /** "a,b,c" 形式。空ならA/Bしていない */
  variantKeys: z.string().trim().optional(),
  metricPrefix: z.string().trim().optional(),
  hasAgencyCodes: z.string().optional(),
});

export type LpFormResult = { ok: true; slug: string } | { ok: false; error: string };

function parseVariants(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,、\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// ★auth() を直接使わない。localhost の自動ログインは Cookie 名が違うため
//   auth() が常に null を返し、owner 限定の操作が全て落ちる（lib/session.ts）

export async function saveLp(formData: FormData): Promise<LpFormResult> {
  // 認可: owner のみ（§8 Role）
  if (!(await isOwner())) return { ok: false, error: "権限がありません（owner のみ）" };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const d = parsed.data;

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return { ok: false, error: "事業が見つかりません" };

  const data = {
    name: d.name,
    url: d.url,
    lpType: d.lpType,
    offer: d.offer,
    status: d.status,
    variantKeys: parseVariants(d.variantKeys),
    metricPrefix: d.metricPrefix || null,
    hasAgencyCodes: d.hasAgencyCodes === "on",
  };

  const existing = await prisma.landingPage.findFirst({
    where: { businessId: business.id, slug: d.slug },
    select: { id: true, publishedAt: true },
  });

  if (existing) {
    await prisma.landingPage.update({
      where: { id: existing.id },
      data: {
        ...data,
        // ★公開日は最初に live にした日を保つ。更新のたびに動かさない
        publishedAt:
          existing.publishedAt ?? (d.status === "live" ? new Date() : null),
      },
    });
  } else {
    await prisma.landingPage.create({
      data: {
        ...data,
        businessId: business.id,
        slug: d.slug,
        productFit: [],
        sourceContentIds: [],
        publishedAt: d.status === "live" ? new Date() : null,
      },
    });
  }

  revalidatePath("/lp");
  revalidatePath(`/lp/${d.slug}`);
  return { ok: true, slug: d.slug };
}
