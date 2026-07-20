import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // モノレポのワークスペースパッケージは TS のまま参照するため変換が要る
  transpilePackages: ["@mms/db", "@mms/shared"],
  // Docker 用の最小成果物。モノレポなのでリポジトリルートを基準にする
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // 設計書 §8: 外部公開は Cloudflare Tunnel + Access のみ。素性を晒さない
  poweredByHeader: false,
};

export default nextConfig;
