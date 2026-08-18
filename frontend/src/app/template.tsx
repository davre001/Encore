"use client";

import PageMotion from "@/components/PageMotion";

export default function Template({ children }: { children: React.ReactNode }) {
  return <PageMotion>{children}</PageMotion>;
}
