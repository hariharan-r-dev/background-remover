import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clearcut — Image Background Remover",
  description: "Remove image backgrounds locally. Process multiple images and download transparent PNGs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
