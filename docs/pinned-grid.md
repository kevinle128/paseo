# Pinned grid

The pinned grid shows every pinned workspace side by side, each cell a full workspace. It exists on web and Electron in a non-compact layout only (`supportsGrid` in `packages/app/src/screens/workspace/workspace-deck.tsx:82`). Native and compact layouts always show one workspace. Read this before touching the workspace deck, `WorkspaceScreen` gates, or anything that subscribes to agent streams.

## The grid is a presentation of the deck, not a route

The grid is a style on the existing workspace deck. The route is still `/h/:serverId/workspace/:workspaceId`, and it names the focused cell.

A second route or a second deck would mount a workspace twice. Floating panels, keyboard handlers and the document title all assume one live mount per workspace, so duplicates break them. Route ownership is in [expo-router.md](expo-router.md).

- One render loop. `WorkspaceDeck` maps every retained entry once (`workspace-deck.tsx:252-285`) in both presentations. `resolveDeckPresentation` (`packages/app/src/pinned-grid/presentation.ts:26`) only chooses `single` or `grid`.
- One stable wrapper per entry. `GridCellFrame` (`packages/app/src/pinned-grid/grid-cell-frame.tsx:35`) switches between `flex: 1` and an absolute rect. Nothing above the workspace changes type, so switching Normal, grid and focus mode never remounts a workspace. `packages/app/e2e/browser/pinned-grid-deck.spec.ts` proves it with DOM marks. Keep that property when you add a wrapper.
- Each entry reads its own host through `HostRouteProvider` (`workspace-deck.tsx:360`), not the host of the route that renders the deck. `packages/app/e2e/browser/workspace-deck-cross-host-retention.spec.ts` covers a second host.
- The grid shows only while the active workspace is pinned. Opening an unpinned workspace leaves the grid.
- Unpinning the focused cell keeps the grid. The cell leaves and focus moves to the cell after it in the previous order, or the one before it when it was last (`resolveFocusAfterCellRemoval`, `packages/app/src/pinned-grid/focus-after-removal.ts`). `useFocusAfterCellRemoval` hands the deck that neighbor as the active workspace in the same render, so the single layout never shows, then moves the route with `focusWorkspaceCell`. With no pinned workspace left, the unpinned workspace shows alone.
- Focus mode shows one cell, but the other pinned cells stay retained so leaving it brings the grid back without a remount (`workspace-deck.tsx:99-114`).

## Cell size

`computeGridGeometry` (`packages/app/src/pinned-grid/geometry.ts`) sizes cells from the measured deck.

- Columns fill the width by the stored column ratios.
- One screen shows at most 2 rows (`MAX_VISIBLE_ROWS`), or 1 row when 2 rows of 300 px do not fit. A tall screen makes cells taller instead of adding rows. Rows after the first two scroll.
- Stored row scales are relative weights. They share the rows' total height and never change it, so a drag cannot push the grid off screen. A row divider moves height between the two rows next to it. Weights stored for a different row count are ignored, as column ratios are. A double-click on a divider resets it.

## Workspace presence

Every mounted workspace has a presence (`packages/app/src/screens/workspace/workspace-presence.ts:9`):

| Presence  | On screen | Owns input | Meaning                                        |
| --------- | --------- | ---------- | ---------------------------------------------- |
| `focused` | yes       | yes        | The route's workspace. One per grid.           |
| `reduced` | yes       | no         | Visible or near the viewport. Live, throttled. |
| `hidden`  | no        | no         | Mounted, drawing nothing.                      |

`isPresented` feeds `RetainedPanel active` (`workspace-deck.tsx:377`), so it decides what renders. `ownsInput` decides who gets keyboard handlers, the document title, and the per-host focused agent and terminal slots. In Normal mode the two are equal, which is why single mode behaves as it did before the grid.

Classify a new gate by what it protects:

- Keeps data live or renders something: read `isPresented`. A reduced cell still needs its terminal stream, its queries and its tab reconcile.
- Claims something there is one of per window or per host (keyboard, title, focused id, a modal): read `ownsInput`.

`WorkspaceScreen` reads both from one prop (`workspace-screen.tsx:1041-1042`). `terminal-pane.tsx:304` is a gate that needs both.

