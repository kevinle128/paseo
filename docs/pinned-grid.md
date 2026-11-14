# Pinned grid

The pinned grid shows every pinned workspace side by side, each cell a full workspace. It exists on web and Electron in a non-compact layout only (`supportsGrid` in `packages/app/src/screens/workspace/workspace-deck.tsx:92`). Native and compact layouts always show one workspace. Read this before touching the workspace deck, `WorkspaceScreen` gates, or anything that subscribes to agent streams.

## The grid is a presentation of the deck, not a route

The grid is a style on the existing workspace deck. The route is still `/h/:serverId/workspace/:workspaceId`, and it names the focused cell.

A second route or a second deck would mount a workspace twice. Floating panels, keyboard handlers and the document title all assume one live mount per workspace, so duplicates break them. Route ownership is in [expo-router.md](expo-router.md).

- One render loop. `WorkspaceDeck` maps every retained entry once (`workspace-deck.tsx:293`) in both presentations. `resolveDeckPresentation` (`packages/app/src/pinned-grid/presentation.ts:26`) only chooses `single` or `grid`.
- One stable wrapper per entry. `GridCellFrame` (`packages/app/src/pinned-grid/grid-cell-frame.tsx:35`) switches between `flex: 1` and an absolute rect. Nothing above the workspace changes type, so switching Normal, grid and focus mode never remounts a workspace. `packages/app/e2e/browser/pinned-grid-deck.spec.ts` proves it with DOM marks. Keep that property when you add a wrapper.
- Each entry reads its own host through `HostRouteProvider` (`workspace-deck.tsx:455`), not the host of the route that renders the deck. `packages/app/e2e/browser/workspace-deck-cross-host-retention.spec.ts` covers a second host.
- The grid shows only while the active workspace is pinned. Opening an unpinned workspace leaves the grid.
- Unpinning the focused cell keeps the grid. The cell leaves and focus moves to the cell after it in the previous order, or the one before it when it was last (`resolveFocusAfterCellRemoval`, `packages/app/src/pinned-grid/focus-after-removal.ts`). `useFocusAfterCellRemoval` hands the deck that neighbor as the active workspace in the same render, so the single layout never shows, then moves the route with `focusWorkspaceCell`. With no pinned workspace left, the unpinned workspace shows alone.
- Focus mode shows one cell, but the other pinned cells stay retained so leaving it brings the grid back without a remount (`workspace-deck.tsx:118-130`).

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

`isPresented` feeds `RetainedPanel active` (`workspace-deck.tsx:475`), so it decides what renders. `ownsInput` decides who gets keyboard handlers, the document title, and the per-host focused agent and terminal slots. In Normal mode the two are equal, which is why single mode behaves as it did before the grid.

Classify a new gate by what it protects:

- Keeps data live or renders something: read `isPresented`. A reduced cell still needs its terminal stream, its queries and its tab reconcile.
- Claims something there is one of per window or per host (keyboard, title, focused id, a modal): read `ownsInput`.

`WorkspaceScreen` reads both from one prop (`workspace-screen.tsx:1049-1050`). `terminal-pane.tsx:303` is a gate that needs both.

## Focus

A click or DOM focus inside a cell focuses it in the same commit, before the next key. `GridCellFrame` listens in the capture phase and never calls `preventDefault`, so the click still reaches its target. A user who clicks a cell and presses Shift+Tab or Escape acts on that cell's agent.

The route follows through `focusWorkspaceCell` (`packages/app/src/stores/navigation-active-workspace-store/navigation.ts:115`), which only moves the route. `navigateToWorkspace` also opens the attention agent's tab and reveals panels, so using it would change what a visible cell shows. A sidebar press on a pinned row while a grid mode shows does the same: it focuses the cell and scrolls it into view (`resolveSidebarWorkspacePress`, `packages/app/src/pinned-grid/sidebar-workspace-press.ts:14`), because the full navigation can change what a visible cell shows. Any other route change from outside the grid is mirrored back into the grid state (`packages/app/src/pinned-grid/use-grid-focus.ts:33`).

### Keyboard navigation

`Cmd+Arrow` (macOS) or `Ctrl+Arrow` (Windows and Linux) moves the grid focus to the neighbor cell, from a cell frame, a non-interactive part of a cell, or the composer. Plain arrows keep their normal meaning. With the focus on a cell frame, Enter focuses the composer of the focused cell. The neighbor math is `resolveGridNeighbor` (`packages/app/src/pinned-grid/grid-navigation.ts`): row-major order, no wrap, and Down from a cell that has no cell below goes to the last cell of the next row. The move also scrolls the cell into view (`requestCellReveal`) and puts DOM focus on its frame. The keys do nothing while a cell is maximized, and when the focused cell has no neighbor in that direction they keep their text-editing meaning.

