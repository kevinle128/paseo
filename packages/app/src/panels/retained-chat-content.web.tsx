import React, { useEffect, useState, type ReactNode } from "react";
import { Freeze } from "react-freeze";
import { useRetainedPanelActive, useRetainedPanelKeepsLayout } from "@/components/retained-panel";

/**
 * Web only: suspends a hidden chat so its subscribers stop rendering while the
 * model keeps streaming. DOM nodes have no Fabric ownership to lose, so
 * suspension is safe here; native keeps the subtree live (see the base file).
 *
 * A chat whose panel keeps its layout is not frozen: the suspense boundary
 * would hide it with `display: none` and throw that layout away. Such a chat
 * belongs to a grid cell parked behind a maximized cell, whose timeline is
 * suspended, so it gets few updates.
 */
export function RetainedChatContent({ children }: { children: ReactNode }) {
  const active = useRetainedPanelActive();
  const keepsLayout = useRetainedPanelKeepsLayout();
  const freezable = !active && !keepsLayout;
  const [frozen, setFrozen] = useState(freezable);
  // First let visibility-gated queries and animations receive active=false.
  // The following commit freezes every chat subscriber while the model keeps streaming.
  useEffect(() => setFrozen(freezable), [freezable]);
  return <Freeze freeze={freezable && frozen}>{children}</Freeze>;
}
