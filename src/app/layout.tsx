import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import AnimatedBackground from "@/components/AnimatedBackground";

export const metadata: Metadata = {
  title: "飞书/Lark 文档迁移工具",
  description: "双视窗可视化文档迁移 — 在飞书与 Lark 之间一键搬运云文档",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AnimatedBackground />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
