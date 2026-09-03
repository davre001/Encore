"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { syncGoogleUser } from "@/api/client";
import type { User } from "@/types";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          prompt: (callback?: (notification: unknown) => void) => void;
        };
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

function parseJwt(token: string): User {
  const payload = token.split(".")[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const data = JSON.parse(atob(normalized)) as {
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
  };

  return {
    id: data.sub,
    name: data.name ?? "Creator",
    email: data.email ?? "",
    picture: data.picture,
  };
}

/**
 * Google sign-in, shared by `GoogleSignInButton` and the landing hero CTA so the
 * auth flow is not duplicated per call site. Falls back to a local user when
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset, which is how the app runs on mock data.
 */
export function useGoogleSignIn() {
  const router = useRouter();
  const { signIn } = useAuth();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || document.getElementById("google-gsi")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "google-gsi";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    document.head.appendChild(script);
  }, [clientId]);

  async function finish(user: User) {
    try {
      if (user.email && user.id !== "local") {
        const synced = await syncGoogleUser({
          email: user.email,
          name: user.name,
          picture: user.picture,
          sub: user.id,
        });
        signIn(synced);
        router.push("/home");
        return;
      }
    } catch (e) {
      console.warn("Backend auth sync skipped, continuing with client session", e);
    }
    signIn(user);
    router.push("/home");
  }

  function signInWithGoogle() {
    if (!clientId) {
      finish({
        id: "local",
        name: "Mira Chen",
        email: "mira@encore.app",
        handle: "@mira.studies",
        niche: "Study vlogs",
      });
      return;
    }

    // 1. Prefer Google OAuth2 popup: opens standard Google account chooser directly on button click
    if (window.google?.accounts?.oauth2) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "openid email profile",
        callback: async (tokenRes) => {
          if (tokenRes.error || !tokenRes.access_token) {
            console.error("Google sign in error", tokenRes);
            return;
          }
          try {
            const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${tokenRes.access_token}` },
            });
            const info = (await userRes.json()) as {
              sub: string;
              name?: string;
              email?: string;
              picture?: string;
            };
            finish({
              id: info.sub,
              name: info.name ?? "Creator",
              email: info.email ?? "",
              picture: info.picture,
            });
          } catch (err) {
            console.error("Failed to fetch Google profile", err);
          }
        },
      });
      client.requestAccessToken({ prompt: "select_account" });
      return;
    }

    // 2. Fallback to Google ID Token / One Tap
    if (window.google?.accounts?.id) {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => finish(parseJwt(response.credential)),
      });
      window.google.accounts.id.prompt();
      return;
    }

    finish({
      id: "local",
      name: "Mira Chen",
      email: "mira@encore.app",
      handle: "@mira.studies",
      niche: "Study vlogs",
    });
  }

  return { signInWithGoogle };
}
