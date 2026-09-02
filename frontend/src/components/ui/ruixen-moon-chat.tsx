"use client";

import {
  Fragment,
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, Paperclip, PenTool, PlusIcon } from "lucide-react";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

const TYPING_PHRASE = "Let's get creative";

/* Typewriter cadence. Erasing runs faster than typing, the way a real
 * backspace does, and the empty beat is short so the field never sits blank. */
const TYPE_MS = 72;
const ERASE_MS = 34;
const HOLD_MS = 1700;
const RESTART_MS = 420;
const START_MS = 500;

/* Headline, drawn from the README's promise ("Upload a long video… suggests a
 * better version… which hooks flop"). Split into words so each can rise into
 * place on its own beat — the animation is CSS-driven, so the stagger delays
 * below are deterministic and render identically on the server and the client. */
const HERO_WORDS = "Every long take hides a hit.".split(" ");

/* Rising embers — the ambient motion graphic behind the hero. Every value is
 * derived from the index (never Math.random), so server HTML and the first
 * client render are byte-identical and hydration stays clean. */
const EMBERS = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: Number(((i * 0.9) % 8).toFixed(2)),
  duration: 7 + (i % 5) * 1.4,
  drift: (i % 2 === 0 ? 1 : -1) * (10 + ((i * 7) % 30)),
  size: 2 + (i % 3),
  opacity: 0.35 + (i % 4) * 0.12,
}));

interface AutoResizeProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({ minHeight, maxHeight }: AutoResizeProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      textarea.style.height = `${minHeight}px`;
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Infinity),
      );
      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight],
  );

  useEffect(() => {
    if (textareaRef.current)
      textareaRef.current.style.height = `${minHeight}px`;
  }, [minHeight]);

  return { textareaRef, adjustHeight };
}

/**
 * Types the phrase out, holds it, erases it, and goes again — returning the
 * string to hand the textarea's own `placeholder`.
 *
 * Driving the native placeholder (rather than an overlay) keeps padding
 * aligned with the textarea. No caret character — the typewriter is the
 * only motion in the field.
 */
function useTypewriter(phrase: string, enabled: boolean, reduced: boolean) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!enabled) {
      setText("");
      return;
    }
    if (reduced) {
      setText(phrase);
      return;
    }

    let i = 0;
    let erasing = false;
    let timer = 0;

    const tick = () => {
      if (erasing) {
        i -= 1;
        setText(phrase.slice(0, Math.max(i, 0)));
        if (i <= 0) {
          erasing = false;
          timer = window.setTimeout(tick, RESTART_MS);
        } else {
          timer = window.setTimeout(tick, ERASE_MS);
        }
        return;
      }

      i += 1;
      setText(phrase.slice(0, i));
      if (i >= phrase.length) {
        erasing = true;
        timer = window.setTimeout(tick, HOLD_MS);
      } else {
        timer = window.setTimeout(tick, TYPE_MS);
      }
    };

    timer = window.setTimeout(tick, START_MS);
    return () => window.clearTimeout(timer);
  }, [phrase, enabled, reduced]);

  if (!enabled) return "";
  if (reduced) return phrase;
  return text;
}

/**
 * Cursor-reactive parallax. A pointer over the hero writes its position into
 * `--mx` / `--my` (each roughly -0.5…0.5); the ambient glow orbs read those
 * vars and drift toward the cursor, giving the flat photo a sense of depth.
 * rAF-throttled, and skipped entirely under reduced-motion.
 */
function usePointerParallax(
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const mx = (e.clientX - r.left) / r.width - 0.5;
        const my = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty("--mx", mx.toFixed(3));
        el.style.setProperty("--my", my.toFixed(3));
      });
    };
    const onLeave = () => {
      el.style.setProperty("--mx", "0");
      el.style.setProperty("--my", "0");
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [ref, enabled]);
}

