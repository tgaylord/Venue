import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Instrument_Sans, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-instrument-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-mono" });

export const metadata: Metadata = {
  title: "VenueDash",
  description: "Paperwork infrastructure for studio owners who rent for private events.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VenueDash",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
