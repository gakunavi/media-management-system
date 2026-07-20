import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MMS — メディア管理システム",
  description: "メディア／SNS運用の獲得基盤",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