The move bindings use `focusScope: ["message-input", "terminal", "other"]`, so other text fields and browser panes keep their keys. Inside a grid composer or terminal the keys replace the line start and end moves (`Cmd+Left` and `Cmd+Right` on macOS) and the word jumps (`Ctrl+Left` and `Ctrl+Right` on Windows and Linux); `Cmd/Ctrl+Up` and `Down` replace the jump to the start and end of the text. A terminal in a grid cell loses the same moves (macOS line start and end, Windows and Linux word jumps). The app listens in the capture phase and stops a claimed key before xterm sees it, so the terminal runtime needs no grid flag. When the handler does not act (Normal mode, maximized cell, no neighbor), the key reaches xterm and keeps its terminal meaning. A move from a terminal does not hand a caret to the target cell. In Normal mode the handler is off, so the composer and the terminal keep those moves. The Enter binding uses `focusScope: "other"`. The handlers also return false while a button, link or other control has DOM focus, so Enter still activates it. The Enter binding sits before dictation confirm in the table, because the first match wins. Its handler passes the key on to dictation confirm when the grid does not act.

A move that starts in a composer keeps the user typing. The draft of the cell left behind stays in the draft store (`packages/app/src/composer/draft/input-draft.ts`), which is keyed per composer, so coming back to that cell continues where the user stopped. The target composer takes the caret at the end of its draft and expands as it does on focus (`focusAtEnd`). The new cell is not focused yet when the key runs, so `packages/app/src/pinned-grid/composer-focus-request.ts` holds a one-second request that the composer of the new cell takes once it is active. A move that starts on the cell frame only moves the cell focus.

### First-click guard

A press that moved focus into a cell only focuses it. The claim lasts for the whole pointer gesture: a key pressed between pointer-down and release does not clear it, so a press that began on an unfocused cell never acts. Keyboard activation acts only in a cell that was already focused. Controls with consequences go through `useGuardedCellPress` and act on the next press (`packages/app/src/pinned-grid/cell-press-guard.ts`). That covers permission Allow and Deny, plan approval, the question card's Dismiss and final Submit (`packages/app/src/agent-stream/view.tsx`, `packages/app/src/components/question-form-card.tsx`), and the composer's Stop, voice mode, dictation and Send (`packages/app/src/composer/input/input.tsx`, `packages/app/src/composer/index.tsx`). The collapsed composer shows its whole toolbar, so without the guard the click that selects a cell could stop an agent or start voice. Wrap any new consequential control the same way.

In a grid cell the composer never takes focus on its own and never restores it, maximized or not (`isGridCell`, `packages/app/src/pinned-grid/composer-density.ts:16`). A collapsed composer keeps its toolbar and shows the placeholder text inline in place of the editor. A press on the placeholder expands the composer and focuses the editor with the caret at the end, in one click and even in an unfocused cell. This is the one exception to "a click that only selects a cell must not move the caret". A press anywhere else on the cell only selects it, and maximizing then restoring must not leave a full composer behind.

Escape in a cell composer leaves it: the first press moves focus to the cell frame and collapses the composer when it has no draft or attachment, and the second press interrupts the agent. With the autocomplete list open, Escape only closes the list.

Every cell follows the newest message until the reader scrolls up, focused or not. Scrolling up stops following and shows the scroll-to-bottom button. Losing focus, pointer leave and showing a hidden cell again keep that position. Scrolling back within the button's hide distance (64 px) or pressing the button resumes following (`packages/app/src/agent-stream/strategy-web.tsx`).

## Order

Grid and sidebar Pinned section list pinned workspaces in one order, `useSidebarOrderStore` (`packages/app/src/stores/sidebar-order-store.ts:155`), read through `orderPinnedWorkspaceKeys` (`packages/app/src/pinned-grid/pinned-order.ts:29`). It is client-local: it spans hosts, no daemon owns it, and grid mode is a per-device choice, so it is not synced across devices.

A new pin goes first on every platform, in Normal mode and in the grid.

