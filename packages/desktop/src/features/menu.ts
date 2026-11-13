import { app, Menu, BrowserWindow, ipcMain } from "electron";
import { getActivePaseoBrowserWebContentsForHostWindow } from "./browser-webviews/index.js";

interface ShowContextMenuInput {
  kind?: "terminal";
  hasSelection?: boolean;
}

interface ApplicationMenuOptions {
  onNewWindow: () => void;
}

function withBrowserWindow(
  callback: (win: BrowserWindow) => void,
): (_item: Electron.MenuItem, baseWin: Electron.BaseWindow | undefined) => void {
  return (_item, baseWin) => {
    const win = baseWin instanceof BrowserWindow ? baseWin : BrowserWindow.getFocusedWindow();
    if (win) callback(win);
  };
}

interface ReloadableWebContents {
  isLoadingMainFrame(): boolean;
  stop(): void;
  reload(): void;
  reloadIgnoringCache(): void;
}

interface ReloadableWindow {
  webContents: ReloadableWebContents & { id: number };
}

interface ReloadActiveBrowserOrWindowInput {
  win: ReloadableWindow;
  getActiveBrowserContentsForHostWindow: (
    hostWebContentsId: number,
  ) => ReloadableWebContents | null;
  ignoreCache?: boolean;
}

export function reloadActiveBrowserOrWindow({
  win,
  getActiveBrowserContentsForHostWindow,
  ignoreCache = false,
}: ReloadActiveBrowserOrWindowInput): void {
  const browserContents = getActiveBrowserContentsForHostWindow(win.webContents.id);
  if (browserContents) {
    if (ignoreCache) {
      browserContents.reloadIgnoringCache();
      return;
    }
    if (browserContents.isLoadingMainFrame()) {
      browserContents.stop();
      return;
    }
    browserContents.reload();
    return;
  }

  if (ignoreCache) {
    win.webContents.reloadIgnoringCache();
    return;
  }
  win.webContents.reload();
}

/**
 * Zoom In and Zoom Out stay off while a shortcut is being recorded and while a pinned grid shows,
 * because both need Cmd/Ctrl +, = and - to reach the renderer.
 */
export function resolveZoomEnabled(input: {
  capturingShortcut: boolean;
  gridZoomKeys: boolean;
}): boolean {
  return !input.capturingShortcut && !input.gridZoomKeys;
}

/**
 * Counts the grid-zoom claims of each window. A window can hold several claims (stacked decks), so
 * the claim stays until the last holder releases it. Menu state is process-wide, so the caller
 * reads the claim of the focused window only.
 */
export class GridZoomClaims {
  private readonly counts = new Map<number, number>();

  public add(windowId: number): void {
    this.counts.set(windowId, (this.counts.get(windowId) ?? 0) + 1);
  }

  /** Drops one claim. Returns true when the window still holds none afterwards and held one before. */
  public release(windowId: number): boolean {
    const count = this.counts.get(windowId);
    if (count === undefined) {
      return false;
    }
    if (count <= 1) {
      this.counts.delete(windowId);
      return true;
    }
    this.counts.set(windowId, count - 1);
    return false;
  }

  /** Drops every claim of a window. Returns true when the window held any. */
  public clear(windowId: number): boolean {
    return this.counts.delete(windowId);
  }

  public has(windowId: number | null | undefined): boolean {
    return windowId !== null && windowId !== undefined && this.counts.has(windowId);
  }
}

interface NavigationDetails {
  isMainFrame: boolean;
  isSameDocument: boolean;
}

interface ClaimWindow {
  webContents: {
    id: number;
    on(event: "did-start-navigation", listener: (details: NavigationDetails) => void): unknown;
    on(event: "render-process-gone", listener: () => void): unknown;
  };
  on(event: "closed", listener: () => void): unknown;
}

/**
 * A claim belongs to the renderer document that made it. It ends when that document goes away: a
 * cross-document navigation of the main frame, a renderer crash, or the window closing. Iframe
 * loads and same-document navigations keep it, because the grid still shows.
 */
export function releaseGridZoomClaimsOnDocumentEnd(
  win: ClaimWindow,
  claims: GridZoomClaims,
  onReleased: () => void,
): void {
  const windowId = win.webContents.id;
  const release = () => {
    if (claims.clear(windowId)) {
      onReleased();
    }
  };
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      release();
    }
  });
  win.webContents.on("render-process-gone", release);
  win.on("closed", release);
}

