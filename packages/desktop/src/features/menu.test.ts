import { describe, expect, it } from "vitest";
import {
  GridZoomClaims,
  releaseGridZoomClaimsOnDocumentEnd,
  reloadActiveBrowserOrWindow,
  resolveZoomEnabled,
} from "./menu.js";

class FakeWebContents {
  public readonly reloads: string[] = [];

  public constructor(public readonly id: number) {}

  public isLoadingMainFrame(): boolean {
    return false;
  }

  public stop(): void {
    this.reloads.push("stop");
  }

  public reload(): void {
    this.reloads.push("reload");
  }

  public reloadIgnoringCache(): void {
    this.reloads.push("force-reload");
  }
}

class BrowserReloads {
  public readonly firstWindow = { webContents: new FakeWebContents(101) };
  public readonly secondWindow = { webContents: new FakeWebContents(202) };
  public readonly firstBrowser = new FakeWebContents(11);
  public readonly secondBrowser = new FakeWebContents(22);
  public readonly resolvedHostWindowIds: number[] = [];

  public activeBrowserForHostWindow(hostWebContentsId: number): FakeWebContents | null {
    this.resolvedHostWindowIds.push(hostWebContentsId);
    return hostWebContentsId === 101 ? this.firstBrowser : this.secondBrowser;
  }
}

describe("reloadActiveBrowserOrWindow", () => {
  it("reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.firstWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([101]);
    expect(browserReloads.firstBrowser.reloads).toEqual(["reload"]);
    expect(browserReloads.secondBrowser.reloads).toEqual([]);
    expect(browserReloads.firstWindow.webContents.reloads).toEqual([]);
  });

  it("force reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.secondWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
      ignoreCache: true,
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([202]);
    expect(browserReloads.firstBrowser.reloads).toEqual([]);
    expect(browserReloads.secondBrowser.reloads).toEqual(["force-reload"]);
    expect(browserReloads.secondWindow.webContents.reloads).toEqual([]);
  });
});

describe("resolveZoomEnabled", () => {
  it("keeps window zoom on when nothing claims the zoom keys", () => {
    expect(resolveZoomEnabled({ capturingShortcut: false, gridZoomKeys: false })).toBe(true);
  });

  it("turns window zoom off while a shortcut is recorded", () => {
    expect(resolveZoomEnabled({ capturingShortcut: true, gridZoomKeys: false })).toBe(false);
  });

  it("turns window zoom off while a pinned grid shows", () => {
    expect(resolveZoomEnabled({ capturingShortcut: false, gridZoomKeys: true })).toBe(false);
  });

  it("stays off until both claims end", () => {
    expect(resolveZoomEnabled({ capturingShortcut: true, gridZoomKeys: true })).toBe(false);
  });
});

class FakeClaimWindow {
  private readonly listeners = new Map<string, Array<(details?: unknown) => void>>();
  public readonly webContents = {
    id: 7,
    on: (event: string, listener: (details?: unknown) => void) => {
      this.add(`contents:${event}`, listener);
    },
  };

  public on(event: string, listener: () => void): void {
    this.add(`window:${event}`, listener);
  }

  public emit(name: string, details?: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(details);
    }
  }

  private add(name: string, listener: (details?: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
}

describe("GridZoomClaims", () => {
  it("keeps a window claimed until every holder released it", () => {
    const claims = new GridZoomClaims();
    claims.add(7);
    claims.add(7);

    expect(claims.release(7)).toBe(false);
    expect(claims.has(7)).toBe(true);
    expect(claims.release(7)).toBe(true);
    expect(claims.has(7)).toBe(false);
  });

  it("ignores a release without a claim and keeps windows apart", () => {
    const claims = new GridZoomClaims();
    claims.add(7);

    expect(claims.release(8)).toBe(false);
    expect(claims.has(7)).toBe(true);
    expect(claims.has(8)).toBe(false);
    expect(claims.has(null)).toBe(false);
  });
});

describe("releaseGridZoomClaimsOnDocumentEnd", () => {
  function setup() {
    const claims = new GridZoomClaims();
    const win = new FakeClaimWindow();
    let released = 0;
    releaseGridZoomClaimsOnDocumentEnd(win, claims, () => {
      released += 1;
    });
    claims.add(7);
    return { claims, win, releasedCount: () => released };
  }

  it("keeps the claim through subframe and same-document navigations", () => {
    const { claims, win, releasedCount } = setup();

    win.emit("contents:did-start-navigation", { isMainFrame: false, isSameDocument: false });
    win.emit("contents:did-start-navigation", { isMainFrame: true, isSameDocument: true });

    expect(claims.has(7)).toBe(true);
    expect(releasedCount()).toBe(0);
  });

  it("releases the claim on a cross-document navigation of the main frame", () => {
    const { claims, win, releasedCount } = setup();

    win.emit("contents:did-start-navigation", { isMainFrame: true, isSameDocument: false });

    expect(claims.has(7)).toBe(false);
    expect(releasedCount()).toBe(1);
  });

  it("releases every claim of the window when the renderer dies or the window closes", () => {
    const crashed = setup();
    crashed.claims.add(7);
    crashed.win.emit("contents:render-process-gone");
    expect(crashed.claims.has(7)).toBe(false);

    const closed = setup();
    closed.win.emit("window:closed");
    expect(closed.claims.has(7)).toBe(false);
    closed.win.emit("window:closed");
    expect(closed.releasedCount()).toBe(1);
  });
});
