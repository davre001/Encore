import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import Layout from "@/layout/Layout";
import "@/styles/index.css";
import "@/styles/navbar.css";
import "@/styles/landing.css";
import "@/styles/editor.css";
import "@/styles/analytics.css";
import "@/styles/settings.css";
import "@/styles/profile.css";
import "@/styles/home.css";
import "@/styles/history.css";
import "@/styles/motion.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
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
    <html lang="en" className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body>
        <AuthProvider>
          <Layout>{children}</Layout>
        </AuthProvider>
      </body>
    </html>
  );
}
