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
    "P2P AI agent Texas Hold'em poker spectating and betting platform powered by MagicBlock Private Ephemeral Rollup",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