function buildApplicationMenuTemplate(
  options: ApplicationMenuOptions,
  flags: { capturingShortcut: boolean; gridZoomKeys: boolean },
): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  const zoomEnabled = resolveZoomEnabled(flags);
  // Cmd/Ctrl+0 is not a grid key, so it only gives way to shortcut recording.
  const actualSizeEnabled = !flags.capturingShortcut;

  return [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            options.onNewWindow();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          enabled: zoomEnabled,
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
          }),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          enabled: zoomEnabled,
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
          }),
        },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          enabled: actualSizeEnabled,
          click: withBrowserWindow((win) => {
            win.webContents.setZoomLevel(0);
          }),
        },
        { type: "separator" },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: withBrowserWindow((win) => {
            reloadActiveBrowserOrWindow({
              win,
              getActiveBrowserContentsForHostWindow: getActivePaseoBrowserWebContentsForHostWindow,
            });
          }),
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: withBrowserWindow((win) => {
            reloadActiveBrowserOrWindow({
              win,
              getActiveBrowserContentsForHostWindow: getActivePaseoBrowserWebContentsForHostWindow,
              ignoreCache: true,
            });
          }),
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
  ];
}

let applicationMenuOptions: ApplicationMenuOptions | null = null;
let capturingShortcut = false;
const gridZoomClaims = new GridZoomClaims();

function rebuildApplicationMenu(): void {
  if (!applicationMenuOptions) return;
  const menu = Menu.buildFromTemplate(
    buildApplicationMenuTemplate(applicationMenuOptions, {
      capturingShortcut,
      gridZoomKeys: gridZoomClaims.has(BrowserWindow.getFocusedWindow()?.webContents.id),
    }),
  );
  Menu.setApplicationMenu(menu);
}

export function setupApplicationMenu(options: ApplicationMenuOptions): void {
  applicationMenuOptions = options;
  rebuildApplicationMenu();

  ipcMain.handle("paseo:menu:showContextMenu", (event, input?: ShowContextMenuInput) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }

    if (input?.kind !== "terminal") {
      return;
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Copy",
        role: "copy",
        enabled: input.hasSelection === true,
      },
      {
        label: "Paste",
        role: "paste",
      },
      {
        type: "separator",
      },
      {
        label: "Select All",
        role: "selectAll",
      },
    ]);

    contextMenu.popup({ window: win });
  });

  // Disable the zoom accelerators while capturing a shortcut so combos like
  // Cmd+- / Cmd+= reach the renderer instead of zooming the window.
  ipcMain.handle("paseo:menu:set-capturing-shortcut", (_event, capturing?: boolean) => {
    capturingShortcut = capturing === true;
    rebuildApplicationMenu();
  });

  // The pinned grid maximizes and restores cells with Cmd/Ctrl +, = and -, so the zoom items give
  // up those accelerators while it shows. Normal mode keeps window zoom.
  ipcMain.handle("paseo:menu:set-grid-zoom-keys", (event, active?: boolean) => {
    const windowId = event.sender.id;
    if (active === true) {
      gridZoomClaims.add(windowId);
    } else {
      gridZoomClaims.release(windowId);
    }
    rebuildApplicationMenu();
  });

  // If the renderer reloads mid-capture (e.g. Cmd+R) the renderer-side effect
  // never gets to send `false`, so reset the flag from the main process when a
  // main window finishes loading. Workspace browser webviews are not
  // BrowserWindows, so they don't trigger this.
  // The menu is process-wide, so it follows the window that has focus.
  app.on("browser-window-focus", rebuildApplicationMenu);
  app.on("browser-window-blur", rebuildApplicationMenu);
  app.on("browser-window-created", (_event, win) => {
    // A reload, a crash or a close ends the renderer effect without a `false`; the renderer sends
    // `true` again after a reload if its grid still shows.
    releaseGridZoomClaimsOnDocumentEnd(win, gridZoomClaims, rebuildApplicationMenu);
    win.webContents.on("did-finish-load", () => {
      if (!capturingShortcut) return;
      capturingShortcut = false;
      rebuildApplicationMenu();
    });
  });
}