- Web and Electron use "new pins first" at every width: the pins that are not in the stored order, newest first, then the stored keys that are still pinned, in stored order. Ties are ordered by key. The rule follows the platform, never the compact breakpoint, because a rule tied to the breakpoint would reorder the sidebar when the window resizes (`resolvePinnedOrderRule`, `pinned-order.ts:17`).
- Native uses the recency rule: newest pin first, with the stored order laid over it. It gives the same result for a new pin.
- A local pin drops a stale stored key first, on every platform, so a re-pin lands first and not in its old slot (`removePinnedOrderKey`, `packages/app/src/pinned-grid/pinned-order-seed.ts`). Prune is web only, so on native an unpin made on another device keeps a stale key until the next local pin of that workspace.
- Every pin of a host that loads after the seed is unstored, so a newly added host shows its pins first, newest first.
- Reorder writers save the order the user sees, an unstored new pin included, so a drag of other rows keeps the new pin first.
- A first-run seed freezes the order the user sees today, so switching rules moves no row (`packages/app/src/pinned-grid/pinned-order-seed.ts`). The seed flag lives in its own store (`packages/app/src/stores/pinned-order-seed-store.ts`), not in the order store, so the order store keeps its version and a downgrade loses nothing. One condition gates every seed path, the reconciler and the local pin or unpin: each registered host must have a loaded directory, either a live snapshot or one restored from cache. A host that is offline without a cache blocks the seed, and a local pin or unpin then drops its key without seeding. The seed keeps stored keys it does not know and is the only writer of the flag.
- Prune removes only keys whose workspace is loaded and unpinned, because "hydrated" can mean one merged workspace. A device that was offline for both an unpin and a re-pin keeps the old slot.
- A drop merges the new order with the stored remainder, so keys of an offline host survive (`packages/app/src/pinned-grid/use-grid-cell-slots.ts:37`).

Pins that exist when the app loads are seeded newest first. A test that needs a known order pins after the app loaded, in reverse of the order it expects.

## Add cell and reorder

The "+" tile is the last slot while the grid shows. It is a geometry slot, not an entry, so retention, presence, focus and the dormant layer never see it. It does not show with no pins, and it is hidden while a cell is maximized (`GridDeckTail`, `workspace-deck.tsx:372`).

The picker is `Combobox` with `preserveOptionOrder`, so the list keeps the sidebar's project grouping (`packages/app/src/pinned-grid/add-pin-picker.tsx`). Its content mounts only while open, because the sidebar list hook keeps projecting while mounted, even when disabled. Combobox positions the popover once and does not follow scrolling, so the picker closes when the grid scrolls, stays open when the cell list changes (a pin made on another device) so the search is kept, and anchors to a strip near the top of the tile, which keeps the list inside the window for a tile in the last row. Focus after a pick waits for the pin to show up and yields to any focus change the user makes first (`packages/app/src/pinned-grid/pending-pin-focus.ts`). The picked workspace lands in the first slot, so the grid scrolls smoothly to the top while focus moves to it. The pick marks the reveal as smooth just before the route changes (`markSmoothReveal`, `packages/app/src/pinned-grid/cell-reveal-request.ts:31`). The mark is one-shot and expires after 1.5 s, so a later sidebar click on the same cell still jumps. Reduced motion jumps too. Only the route change scrolls: a second reveal during the smooth scroll would read a mid-scroll offset and jump.

A header drag reorders cells (`packages/app/src/pinned-grid/use-grid-reorder-drag.ts`):

- Mouse only, past a 6 px threshold (`HEADER_DRAG_THRESHOLD_PX`), so a double-click still maximizes. The header press is observed and never prevented.
- One `cancel()` serves every exit: pointer cancel, lost capture, window blur, the cell leaving the grid, unmount and Escape. Add new exits there.
- The preview changes slots only. The store is written once, on drop, so the sidebar updates on drop and not during the drag. A drop that changes nothing writes nothing.
- The click that ends a drag is swallowed, so releasing over a control does not press it.

## Fidelity of a reduced cell

A reduced cell is not paced and not live per event. Two rules apply.

- The gate is inside the selector. `useFidelityGatedSelector` (`packages/app/src/agent-stream/use-agent-stream-tail.ts:15`) returns the last delivered value, so store writes schedule no render at all. A gate in a component would still pay the selector and the render. Gate new per-event subscriptions the same way. Subscriptions that change per turn or per permission are not gated, so permission cards never lag.
- One clock serves every reduced cell (`packages/app/src/pinned-grid/reduced-fidelity-clock.ts:15`): a 250 ms period cut into slots, so one wake renders one or two cells instead of all of them. The clock has no timer while no cell listens.

