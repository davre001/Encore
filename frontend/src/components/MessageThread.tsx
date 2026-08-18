"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Message } from "@/types";
import { DUR, EASE, springSoft } from "@/lib/motion";

type MessageThreadProps = {
  messages: Message[];
  onSend: (text: string) => void;
  disabled?: boolean;
  /** Shows the typing indicator while Encore is working. */
  busy?: boolean;
};

export default function MessageThread({
  messages,
  onSend,
  disabled,
  busy,
}: MessageThreadProps) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = text.trim();
    if (!next) return;
    onSend(next);
    setText("");
  }

  return (
    <section className="panel thread">
      <div className="panel__head">
        <h2 className="panel__title">Mind</h2>
        <span className="panel__meta">In-app · not Telegram</span>
      </div>
      <div className="thread__list">
        {messages.length === 0 ? (
          <p className="panel__empty">
            Upload a video and Encore will talk through the cut here.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                layout
                className={`bubble bubble--${message.role === "mind" ? "mind" : "you"}`}
                initial={{
                  opacity: 0,
                  y: 10,
                  x: message.role === "mind" ? -8 : 8,
                }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                transition={springSoft}
              >
                <span className="bubble__who">
                  {message.role === "mind" ? "Encore" : "You"}
                </span>
                {message.text}
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        <AnimatePresence>
          {busy ? (
            <motion.div
              className="bubble bubble--mind thread__typing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: DUR.fast, ease: EASE }}
            >
              <span className="bubble__who">Encore</span>
              <span className="thread__dots" aria-label="Encore is typing">
                <span />
                <span />
                <span />
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>
      <form className="thread__form" onSubmit={handleSubmit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? "Upload a video first" : "Tell Encore what to try…"}
          disabled={disabled}
        />
        <button type="submit" className="btn btn--primary btn--small" disabled={disabled}>
          Send
        </button>
      </form>
    </section>
  );
}
