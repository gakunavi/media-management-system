import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const dynamic = "force-dynamic";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { callbackUrl, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-bold">MMS にログイン</h1>
      <p className="mt-2 text-sm text-neutral-500">
        登録済みのメールアドレスにログインリンクを送ります。
      </p>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          ログインに失敗しました（{error}）
        </p>
      ) : null}

      <form
        className="mt-6 space-y-3"
        action={async (formData: FormData) => {
          "use server";
          await signIn("nodemailer", {
            email: String(formData.get("email") ?? ""),
            redirectTo: callbackUrl || "/",
          });
        }}
      >
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          ログインリンクを送る
        </button>
      </form>

      <p className="mt-6 text-xs text-neutral-400">
        設計書 §8: 外部公開は Cloudflare Tunnel + Access のみ。
      </p>
    </main>
  );
}
