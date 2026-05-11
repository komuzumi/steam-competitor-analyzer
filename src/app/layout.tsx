import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steam 競合・市場分析ダッシュボード",
  description: "Steamタイトルのレビュー、推定販売本数、推定売上、AI分析を確認するツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