`useRevealedText` shows committed text whole in a reduced cell (`packages/app/src/hooks/use-revealed-text.ts:28`), because a paced reveal needs a frame loop per cell. How the pacing works is in [agent-stream-performance.md](agent-stream-performance.md).

A cell is `reduced` inside the viewport plus a 25% margin and turns `hidden` after 2 s off screen (`packages/app/src/pinned-grid/cell-presence.ts:5-7`). The delay stops scroll thrash from tearing down streams. The scroll offset is never React state; presences recompute on one frame-throttled handler. The scroll layer keeps the offset on the grid scroll signal (`getScrollTop`, `packages/app/src/pinned-grid/grid-scroll-signal.tsx`), and the motion and presence code read it there. A `scrollTop` read in render or in a layout effect forces a layout of the whole deck.

## Hidden cells and the timeline

A hidden cell releases its chats from the timeline subscription so the daemon stops streaming them. `suspendSource` and `resumeSource` (`packages/app/src/timeline/viewed-timeline-sync.ts:345-347`) remove a source's chats from desired membership and bring them back through the normal catch-up. This is the one exception to the rule that an opened chat stays subscribed while it is hidden. The opened set is untouched, so closing a tab still removes a chat for good. A chat another source shows stays subscribed. The cell calls it from `workspace-deck.tsx:470`. A maximize or restore does not suspend or resume in the middle of the motion: a cell under a maximize suspends after its fade, and a restored cell resumes 300 ms after the restore starts (`useSettledCellSuspension`, `packages/app/src/pinned-grid/use-settled-cell-suspension.ts`). Scroll and Normal mode keep the immediate timing.

The set a cell suspends comes from its pane layout and its sheet tabs (`packages/app/src/pinned-grid/use-cell-timeline-suspension.ts:21`). A chat open only in a sheet still streams, so leaving sheets out leaves a hidden cell subscribed. A hidden cell whose workspace unmounts stays suspended while its dormant card shows. The deck ends that suspension when the cell leaves the grid or the deck unmounts (`useReleaseUnmountedCellSuspensions`). A terminal in a hidden cell releases its output stream through the same presented gate.

## Retention and the dormant card

Mounted pinned cells are capped at 12 (`WORKSPACE_DECK_MAX_MOUNTED_GRID_CELLS`, `packages/app/src/screens/workspace/workspace-deck-retention.ts:9`). Only `hidden` cells are dropped, farthest first. `focused` and `reduced` cells are never dropped, so a grid with more than 12 cells on screen mounts all of them. Pinned cells have no TTL. The cap never shrinks a mounted set in one pass, so closing the grid keeps its entries. Unpinned workspaces keep the earlier limit of 10 and the 10 minute TTL.

A dropped cell draws a dormant card (`packages/app/src/pinned-grid/dormant-cell-summary.tsx`). It reads the workspace descriptor and `session.agents` only and holds no timeline subscription. Its state is the most urgent bucket over every non-archived agent of the workspace, so a permission request on a subagent shows. Because an on-screen cell is never evicted, a card shows only after a scroll jump past the overscan margin.

## Maximize

Maximize is the header button, a header double-click (`packages/app/src/pinned-grid/use-header-maximize-double-click.ts:14`), `Cmd/Ctrl+Shift+Enter`, or `Cmd/Ctrl+=` (also `Cmd/Ctrl+Shift+=`, the "+" key). `Cmd/Ctrl+-` restores. The bindings are in `packages/app/src/keyboard/keyboard-shortcuts.ts`. They resolve in every layout, because the resolver has no grid flag. The handlers in `use-grid-focus.ts` are enabled only while a grid shows, so Normal mode leaves the keys unclaimed. While a grid shows they claim the keys even when there is nothing to maximize or restore: plain web then never zooms the page, and Electron turns off the Zoom In and Zoom Out menu items through `paseo:menu:set-grid-zoom-keys`, so the keys reach the renderer. Cmd/Ctrl+0 keeps working.

Maximize and restore animate over 240 ms (`useCellMotion`, `packages/app/src/pinned-grid/use-cell-motion.ts`). Only a change of `isMaximized` animates, so divider drags, window resizes and the first mount stay instant. The motion animates only `transform`, so it runs on the compositor and main-thread work during it does not drop frames. Do not animate `clip-path` here: Chromium can run an `inset() round` clip on the main thread, and with a transform in the same animation it has known bugs.

