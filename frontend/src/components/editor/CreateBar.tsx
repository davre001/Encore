"use client";

import { useRef, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Plus } from "lucide-react";
import type { Message } from "@/types";
import { DUR, EASE } from "@/lib/motion";

type CreateBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
  busy: boolean;
  agentOpen: boolean;
  onToggleAgent: () => void;
  messages: Message[];
};

export default function CreateBar({
  value,
  onChange,
  onSend,
  onUpload,
  busy,
  agentOpen,
  onToggleAgent,
  messages,
}: CreateBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function takeFile(file: File | undefined) {
    if (!file || !file.type.startsWith("video/")) return;
    onUpload(file);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next = value.trim();
    if (!next) {
      fileRef.current?.click();
      return;
    }
    onSend(next);
  }

  return (
    <div className="create-bar">
      <AnimatePresence>
        {agentOpen ? (
          <motion.div
            className="create-bar__mind"
            role="log"
            aria-live="polite"
            aria-label="Encore mind"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {messages.slice(-6).map((message) => (
              <p
                key={message.id}
                className={`bubble bubble--${message.role}`}
              >
                <span className="bubble__who">
                  {message.role === "mind" ? "Encore" : "You"}
                </span>
                {message.text}
              </p>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <form className="create-bar__dock" onSubmit={handleSubmit}>
        <button
          type="button"
          className="create-bar__plus"
          aria-label="Upload a long take"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className={agentOpen ? "create-bar__agent is-on" : "create-bar__agent"}
          aria-pressed={agentOpen}
          onClick={onToggleAgent}
        >
          Agent
        </button>
        <input
          className="create-bar__field"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="What do you want to create?"
          aria-label="What do you want to create?"
          disabled={busy}
        />
        <span className="create-bar__chip">Video · 720p · 6s</span>
        <button
          type="submit"
          className="create-bar__send"
          aria-label={value.trim() ? "Send" : "Choose a video"}
          disabled={busy}
        >
          <ArrowUp aria-hidden="true" />
        </button>
        <input
          ref={fileRef}
          className="create-bar__file"
          type="file"
          accept="video/*"
          onChange={(event) => takeFile(event.target.files?.[0])}
        />
      </form>
    </div>
  );
}
