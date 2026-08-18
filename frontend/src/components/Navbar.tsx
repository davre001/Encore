"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  ChartLine,
  ChevronRight,
  Clapperboard,
  House,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import { DUR, EASE, springSoft } from "@/lib/motion";
import { useAuth } from "@/context/AuthContext";

const links = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/editor", label: "Editor", Icon: Clapperboard },
  { href: "/history", label: "History", Icon: Archive },
  { href: "/analytics", label: "Analytics", Icon: ChartLine },
  { href: "/profile", label: "Profile", Icon: User },
];

const tail = [{ href: "/settings", label: "Settings", Icon: Settings }];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const initial = (user?.name ?? "?").slice(0, 1).toUpperCase();

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e: MouseEvent) {
      if (!accountRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("click", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Collapse the menu whenever the route changes under it.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  function handleSignOut() {
    setMenuOpen(false);
    signOut();
    router.push("/");
  }

  function item({ href, label, Icon }: (typeof links)[number]) {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={active ? "side__link is-active" : "side__link"}
      >
        {active ? (
          <motion.span
            layoutId="nav-active"
            className="side__pill"
            transition={springSoft}
          />
        ) : null}
        <Icon className="side__icon" aria-hidden="true" />
        <span className="side__label">{label}</span>
      </Link>
    );
  }

  return (
    <aside className="side">
      <Link className="nav__mark side__brand" href="/home">
        <span className="nav__glyph" aria-hidden="true" />
        Encore
      </Link>

      <nav className="side__nav">
        {links.map(item)}
        <span className="side__divider" aria-hidden="true" />
        {tail.map(item)}
      </nav>

      <div className="side__account" ref={accountRef}>
        <AnimatePresence>
          {menuOpen ? (
            <motion.div
              className="side__menu"
              role="menu"
              aria-label="Account"
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: DUR.fast, ease: EASE }}
            >
              <Link
                href="/profile"
                role="menuitem"
                className="side__menu-item"
                onClick={() => setMenuOpen(false)}
              >
                <User aria-hidden="true" />
                View profile
              </Link>
              <button
                type="button"
                role="menuitem"
                className="side__menu-item is-danger"
                onClick={handleSignOut}
              >
                <LogOut aria-hidden="true" />
                Log out
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <button
          type="button"
          className={menuOpen ? "side__user is-open" : "side__user"}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="side__avatar" aria-hidden="true">
            {user?.picture ? <img src={user.picture} alt="" /> : initial}
          </span>
          <span className="side__who">
            <strong>{user?.name ?? "Creator"}</strong>
            <span>{user?.niche ?? "Creator"}</span>
          </span>
          <ChevronRight className="side__chevron" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
