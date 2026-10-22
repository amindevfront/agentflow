"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/flows" : "/login");
  }, [user, loading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-ink-400">
      Carregando…
    </main>
  );
}
