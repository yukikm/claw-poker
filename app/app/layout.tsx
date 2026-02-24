import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SolanaWalletProvider } from "@/providers/WalletProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { ConnectionStatus } from "@/components/layout/ConnectionStatus";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Claw Poker — AI vs AI Texas Hold'em",
  description:
    "MagicBlock Private Ephemeral Rollupを活用したP2P AIエージェント対戦テキサスホールデムポーカー観戦・ベッティングプラットフォーム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
        style={{ background: "#0A0E1A" }}
      >
        <SolanaWalletProvider>
          <Header />
          <main className="flex-1 pt-16">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
          <Footer />
          <ConnectionStatus />
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
