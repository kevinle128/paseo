import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FEED = "https://s3.ap-southeast-1.wasabisys.com/game-mobile-registry/paseo-desktop";

const { autoUpdaterMock, electronMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    autoDownload: undefined as boolean | undefined,
    channel: undefined as string | undefined,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  electronMock: {
    app: {
      getAppPath: vi.fn(() => ""),
      getPath: vi.fn(),
      isPackaged: true,
      runningUnderARM64Translation: false,
    },
    shell: { openExternal: vi.fn(async () => undefined) },
  },
}));

vi.mock("electron", () => electronMock);
vi.mock("electron-updater", () => ({ autoUpdater: autoUpdaterMock }));

const realPlatform = process.platform;
let appDir: string;

async function loadUpdater(options: { fork: boolean; platform: NodeJS.Platform }) {
  await writeFile(
    path.join(appDir, "package.json"),
    JSON.stringify(
      options.fork
        ? { version: "0.14.0-mf.1", paseoFork: { macUpdateMode: "notify", feedBaseUrl: FEED } }
        : { version: "0.14.0" },
    ),
  );
  electronMock.app.getAppPath.mockReturnValue(appDir);
  Object.defineProperty(process, "platform", { value: options.platform });
  vi.resetModules();
  return import("./auto-updater");
}

function mockAvailableUpdate() {
  autoUpdaterMock.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: {
      version: "0.14.0-mf.2",
      files: [{ url: "0.14.0-mf.2/Paseo-0.14.0-mf.2-arm64.dmg" }],
    },
  });
}

beforeEach(async () => {
  appDir = await mkdtemp(path.join(os.tmpdir(), "paseo-auto-updater-"));
  autoUpdaterMock.checkForUpdates.mockReset();
  autoUpdaterMock.downloadUpdate.mockReset();
  electronMock.shell.openExternal.mockClear();
});

afterEach(async () => {
  Object.defineProperty(process, "platform", { value: realPlatform });
  await rm(appDir, { recursive: true, force: true });
});

describe("fork build on macOS", () => {
  it("checks the latest channel without downloading and opens the DMG on request", async () => {
    mockAvailableUpdate();
    const updater = await loadUpdater({ fork: true, platform: "darwin" });

    const check = await updater.checkForAppUpdate({
      currentVersion: "0.14.0-mf.1",
      releaseChannel: "beta",
      intent: "manual",
    });
    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.channel).toBe("latest");
    expect(check).toMatchObject({ hasUpdate: true, readyToInstall: true });

    const install = await updater.downloadAndInstallUpdate({
      currentVersion: "0.14.0-mf.1",
      releaseChannel: "beta",
    });
    expect(install.installed).toBe(false);
    expect(electronMock.shell.openExternal).toHaveBeenCalledOnce();
    expect(electronMock.shell.openExternal.mock.calls[0]?.[0]).toMatch(/-(arm64|x64)\.dmg$/);
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe("fork build on Windows and Linux", () => {
  it.each(["win32", "linux"] as const)("%s keeps automatic download", async (platform) => {
    mockAvailableUpdate();
    const updater = await loadUpdater({ fork: true, platform });

    const check = await updater.checkForAppUpdate({
      currentVersion: "0.14.0-mf.1",
      releaseChannel: "stable",
      intent: "manual",
    });
    expect(autoUpdaterMock.autoDownload).toBe(true);
    expect(autoUpdaterMock.channel).toBe("latest");
    expect(check).toMatchObject({ hasUpdate: true, readyToInstall: false });
  });
});

describe("upstream build", () => {
  it("keeps automatic download and the beta channel on macOS", async () => {
    mockAvailableUpdate();
    const updater = await loadUpdater({ fork: false, platform: "darwin" });

    await updater.checkForAppUpdate({
      currentVersion: "0.14.0",
      releaseChannel: "beta",
      intent: "manual",
    });
    expect(autoUpdaterMock.autoDownload).toBe(true);
    expect(autoUpdaterMock.channel).toBe("beta");
  });
});