## Focus

A click or DOM focus inside a cell focuses it in the same commit, before the next key. `GridCellFrame` listens in the capture phase and never calls `preventDefault`, so the click still reaches its target. A user who clicks a cell and presses Shift+Tab or Escape acts on that cell's agent.

The route follows through `focusWorkspaceCell` (`packages/app/src/stores/navigation-active-workspace-store/navigation.ts:134`), which only moves the route. `navigateToWorkspace` also opens the attention agent's tab and reveals panels, so using it would change what a visible cell shows. A route change from outside the grid (a sidebar click) is mirrored back into the grid state (`packages/app/src/pinned-grid/use-grid-focus.ts:29`).

### First-click guard

A press that moved focus into a cell only focuses it. The claim lasts for the whole pointer gesture: a key pressed between pointer-down and release does not clear it, so a press that began on an unfocused cell never acts. Keyboard activation acts only in a cell that was already focused. Controls with consequences, permission Allow and Deny, plan approval, and the question card's Dismiss and final Submit, go through `useGuardedCellPress` and act on the next press (`packages/app/src/pinned-grid/cell-press-guard.ts`, callers in `packages/app/src/agent-stream/view.tsx` and `packages/app/src/components/question-form-card.tsx`). Without it, a click that only meant to select a cell could approve a tool call or answer a question. Wrap any new consequential control the same way.

The slim send button of an idle cell composer is not one of these controls in practice. The line is slim only while there is nothing to send, so the button is disabled and visual: pressing the line expands the composer, and sending happens from the full composer. The button still uses the guard so a future enabled state cannot send on a focusing click.

## Fidelity of a reduced cell

A reduced cell is not paced and not live per event. Two rules apply.

- The gate is inside the selector. `useFidelityGatedSelector` (`packages/app/src/agent-stream/use-agent-stream-tail.ts:15`) returns the last delivered value, so store writes schedule no render at all. A gate in a component would still pay the selector and the render. Gate new per-event subscriptions the same way. Subscriptions that change per turn or per permission are not gated, so permission cards never lag.
- One clock serves every reduced cell (`packages/app/src/pinned-grid/reduced-fidelity-clock.ts:14`): a 250 ms period cut into slots, so one wake renders one or two cells instead of all of them. The clock has no timer while no cell listens.

`useRevealedText` shows committed text whole in a reduced cell (`packages/app/src/hooks/use-revealed-text.ts:29`), because a paced reveal needs a frame loop per cell. How the pacing works is in [agent-stream-performance.md](agent-stream-performance.md).

A cell is `reduced` inside the viewport plus a 25% margin and turns `hidden` after 2 s off screen (`packages/app/src/pinned-grid/cell-presence.ts:5-7`). The delay stops scroll thrash from tearing down streams. The scroll offset is never React state; presences recompute on one frame-throttled handler.

## Hidden cells and the timeline

A hidden cell releases its chats from the timeline subscription so the daemon stops streaming them. `suspendSource` and `resumeSource` (`packages/app/src/timeline/viewed-timeline-sync.ts:344-346`) remove a source's chats from desired membership and bring them back through the normal catch-up. This is the one exception to the rule that an opened chat stays subscribed while it is hidden. The opened set is untouched, so closing a tab still removes a chat for good. A chat another source shows stays subscribed. The cell calls it from `workspace-deck.tsx:348`.

The set a cell suspends comes from its pane layout and its sheet tabs (`packages/app/src/pinned-grid/use-cell-timeline-suspension.ts:21`). A chat open only in a sheet still streams, so leaving sheets out leaves a hidden cell subscribed. A hidden cell whose workspace unmounts stays suspended while its dormant card shows. The deck ends that suspension when the cell leaves the grid or the deck unmounts (`useReleaseUnmountedCellSuspensions`). A terminal in a hidden cell releases its output stream through the same presented gate.

## Retention and the dormant card

Mounted pinned cells are capped at 12 (`WORKSPACE_DECK_MAX_MOUNTED_GRID_CELLS`, `packages/app/src/screens/workspace/workspace-deck-retention.ts:9`). Only `hidden` cells are dropped, farthest first. `focused` and `reduced` cells are never dropped, so a grid with more than 12 cells on screen mounts all of them. Pinned cells have no TTL. The cap never shrinks a mounted set in one pass, so closing the grid keeps its entries. Unpinned workspaces keep the earlier limit of 10 and the 10 minute TTL.

