import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CleanChat",
  description: "AI chat assistant — private, fast, web-based",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a" }}>{children}</body>
    </html>
  );
}