- The cell lays out at its final rect once, at the start, and a FLIP transform draws it over its old rect and moves it to identity (`buildFlipKeyframes`, `packages/app/src/pinned-grid/cell-transition.ts`). Maximize lays out at the full rect. Restore lays out at the slot at once, so the content reflows at the start and shows scaled up for the motion, with no jump at the end. The other choice, holding the large layout and shrinking it, stays sharp but jumps at the end. The content stretches while it moves, because the scale is not uniform.
- The other cells fade with opacity and transform. A cell that was on screen when the maximize started is parked: it keeps its layout under `visibility: hidden` and `content-visibility: hidden` instead of `display: none`, and its `RetainedPanel` uses `keepLayout` (`useParkedCell`). A parked chat does not freeze, because React hides a frozen subtree with `display: none` (`packages/app/src/panels/retained-chat-content.web.tsx`). A cell that was off screen stays `display: none`.
- A parked cell keeps the `reduced` presence it had, so neither the end of the fade nor the restore renders its workspace again. Only the frame hides it. Its queries stay live and it follows the reduced-fidelity clock while the maximize lasts. Its timeline subscription follows the real presence, and `CellSuspensionProvider` (`packages/app/src/pinned-grid/cell-suspension-context.tsx`) releases its terminal stream and empties its visible-chat source, so after the fade only the maximized cell holds a subscription. Electron webviews in a parked frame stay held.
- Dividers, dormant cards and the "+" tile stay mounted while a cell is maximized and hide with `display: none` (`MaximizeHiddenLayer`, `packages/app/src/pinned-grid/maximize-hidden-layer.tsx`). An unmount and a mount drop and add unistyles classes, and each class change rewrote the whole stylesheet in the commit.
- Unistyles is patched on web (`patches/react-native-unistyles+3.2.4.patch`): a new class goes in with `insertRule` on a second sheet, and a removed class keeps its rules, because its name is a hash of its values. The whole stylesheet is rewritten only for child selectors and when the second sheet is full. Without the patch, one new class in the maximize commit restyles the whole document. Never rewrite on a timer: it restyles the document in the middle of a drag, which `e2e/browser/explorer-resize-performance.spec.ts` checks. Check the patch when unistyles is upgraded.
- The deck does not scroll while a cell is maximized. Parked cells still extend the scroll range, and a classic scrollbar on Windows would narrow the viewport and lay out every cell again.
- An Electron browser webview is fixed-position and cannot follow the transform, and `getBoundingClientRect()` during the motion would size its page to an in-between rect. The moving frame carries `BROWSER_SURFACES_HELD_ATTRIBUTE` for the length of the motion, and a webview anchored inside it stays hidden (`packages/app/src/desktop/browser/resident-webviews.ts`). The settle `layout` signal places it again at the final rect (`use-grid-cell-slots.ts`).

Escape is not a maximize key. Outside the composer it stays `agent.interrupt`, also in a maximized cell, because that is where the user is most likely to be interrupting a running agent. In the composer of a grid cell the first Escape leaves the composer and puts DOM focus on the cell frame (`leaveGridCellComposer`, `packages/app/src/composer/index.tsx`), even while the agent runs. The second Escape then interrupts. A running dictation is cancelled first. The one other exception is a header drag: while it runs, Escape cancels the drag and the cell returns to its slot. The handler outranks the composer's interrupt handler and is enabled only during a drag (`DRAG_CANCEL_PRIORITY`, `packages/app/src/pinned-grid/use-grid-reorder-drag.ts:17`), because a user who holds a cell and presses Escape means the drag. A maximized cell is the only `focused` cell. Every other cell is `hidden`, except parked cells, which stay `reduced` behind the frame.

## Electron

- A cell header has no `TitlebarDragRegion` (`screen-header.tsx:92`). A drag region would turn every cell header into a window drag handle and make its double-click zoom the window instead of maximizing the cell. The window controls belong to the corner cells (`resolveCellChromeCorners`, `packages/app/src/pinned-grid/grid-layout.ts`).
- Browser `<webview>` surfaces and the fullscreen composer are fixed-position, so scrolling the grid does not move them. While the grid shows they clip to its viewport and are placed again on every scroll (`packages/app/src/pinned-grid/use-grid-fixed-surfaces.electron.ts:13`). Dimming does not reach a webview, because it sits above the DOM.

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
