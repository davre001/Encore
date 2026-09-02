"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";

type LayoutProps = {
  children: ReactNode;
};

/*
 * Public, full-bleed routes that never wear the app chrome — even for a
 * signed-in user. Landing is a marketing page; sign-in/up own their own layout.
 */
const BARE_ROUTES = new Set(["/", "/signin", "/signup"]);

/*
 * Signed-in but full-screen: the cut room is its own workspace and takes over
 * the whole window like a desktop editor, so the app sidebar is hidden here.
 */
const FULLSCREEN_ROUTES = new Set(["/editor"]);

export default function Layout({ children }: LayoutProps) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const showChrome =
    ready &&
    Boolean(user) &&
    !BARE_ROUTES.has(pathname) &&
    !FULLSCREEN_ROUTES.has(pathname);

  return (
    /*
     * `reducedMotion="user"` makes every Motion animation below honour the OS
     * setting, disabling transform and layout animations while still allowing
     * opacity. Animations that are neither (CountUp's number, the bar heights)
     * check `useReducedMotionSafe()` themselves.
     */
    <MotionConfig reducedMotion="user">
      <div className={showChrome ? "shell" : "shell shell--bare"}>
        {showChrome ? <Navbar /> : null}
        <div className="shell__body">{children}</div>
      </div>
    </MotionConfig>
  );
}
