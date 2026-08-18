"use client";

import { useCallback, useState } from "react";
import UploadPanel from "@/components/UploadPanel";
import MessageThread from "@/components/MessageThread";
import MomentList from "@/components/MomentList";
import ClipList from "@/components/ClipList";
import PostStatus from "@/components/PostStatus";
import type { Clip, Message, Moment, PostCheck, Video } from "@/types";
import {
  buildClipFromMoment,
  buildMoments,
  buildPostCheck,
  buildVideo,
  mindMessage,
  youMessage,
} from "@/lib/mockEditor";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Editor() {
  const [video, setVideo] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [checks, setChecks] = useState<PostCheck[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    mindMessage(
      "Drop a long take. I’ll pick the beats that can stand alone — you keep or skip.",
    ),
  ]);

  const pushMind = useCallback((text: string) => {
    setMessages((prev) => [...prev, mindMessage(text)]);
  }, []);

  async function handleUpload(file: File) {
    setBusy(true);
    setMoments([]);
    setClips([]);
    setChecks([]);
    const nextVideo = buildVideo(file);
    setVideo(nextVideo);
    setMessages((prev) => [
      ...prev,
      youMessage(`Uploaded ${file.name}`),
      mindMessage("Watching for standalone beats…"),
    ]);

    await sleep(1400);
    const nextMoments = buildMoments(nextVideo.id);
    setMoments(nextMoments);
    setBusy(false);
    pushMind(
      `Found ${nextMoments.length} moments. Keep the ones that sound like you. Skips go into the notebook.`,
    );
  }

  function handleReset() {
    setVideo(null);
    setMoments([]);
    setClips([]);
    setChecks([]);
    setBusy(false);
    setMessages([
      mindMessage(
        "Fresh tape. Drop another long take when you’re ready.",
      ),
    ]);
  }

  function handleDecide(id: string, decision: "accept" | "reject") {
    const target = moments.find((m) => m.id === id);
    if (!target || target.status !== "pending" || !video) return;

    setMoments((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, status: decision === "accept" ? "accepted" : "rejected" }
          : m,
      ),
    );

    if (decision === "accept") {
      const clip = buildClipFromMoment(target, video.id);
      setClips((prev) => [...prev, clip]);
      pushMind(
        `Kept “${target.label}”. Cut ready with title and hashtags — edit if you want, then post.`,
      );
    } else {
      pushMind(
        `Skipped “${target.label}”. I won’t push that style next time unless you ask.`,
      );
    }
  }

  function handleClipChange(next: Clip) {
    setClips((prev) => prev.map((c) => (c.id === next.id ? next : c)));
  }

  async function handlePost(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip || clip.posted) return;

    const postId = `post_${clipId}`;
    const postUrl = `https://youtube.com/shorts/encore-${clipId.slice(-5)}`;
    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, posted: true, postId, postUrl } : c,
      ),
    );
    pushMind(
      `Posted “${clip.title}”. I’ll check views against your median after a beat — no need to ask.`,
    );

    await sleep(2200);
    const posted = { ...clip, posted: true, postId, postUrl };
    const check = buildPostCheck(posted);
    setChecks((prev) => [check, ...prev]);
    pushMind(
      check.verdict === "hit"
        ? `${check.views.toLocaleString()} views. Hit. That hook style goes up in the playbook.`
        : check.verdict === "flop"
          ? `${check.views.toLocaleString()} views. Flop. ${check.recutHook}`
          : `${check.views.toLocaleString()} views. Mid. Leave it and ship a leftover tomorrow.`,
    );
  }

  function handleRecut(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    const recut: Clip = {
      ...clip,
      id: `${clip.id}_recut`,
      title: "Nobody talks about the 2 a.m. spiral.",
      caption:
        "Nobody talks about the 2 a.m. spiral.\n\nSame moment. New open. Story-first.",
      hashtags: ["#studyvlog", "#recut", "#encore", "#shorts"],
      posted: false,
      postId: undefined,
      postUrl: undefined,
    };
    setClips((prev) => [recut, ...prev]);
    pushMind("Recut queued with a story-first open. Post when it feels right.");
  }

  function handleSend(text: string) {
    setMessages((prev) => [...prev, youMessage(text)]);
    const lower = text.toLowerCase();
    window.setTimeout(() => {
      if (lower.includes("leftover") || lower.includes("left over")) {
        pushMind(
          "You still have the exam-panic rant unused. Shorts liked rants last month — want me to ship it?",
        );
      } else if (lower.includes("flop") || lower.includes("check")) {
        pushMind(
          checks[0]
            ? `Latest: ${checks[0].verdict} at ${checks[0].views.toLocaleString()} views.`
            : "Nothing live yet. Post a clip and I’ll check it on my own.",
        );
      } else {
        pushMind(
          "I’m on the notebook. Keep or skip the moments, edit captions, post — I’ll handle the live check.",
        );
      }
    }, 500);
  }

  return (
    <main className="workspace">
      <div className="workspace__main">
        <UploadPanel
          video={video}
          busy={busy}
          onUpload={handleUpload}
          onReset={handleReset}
        />
        <MomentList moments={moments} onDecide={handleDecide} />
        <ClipList
          clips={clips}
          onChange={handleClipChange}
          onPost={handlePost}
        />
        <PostStatus checks={checks} onRecut={handleRecut} />
      </div>
      <div className="workspace__side">
        <MessageThread
          messages={messages}
          onSend={handleSend}
          disabled={!video && !busy}
          busy={busy}
        />
      </div>
    </main>
  );
}
