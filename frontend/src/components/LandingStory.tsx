"use client";

import StartProjectButton from "@/components/ui/start-project-button";
import FlowArt, { FlowSection } from "@/components/ui/story-scroll";

/**
 * Encore landing narrative — a pinned, rotate-in scroll story that sits below
 * the moon-glow hero. Mechanism (pin + scrubbed rotation) comes from the
 * FlowArt/FlowSection primitives; the copy is Encore's own and the palette is
 * the site's burnt-brown family. Fully static markup → SSR-safe (the GSAP
 * pass runs client-side inside FlowArt and is reduced-motion aware).
 */
export default function LandingStory() {
  return (
    <FlowArt aria-label="How Encore works" className="landing-story">
      {/* 01 — the problem, opening on the brand burnt amber */}
      <FlowSection
        id="the-long-take"
        aria-label="The long take"
        style={{ backgroundColor: "#B45309", color: "#ffffff" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-80 sm:text-sm">
          01 — The long take
        </p>

        <div>
          <hr className="mb-[3vw] border-t border-white/40" />
          <h2 className="text-[clamp(3rem,11vw,12rem)] font-bold uppercase leading-[0.82] tracking-tight">
            Buried
            <br />
            in the
            <br />
            footage
          </h2>
        </div>

        <p className="ml-auto max-w-md text-right text-base leading-relaxed opacity-90 sm:text-lg">
          You shot for an hour. The clip that lands is twelve seconds of it —
          and finding those seconds is the whole job.
        </p>
      </FlowSection>

      {/* 02 — what Encore does, on near-black */}
      <FlowSection
        id="the-cut"
        aria-label="Cut to the hit"
        style={{ backgroundColor: "#0b0806", color: "#ffffff" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-70 sm:text-sm">
          02 — The cut
        </p>

        <div>
          <hr className="mb-[3vw] border-t border-white/25" />
          <h2 className="text-[clamp(3rem,11vw,12rem)] font-bold uppercase leading-[0.82] tracking-tight">
            Cut
            <br />
            to
            <br />
            the hit
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em]">
              Moments
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              Encore scrubs the full take and surfaces the beats an editor would
              stop on.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em]">
              Captions
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              Every clip lands with a caption, tags, and hashtags written to
              match the moment.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em]">
              Posting
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              Approve once. Encore publishes to your channels and tracks how each
              cut performs.
            </p>
          </div>
        </div>
      </FlowSection>

      {/* 03 — how it works, a light parchment breather with dark ink */}
      <FlowSection
        id="how-it-works"
        aria-label="How it works"
        style={{ backgroundColor: "#ECE3D3", color: "#1a1206" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-60 sm:text-sm">
          03 — How it works
        </p>

        <div>
          <hr className="mb-[3vw] border-t border-black/25" />
          <h2 className="text-[clamp(3rem,11vw,12rem)] font-bold uppercase leading-[0.82] tracking-tight">
            Upload
            <br />
            review
            <br />
            post
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-[#B45309]">
              01 — Upload
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              Drop a long take — a stream, a vlog, an interview. Encore takes it
              from there.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-[#B45309]">
              02 — Review
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              Skim the moments Encore pulled. Keep the ones you like, drop the
              rest.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-[#B45309]">
              03 — Post
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              Captioned, tagged, and scheduled. Encore posts, then reports back on
              what hit.
            </p>
          </div>
        </div>
      </FlowSection>

      {/* 04 — it learns you, on deep chestnut */}
      <FlowSection
        id="it-remembers"
        aria-label="It remembers"
        style={{ backgroundColor: "#4a230f", color: "#ffffff" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-70 sm:text-sm">
          04 — It remembers
        </p>

        <div>
          <hr className="mb-[3vw] border-t border-white/25" />
          <h2 className="text-[clamp(3rem,11vw,12rem)] font-bold uppercase leading-[0.82] tracking-tight">
            It
            <br />
            learns
            <br />
            you
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em]">
              Your taste
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              Encore builds a profile from what you keep and what you cut, and
              leans on it every time.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em]">
              Hook memory
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              It tracks which openings hold attention and which lose it, channel
              by channel.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em]">
              Sharper each time
            </h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed opacity-70">
              The more you post, the less you correct. Encore trends toward your
              yes.
            </p>
          </div>
        </div>
      </FlowSection>

      {/* 05 — the call to action, back to near-black */}
      <FlowSection
        id="your-encore"
        aria-label="Your encore"
        style={{ backgroundColor: "#0b0806", color: "#ffffff" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-70 sm:text-sm">
          05 — Your encore
        </p>

        <div>
          <hr className="mb-[3vw] border-t border-white/25" />
          <h2 className="text-[clamp(3rem,11vw,12rem)] font-bold uppercase leading-[0.82] tracking-tight">
            Ready
            <br />
            for your
            <br />
            encore?
          </h2>
        </div>

        <div className="flex flex-col items-start gap-6">
          <p className="max-w-md text-base leading-relaxed opacity-80 sm:text-lg">
            Bring your longest take. Walk away with the clip that lands.
          </p>
          <StartProjectButton href="/signup" label="START FREE" />
        </div>
      </FlowSection>
    </FlowArt>
  );
}
