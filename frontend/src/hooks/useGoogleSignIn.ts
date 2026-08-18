"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
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
          prompt: () => void;
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

  function finish(user: User) {
    signIn(user);
    router.push("/home");
  }

  function signInWithGoogle() {
    if (clientId && window.google) {
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
