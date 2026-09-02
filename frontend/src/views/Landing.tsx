"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import LandingHero from "@/components/LandingHero";
import LandingStory from "@/components/LandingStory";
import { useAuth } from "@/context/AuthContext";

export default function Landing() {
  const router = useRouter();
  const { user, ready } = useAuth();

  useEffect(() => {
    if (ready && user) {
      router.replace("/home");
    }
  }, [ready, user, router]);

  return (
    <div className="landing landing--agent">
      <header className="landing-bar landing-bar--over">
        <span className="nav__mark">
          <span className="nav__glyph" aria-hidden="true" />
          Encore
        </span>
      </header>

      <LandingHero />
      <LandingStory />
    </div>
  );
}