A dropped cell draws a dormant card (`packages/app/src/pinned-grid/dormant-cell-summary.tsx`). It reads the workspace descriptor and `session.agents` only and holds no timeline subscription. Its state is the most urgent bucket over every non-archived agent of the workspace, so a permission request on a subagent shows. Because an on-screen cell is never evicted, a card shows only after a scroll jump past the overscan margin.

## Maximize

Maximize is the header button, a header double-click (`packages/app/src/components/headers/screen-header.tsx:50-66`), or `Cmd/Ctrl+Shift+Enter` (`packages/app/src/keyboard/keyboard-shortcuts.ts:1037-1053`). It is not Escape. Escape is `agent.interrupt` (`keyboard-shortcuts.ts:1172-1174`), and a maximized cell is where the user is most likely to be interrupting a running agent. A maximized cell is the only `focused` cell and every other cell is `hidden`.

## Electron

- A cell header has no `TitlebarDragRegion` (`screen-header.tsx:93`). A drag region would turn every cell header into a window drag handle and make its double-click zoom the window instead of maximizing the cell. The window controls belong to the corner cells (`resolveCellChromeCorners`, `packages/app/src/pinned-grid/grid-layout.ts`).
- Browser `<webview>` surfaces and the fullscreen composer are fixed-position, so scrolling the grid does not move them. While the grid shows they clip to its viewport and are placed again on every scroll (`packages/app/src/pinned-grid/use-grid-fixed-surfaces.electron.ts:9`). Dimming does not reach a webview, because it sits above the DOM.

## Performance

The target is 15 pinned workspaces, all streaming, in 3 columns at 2560x1440. The load test is `packages/app/e2e/browser/pinned-grid-performance.spec.ts`, with helpers in `packages/app/e2e/support/helpers/grid-performance.ts`. Its budgets:

- Keystroke to paint, p95 at most 33 ms.
- Frame interval, p95 at most 16.7 ms.
- No long task over 250 ms, and at most one over 100 ms per 10 s.
- A reduced cell at most 500 ms stale.
- Hidden cells hold zero timeline subscriptions.
- JS heap growth at most 20% over 60 s.

Run one scenario at a time from `packages/app`:

```bash
E2E_METRO_BUNDLE=production E2E_BROWSER_CHANNEL=chromium PASEO_PINNED_GRID_PERF_E2E=1 \
  PASEO_PINNED_GRID_PERF_SCENARIO=idle npx playwright test e2e/browser/pinned-grid-performance.spec.ts \
  --project=browser > /tmp/pinned-grid-perf.txt 2>&1
```

`PASEO_PINNED_GRID_PERF_SCENARIO` takes `idle`, `typing`, `scroll`, `focus`, `staleness` or `hidden`. The spec header lists the diagnostic switches (CPU profile, trace, render profile). `E2E_METRO_BUNDLE` and `E2E_BROWSER_CHANNEL` are harness-wide and described in [testing.md](testing.md).

What to know before you trust a number:

- Frame time follows machine load more than code. The same bundle gave a 10 ms p95 on a quiet machine and 25 to 42 ms on a loaded one. Take gate numbers on a quiet machine.
- Use a production bundle. The dev bundle is several times slower and the React Profiler is a no-op in production, so use the dev bundle only for render counts.
- Leave video off. Recording video roughly doubles frame time, and the spec turns it off.
- The default headless shell has a software rasterizer, which makes scrolling look worse than it is. `E2E_BROWSER_CHANNEL=chromium` uses GPU raster.
- Most remaining cost is outside the grid: per-event store writes that run every subscriber's selector, markdown parsing of the streaming message, and forced layout reads in the stream viewport. A change there helps Normal mode too.

`packages/app/e2e/browser/pinned-grid-screenshots.spec.ts` captures the pictures a pull request needs. It runs only with `PASEO_PINNED_GRID_QA_SCREENSHOTS=1` and writes to the directory in `PASEO_PINNED_GRID_QA_DIR`.
