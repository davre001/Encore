import type { Metadata } from "next";
import { Inter, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import Layout from "@/layout/Layout";
import "@/styles/index.css";
import "@/styles/navbar.css";
import "@/styles/landing.css";
import "@/styles/editor.css";
import "@/styles/studio.css";
import "@/styles/cutroom.css";
import "@/styles/analytics.css";
import "@/styles/settings.css";
import "@/styles/profile.css";
import "@/styles/home.css";
import "@/styles/history.css";
import "@/styles/motion.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/* Hero display face — a characterful editorial grotesque for the landing
 * headline (uppercase). Variable font, so any weight in its axis works; the
 * body copy stays on Inter. Swap the family here to audition another display. */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display-hero",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Encore — the second take that lands",
  description:
    "Upload a long video. Approve the moments. Encore captions, posts, and comes back when a clip flops.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${geistMono.variable} ${bricolage.variable}`}>
      <body>
        <AuthProvider>
          <Layout>{children}</Layout>
        </AuthProvider>
      </body>
    </html>
  );
}
