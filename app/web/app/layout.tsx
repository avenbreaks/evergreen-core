import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { AgentationDevtool } from "@/components/agentation-devtool";
import { AppProviders } from "@/components/providers/app-providers";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Evergreen Devparty",
  description: "Web3-native developer community frontend for Evergreen Devparty.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetBrainsMono.variable} bg-background text-foreground font-sans antialiased`}
      >
        <AppProviders>{children}</AppProviders>
        <AgentationDevtool />
      </body>
    </html>
  );
}
