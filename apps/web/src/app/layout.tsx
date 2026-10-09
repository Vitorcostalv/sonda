import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell";
import "./globals.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
export const metadata: Metadata = {
  title: { default: "SONDA — Observatório digital", template: "%s · SONDA" },
  description:
    "Diagnóstico técnico de segurança e qualidade de websites. Evidências reais, regras transparentes e verificações passivas.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
