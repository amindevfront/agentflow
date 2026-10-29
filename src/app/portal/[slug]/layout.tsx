import type { ReactNode } from "react";
import { WorkspaceProvider } from "@/lib/workspace";

// Portal do Cliente — layout próprio, FORA do grupo `(app)`: não herda o
// AppShell (sidebar/topbar do produto interno). Ainda exige sessão Firebase
// (ver `page.tsx`) e reaproveita o MESMO `WorkspaceProvider` do app
// principal — o portal nunca lê/escreve nada que as regras do Firestore já
// não protejam por `belongsToWorkspace`.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
