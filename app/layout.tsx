import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Audit | Private Dashboard",
  description:
    "Private stock-audit dashboard for the shared and personal family portfolio.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
