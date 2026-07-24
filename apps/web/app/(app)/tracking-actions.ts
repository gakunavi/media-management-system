"use server";

// 計測の受信を再開する（§3.10.4 / P2.11）
//
// ★止める導線（段5の Action）だけ作って再開の導線を作らないと、
//   止めたまま誰も戻せなくなる。止めている間は記事の行動が一切残らないので、
//   「気づいたら3週間止まっていた」が起こりうる。段7から1クリックで戻せるようにする。
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/session";
import { setTrackingDisabled } from "@/lib/telemetry-volume";

// ★<form action={...}> から呼ぶので戻り値は void。
//   結果は再描画された段7の表示（「計測を停止中」が消える）で分かる。
export async function resumeTracking(): Promise<void> {
  const user = await currentUser();
  if (user?.role !== "owner") return; // 権限が無ければ何もしない（画面は owner にしか出ない）

  await setTrackingDisabled(false);
  revalidatePath("/");
}
