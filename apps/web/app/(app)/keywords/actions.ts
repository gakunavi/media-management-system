"use server";

// AI Overview の引用ドメインを取得する対象キーワードの切り替え（設計書 §3.3.6）
//
// ★なぜ画面から操作させるのか
//   AIOの「有無」は全KWで取れるが、引用元ドメインの取得は1SERPあたり
//   約5倍のコストがかかる（実測 $0.0006 → $0.0030）。どのKWに払うかは
//   費用対効果の判断＝業務判断なので、.env とコンテナ再ビルドではなく
//   運用者がその場で決められるべき（§12.3「押すのは人」）。
import { revalidatePath } from "next/cache";
import { prisma } from "@mms/db";
import { auth } from "@/auth";

/** AIO引用の取得コスト（2026-07-21 実測）。差分表示に使う */
const USD_PER_SERP_WITH_AIO = 0.003;
const USD_PER_SERP_PLAIN = 0.0006;
/** 週次実行を前提とした月あたりの回数 */
const RUNS_PER_MONTH = 52 / 12;

type Result = { ok: true; message: string } | { ok: false; error: string };

export async function setAioTracked(keywordId: string, tracked: boolean): Promise<Result> {
  const session = await auth();
  if (!session?.user || session.user.role !== "owner") {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }

  const kw = await prisma.keyword.update({
    where: { id: keywordId },
    data: { aioTracked: tracked },
    select: { keyword: true },
  });

  const total = await prisma.keyword.count({ where: { aioTracked: true } });
  const extra = total * (USD_PER_SERP_WITH_AIO - USD_PER_SERP_PLAIN) * RUNS_PER_MONTH;

  revalidatePath("/keywords");
  return {
    ok: true,
    message: tracked
      ? `「${kw.keyword}」のAIO引用を取得します（対象 ${total}件・追加コスト 約$${extra.toFixed(2)}/月）`
      : `「${kw.keyword}」のAIO引用取得を外しました（対象 ${total}件・追加コスト 約$${extra.toFixed(2)}/月）`,
  };
}
