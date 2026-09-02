"use client";

import { useEffect, useState, type MouseEvent } from "react";
import {
  OrbitalHeroSection,
  SOLAR_SYSTEM,
  type Planet,
} from "@/components/ui/orbital-hero-section";
import StartProjectButton from "@/components/ui/start-project-button";

/* ---------------------------------------------------------------------------
 * Encore's sky is burnt, never yellow.
 *
 * The stock component ships blue bodies (Earth, Uranus, Neptune) and gold/straw
 * ones (Venus, Saturn, cream Mercury). The hero has to read pure burnt-orange /
 * copper / ember — no blue, and (per the brief) no yellow — so every planet is
 * pinned into one tight ~27deg orange-copper family here over SOLAR_SYSTEM.
 * Only Mars keeps its own default (ember red #ff4a32) as the single hotter
 * accent. (The Sun's glow + drift-track are baked into the component; those are
 * de-yellowed in orbital-hero-section.tsx, and its light is warmed to a peachy
 * white via the sunColor prop below.)
 *
 * Module scope keeps the array identity stable across renders — the canvas
 * rebuilds its orbit maths only when the planet set actually changes.
 * ------------------------------------------------------------------------- */
const RECOLOR: Record<string, string> = {
  Mercury: "#f2c39c", // pale copper (was cream #ffe9c7)
  Venus: "#ef9a52", //   warm orange (was gold #ffc65a)
  Earth: "#ff9d4d", //   burnt amber — the bright signature body (keeps glow 1.1)
  Jupiter: "#f5933c", // deep orange (was yellow-orange #ffa62e)
  Saturn: "#d8935a", //  tan-copper (was straw #ffd884)
  Uranus: "#e3a877", //  copper-tan (was cyan)
  Neptune: "#d07b39", // deep copper (was blue)
};

const ENCORE_SYSTEM: Planet[] = SOLAR_SYSTEM.map((p) =>
  RECOLOR[p.name] ? { ...p, color: RECOLOR[p.name] } : p,
);

/**
 * Watches a media query and reports whether it matches. Starts false on the
 * server and the first client paint (so SSR and hydration agree), then settles
 * to the real value in an effect — the hero renders its desktop framing for a
 * frame before flipping to mobile, which is invisible in practice.
 */
function useNarrow(query = "(max-width: 767px)"): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return narrow;
}

/** The story's first section — the smooth-scroll target for the ghost CTA. */
const FIRST_STORY_SECTION = "the-long-take";

/* The three brand classes (.landing-hero__eyebrow/__title/__lede) are unlayered
 * and carry a centred layout (margin-inline:auto etc.). Inline styles beat a
 * non-!important stylesheet rule, so these pull the copy flush-left for the
 * scrim composition while the font / weight / uppercase treatment rides along. */
const LEFT = { marginInline: 0, textAlign: "left" as const };

export default function LandingHero() {
  const narrow = useNarrow();

  // Desktop keeps the Sun up and to the right and veils the left third for the
  // copy; mobile drops the Sun low and veils the top, so the text clears it.
  const framing = narrow
    ? {
        focus: [0.5, 0.84] as [number, number],
        scrim: "top" as const,
        scrimStrength: 0.94,
        viewRadius: 2.1,
        lead: 0.05,
        glow: 0.55,
      }
    : {
        focus: [0.72, 0.44] as [number, number],
        scrim: "left" as const,
        scrimStrength: 0.92,
        viewRadius: 3.1,
        lead: 0.12,
        glow: 1,
      };

  function scrollToStory(event: MouseEvent<HTMLAnchorElement>) {
    const el = document.getElementById(FIRST_STORY_SECTION);
    if (!el) return; // fall through to the plain #anchor jump
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY,
      behavior: reduce ? "auto" : "smooth",
    });
  }

  return (
    <section className="relative w-full min-h-[100svh]">
      <OrbitalHeroSection
        planets={ENCORE_SYSTEM}
        sunColor="#ffe9dd"
        focus={framing.focus}
        scrim={framing.scrim}
        scrimStrength={framing.scrimStrength}
        viewRadius={framing.viewRadius}
        lead={framing.lead}
        glow={framing.glow}
      >
        {/* Copy column. Left-aligned on the veiled edge; on mobile it sits high
            and clears the low Sun. pt clears the absolute header bar. */}
        <div className="flex h-full min-h-[100svh] items-start px-6 pt-28 sm:px-10 md:items-center md:pt-0 lg:px-[6vw]">
          <div className="max-w-[42rem]">
            <p
              className="landing-hero__eyebrow landing-rise"
              style={{ ...LEFT, color: "rgba(242, 194, 158, 0.82)", animationDelay: "0.05s" }}
            >
              Persistent AI video editor
            </p>

            {/* Reuses the approved Bricolage-uppercase treatment; the inline
                LEFT override only undoes the centred layout so the headline
                reads flush-left against the scrim. Broken to two explicit lines
                ("Every long take" / "hides a hit"); each line sits well under
                the class's 20ch cap, so the hard break never overflows. */}
            <h1
              className="landing-hero__title landing-rise mt-4"
              style={{
                ...LEFT,
                textShadow: "0 2px 44px rgba(8,5,3,0.6)",
                animationDelay: "0.16s",
              }}
            >
              Every long take
              <br />
              hides a hit
            </h1>

            <p
              className="landing-hero__lede landing-rise mt-5"
              style={{ ...LEFT, animationDelay: "0.32s" }}
            >
              Drop a long take. Keep the hits. Cut the flops.
            </p>

            <div
              className="landing-rise mt-9 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "0.46s" }}
            >
              <StartProjectButton href="/signup" label="Start new project" size="lg" />
              <a
                href={`#${FIRST_STORY_SECTION}`}
                onClick={scrollToStory}
                className="rounded-full border border-white/20 px-6 py-3 text-sm text-white/80 transition-colors hover:border-white/45 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5b168]"
              >
                See how it works
              </a>
            </div>
          </div>
        </div>
      </OrbitalHeroSection>
    </section>
  );
}
