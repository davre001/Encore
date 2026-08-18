"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { motion, type Variants } from "motion/react";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import Reveal from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { AnimatedMarqueeHero } from "@/components/ui/hero-3";
import { EASE, springSoft } from "@/lib/motion";
import { useAuth } from "@/context/AuthContext";
import { useGoogleSignIn } from "@/hooks/useGoogleSignIn";

/** Verified Unsplash stills — creator, camera and studio work. */
const SHOWCASE_IMAGES = [
  "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=900&auto=format&fit=crop&q=60",
  "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=900&auto=format&fit=crop&q=60",
  "https://images.unsplash.com/photo-1524253482453-3fed8d2fe12b?w=900&auto=format&fit=crop&q=60",
  "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=900&auto=format&fit=crop&q=60",
  "https://images.unsplash.com/photo-1533488765986-dfa2a9939acd?w=900&auto=format&fit=crop&q=60",
  "https://images.unsplash.com/photo-1598899134739-24c46f58b8c0?w=900&auto=format&fit=crop&q=60",
  "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=900&auto=format&fit=crop&q=60",
  "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=900&auto=format&fit=crop&q=60",
];

const HERO_LINES = ["Every long take", "hides a hit."];

const wordReveal: Variants = {
  hidden: { y: "110%" },
  show: { y: "0%", transition: { duration: 0.7, ease: EASE } },
};

/**
 * One headline line, split into masked per-word spans.
 *
 * The spans are plain Motion children of the hero's `<h1>`, which already
 * declares `staggerChildren: 0.1` — so every word inherits the stagger without
 * hero-3.tsx needing to know about it. (Its own word-splitting only runs for a
 * string `title`, and a string cannot carry the line break.)
 */
function HeroLine({ text }: { text: string }) {
  return (
    <span className="block">
      {text.split(" ").map((word, index) => (
        <span key={`${word}-${index}`} className="hero__word">
          <motion.span variants={wordReveal}>{word}</motion.span>
        </span>
      ))}
    </span>
  );
}

export default function Landing() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const { signInWithGoogle } = useGoogleSignIn();
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    if (ready && user) {
      router.replace("/home");
    }
  }, [ready, user, router]);

  return (
    <main className="landing">
      <header className="landing-bar landing-bar--over">
        <span className="nav__mark">
          <span className="nav__glyph" aria-hidden="true" />
          Encore
        </span>
        <nav className="landing-bar__links">
          <Link href="/signin">Sign in</Link>
          <Link href="/signup">Sign up</Link>
        </nav>
      </header>

      <AnimatedMarqueeHero
        tagline="Persistent AI editor for creators"
        title={
          <>
            {HERO_LINES.map((line) => (
              <HeroLine key={line} text={line} />
            ))}
          </>
        }
        description="Upload a long video. Approve the moments. Encore writes the caption, posts it, then checks the live numbers and comes back with a sharper take."
        ctaText="Start with Google"
        images={SHOWCASE_IMAGES}
        onCtaClick={signInWithGoogle}
      />

      <Reveal as="section" className="how" id="how">
        <p className="eyebrow">How it plays</p>
        <h2>One video. A second night.</h2>
        <Stagger as="ol" className="steps" stagger={0.1}>
          <StaggerItem
            as="li"
            whileHover={reduced ? undefined : { y: -3 }}
            transition={springSoft}
          >
            <span>01</span>
            <h3>Drop the long take</h3>
            <p>Send the file. Encore watches the words and the beats that can stand alone.</p>
          </StaggerItem>
          <StaggerItem
            as="li"
            whileHover={reduced ? undefined : { y: -3 }}
            transition={springSoft}
          >
            <span>02</span>
            <h3>Call keep or skip</h3>
            <p>You approve the moments. Rejects go into memory — that style stops coming back.</p>
          </StaggerItem>
          <StaggerItem
            as="li"
            whileHover={reduced ? undefined : { y: -3 }}
            transition={springSoft}
          >
            <span>03</span>
            <h3>It posts, then returns</h3>
            <p>Caption, tags, YouTube. Later it checks the live post and brings a recut if it died.</p>
          </StaggerItem>
        </Stagger>
      </Reveal>

      <Reveal as="section" className="memory">
        <div>
          <p className="eyebrow">It remembers</p>
          <h2>Taste compounds. Flops do not repeat.</h2>
          <p>
            Every skip, every hit, every leftover timestamp stays on the tape.
            Close the tab. Come back Thursday. Encore still knows which hook
            landed and which talking-head you never want again.
          </p>
        </div>
        <Stagger as="ul" className="memory__list" stagger={0.09}>
          <StaggerItem as="li">
            <strong>Your playbook</strong>
            Confession hooks beat tutorials on Shorts. For you. Not the internet.
          </StaggerItem>
          <StaggerItem as="li">
            <strong>Leftovers</strong>
            Unused rants wait. They do not get posted twice with a new crop.
          </StaggerItem>
          <StaggerItem as="li">
            <strong>Unprompted check-in</strong>
            24 hours later it already has the verdict. You did not type “how did it do?”
          </StaggerItem>
        </Stagger>
      </Reveal>

      <Reveal as="section" className="close">
        <h2>Give the footage another night.</h2>
        <GoogleSignInButton label="Sign up with Google" />
      </Reveal>
    </main>
  );
}
