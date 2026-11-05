import { createContext, useContext, type ReactNode } from "react";
import type { WorkspacePresence } from "./workspace-presence";

// Defaults to focused so components rendered outside a workspace screen keep the
// behavior they had before presence existed.
const WorkspacePresenceContext = createContext<WorkspacePresence>("focused");

export function WorkspacePresenceProvider({
  presence,
  children,
}: {
  presence: WorkspacePresence;
  children: ReactNode;
}) {
  return <WorkspacePresenceContext value={presence}>{children}</WorkspacePresenceContext>;
}

export function useWorkspacePresence(): WorkspacePresence {
  return useContext(WorkspacePresenceContext);
}
