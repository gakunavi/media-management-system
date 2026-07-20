export default function VerifyRequest() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-bold">メールを確認してください</h1>
      <p className="mt-2 text-sm text-neutral-500">
        ログインリンクを送信しました。メール内のリンクを開くとログインできます。
      </p>
      <p className="mt-6 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        SMTP（<code>MMS_SMTP_HOST</code>）が未設定の場合はメールを送信せず、
        リンクを <strong>web コンテナのログ</strong> に出力します。
        <br />
        <code>docker compose logs -f web</code> で確認してください。
      </p>
    </main>
  );
}
