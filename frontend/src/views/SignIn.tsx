"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginPage } from "@/components/ui/sign-in-page";
import { useAuth } from "@/context/AuthContext";

export default function SignIn() {
  const router = useRouter();
  const { user, ready } = useAuth();

  useEffect(() => {
    if (ready && user) {
      router.replace("/home");
    }
  }, [ready, user, router]);

  return <LoginPage mode="signin" />;
}