export default function RuixenMoonChat() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  usePointerParallax(rootRef, !reduced);

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 48,
    maxHeight: 150,
  });
  const placeholder = useTypewriter(
    TYPING_PHRASE,
    message.length === 0,
    reduced,
  );
  const canSend = message.trim().length > 0;

  function goCreate() {
    router.push("/signup");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    goCreate();
  }

  return (
    <div
      ref={rootRef}
      className="landing-moon relative w-full flex flex-col items-center"
    >
      {/* The moon's crest bloom — a soft warm highlight that drifts toward
          the cursor, layered beneath the contrast scrim. */}
      <div className="landing-fx landing-fx--bloom" aria-hidden="true">
        <span className="landing-fx__bloom" />
      </div>

      <div className="landing-moon__scrim" aria-hidden="true" />

      {/* Rising embers, layered above the scrim so they read against the dark. */}
      <div className="landing-fx landing-fx--embers" aria-hidden="true">
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="ember"
            style={{
              left: `${e.left}%`,
              width: `${e.size}px`,
              height: `${e.size}px`,
              opacity: e.opacity,
              animationDelay: `${e.delay}s`,
              animationDuration: `${e.duration}s`,
              // custom prop consumed by the keyframes for horizontal drift
              ["--drift" as string]: `${e.drift}px`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex-1 w-full flex flex-col items-center justify-center gap-7 px-6 pt-16 pb-10">
        <div className="text-center translate-y-[6vh]">
          <p className="landing-hero__eyebrow landing-rise" style={{ animationDelay: "0.05s" }}>
            Persistent AI video editor
          </p>
          <h1 className="landing-hero__title landing-hero__title--anim mt-3">
            {HERO_WORDS.map((word, i) => (
              <Fragment key={i}>
                <span
                  className="word"
                  style={{ animationDelay: `${0.18 + i * 0.085}s` }}
                >
                  {word}
                </span>
                {i < HERO_WORDS.length - 1 ? " " : null}
              </Fragment>
            ))}
          </h1>
          <p className="landing-hero__lede landing-rise mt-3" style={{ animationDelay: "0.72s" }}>
            Drop a long take. Keep the hits. Cut the flops.
          </p>
        </div>

        <form
          className="w-full max-w-3xl landing-rise"
          style={{ animationDelay: "0.86s", marginTop: "15vh" }}
          onSubmit={handleSubmit}
        >
        <div className="chat-beam">
          <span className="chat-beam__spin" aria-hidden="true" />
          <div className="chat-beam__body">
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                adjustHeight();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) goCreate();
                }
              }}
              aria-label="Talk to Encore"
              placeholder={placeholder}
              className={cn(
                "w-full px-4 py-3 resize-none border-none",
                "bg-transparent text-white text-sm",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
                "placeholder:text-neutral-400 min-h-[48px]",
              )}
              style={{ overflow: "hidden" }}
            />

            {/* Footer Buttons */}
            <div className="flex items-center justify-between p-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white hover:bg-neutral-700"
                aria-label="Attach a long take"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={!canSend}
                  className={cn(
                    "flex items-center gap-1 px-3 py-2 rounded-lg transition-colors",
                    canSend
                      ? "bg-[#B45309] text-white hover:bg-[#92400E]"
                      : "bg-neutral-700 text-neutral-400 cursor-not-allowed",
                  )}
                >
                  <ArrowUpIcon className="w-4 h-4" />
                  <span className="sr-only">Send</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) goCreate();
          }}
        />

        {/* Quick Actions */}
        <div className="flex items-center justify-center flex-wrap gap-3 mt-6">
          <QuickAction
            icon={<PenTool className="w-4 h-4" />}
            label="Video trim"
            onClick={goCreate}
          />
          <QuickAction
            icon={<PlusIcon className="w-4 h-4" />}
            label="Director co-pilot"
            onClick={goCreate}
          />
        </div>
      </form>
      </div>

      {/* Fade-out at the foot of the hero: melts the moon glow into the colour
          the story section opens on, so the seam between the two reads as one
          continuous gradient instead of a hard cut. */}
      <div className="landing-moon__fade" aria-hidden="true" />
    </div>
  );
}

interface QuickActionProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

function QuickAction({ icon, label, onClick }: QuickActionProps) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="landing-quick flex items-center gap-2 rounded-full border-white/15 bg-black/45 text-neutral-300 backdrop-blur-sm hover:text-white hover:bg-white/10"
    >
      {icon}
      <span className="text-xs">{label}</span>
    </Button>
  );
}
