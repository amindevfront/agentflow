import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceProvider } from "@/lib/workspace";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
