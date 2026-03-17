import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppSessionProvider } from "@/components/AppSessionProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brevoca Web",
  description: "Production-focused AI meeting notes service",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-screen bg-slate-950 text-slate-50 font-sans antialiased">
        <AppSessionProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </AppSessionProvider>
      </body>
    </html>
  );
}
