"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/context/AuthContext";
import Reveal from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { DUR, EASE } from "@/lib/motion";

export default function Profile() {
  const router = useRouter();
  const { user, updateUser, signOut } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("");
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setHandle(user.handle ?? "");
    setNiche(user.niche ?? "");
    setBio(user.bio ?? "");
  }, [user]);

  if (!user) return null;

  /* Narrowed alias — the `!user` guard above does not reach into the callbacks. */
  const current = user;
  const initial = (name || current.name || "?").slice(0, 1).toUpperCase();

  function handleSave() {
    updateUser({
      name: name.trim() || current.name,
      email: email.trim() || current.email,
      handle: handle.trim(),
      niche: niche.trim(),
      bio: bio.trim(),
    });
    setSaved(true);
  }

  function handleSignOut() {
    signOut();
    router.push("/");
  }

  return (
    <main className="profile">
      <Reveal as="header" className="profile__head">
        <h1>Profile</h1>
        <p>Name, email, and how you show up. Voice and YouTube live on Settings.</p>
      </Reveal>

      <div className="profile__grid">
        {/* Identity summary — mirrors the live form values. */}
        <Reveal as="section" className="panel profile__card">
          <div className="profile__avatar">
            {current.picture ? <img src={current.picture} alt="" /> : initial}
          </div>
          <div className="profile__id">
            <strong>{name || current.name}</strong>
            <span>{email || current.email}</span>
          </div>
          <dl className="profile__stats">
            <div className="profile__stat">
              <dt>Handle</dt>
              <dd>{handle || "—"}</dd>
            </div>
            <div className="profile__stat">
              <dt>Niche</dt>
              <dd>{niche || "—"}</dd>
            </div>
          </dl>
          {bio ? <p className="profile__bio-preview">{bio}</p> : null}
        </Reveal>

        {/* Editable details. */}
        <Reveal as="section" className="panel profile__form">
          <header className="profile__form-head">
            <h2>Personal information</h2>
            <p>Changes save to this device.</p>
          </header>

          <Stagger className="profile__fields" stagger={0.05}>
            <StaggerItem className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
              />
            </StaggerItem>
            <StaggerItem className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setSaved(false);
                }}
              />
            </StaggerItem>
            <StaggerItem className="field">
              <label htmlFor="handle">Handle</label>
              <input
                id="handle"
                placeholder="@you"
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value);
                  setSaved(false);
                }}
              />
            </StaggerItem>
            <StaggerItem className="field">
              <label htmlFor="niche">Niche</label>
              <input
                id="niche"
                placeholder="Study vlogs, indie games…"
                value={niche}
                onChange={(e) => {
                  setNiche(e.target.value);
                  setSaved(false);
                }}
              />
            </StaggerItem>
            <StaggerItem className="field field--full">
              <label htmlFor="bio">Bio</label>
              <textarea
                id="bio"
                rows={4}
                placeholder="One or two lines Encore can steal for captions."
                value={bio}
                onChange={(e) => {
                  setBio(e.target.value);
                  setSaved(false);
                }}
              />
            </StaggerItem>
          </Stagger>

          <div className="profile__actions">
            <button type="button" className="btn btn--primary" onClick={handleSave}>
              Save changes
            </button>
            <button type="button" className="btn btn--danger" onClick={handleSignOut}>
              Sign out
            </button>
            <AnimatePresence>
              {saved ? (
                <motion.span
                  className="settings__saved"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                >
                  Saved on this device
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </Reveal>
      </div>
    </main>
  );
}
