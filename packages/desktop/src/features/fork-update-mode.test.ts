import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GenericProvider } from "electron-updater/out/providers/GenericProvider.js";
import { gt, lt } from "semver";
import type { AppUpdateCheckResult, AppUpdateService } from "./app-update-service";
import {
  createNotifyOnlyUpdateService,
  isNotifyOnlyUpdateMode,
  parseForkUpdateConfig,
  resolveFeedChannel,
  resolveMacDmgUrl,
  type ForkUpdateConfig,
} from "./fork-update-mode";

const FEED = "https://s3.ap-southeast-1.wasabisys.com/game-mobile-registry/paseo-desktop";
const config: ForkUpdateConfig = { macUpdateMode: "notify", feedBaseUrl: FEED };

describe("parseForkUpdateConfig", () => {
  it("reads the block that electron-builder bakes into package.json", () => {
    expect(parseForkUpdateConfig({ version: "1.0.0", paseoFork: config })).toEqual(config);
  });

  it("returns null for upstream builds and malformed blocks", () => {
    expect(parseForkUpdateConfig({ version: "1.0.0" })).toBeNull();
    expect(parseForkUpdateConfig(null)).toBeNull();
    expect(parseForkUpdateConfig({ paseoFork: { feedBaseUrl: "not a url" } })).toBeNull();
    expect(parseForkUpdateConfig({ paseoFork: { macUpdateMode: "silent" } })).toBeNull();
  });
});

describe("isNotifyOnlyUpdateMode", () => {
  it("is on only for fork builds on macOS", () => {
    expect(isNotifyOnlyUpdateMode(config, "darwin")).toBe(true);
    expect(isNotifyOnlyUpdateMode(config, "win32")).toBe(false);
    expect(isNotifyOnlyUpdateMode(config, "linux")).toBe(false);
    expect(isNotifyOnlyUpdateMode(null, "darwin")).toBe(false);
  });
});

describe("resolveFeedChannel", () => {
  it("keeps the upstream stable/beta mapping when no fork config exists", () => {
    expect(resolveFeedChannel("stable", null)).toBe("latest");
    expect(resolveFeedChannel("beta", null)).toBe("beta");
  });

  it("always requests latest in fork builds", () => {
    expect(resolveFeedChannel("stable", config)).toBe("latest");
    expect(resolveFeedChannel("beta", config)).toBe("latest");
  });
});

describe("feed file names for the requested channel", () => {
  // electron-updater's own provider decides the file name, so this checks the
  // real naming rules instead of a copy of them.
  async function requestedFeedFile(platform: NodeJS.Platform, channel: string) {
    const requested: string[] = [];
    const provider = new GenericProvider(
      { provider: "generic", url: FEED },
      { channel, isAddNoCacheQuery: false } as never,
      {
        platform,
        executor: {
          request: async (options: { path: string }) => {
            requested.push(options.path);
            return "version: 1.0.0\nfiles: []\npath: x\nsha512: y\nreleaseDate: z\n";
          },
        },
      } as never,
    );
    await provider.getLatestVersion();
    return requested[0]?.split("/").pop();
  }

  // electron-updater adds an arch suffix to the Linux file name off x64.
  beforeAll(() => {
    vi.stubEnv("TEST_UPDATER_ARCH", "x64");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["darwin", "latest-mac.yml"],
    ["win32", "latest.yml"],
    ["linux", "latest-linux.yml"],
  ] as const)("%s reads %s", async (platform, file) => {
    expect(await requestedFeedFile(platform, resolveFeedChannel("beta", config))).toBe(file);
  });
});

describe("fork versions", () => {
  it("order as semver whatever prerelease id they carry", () => {
    expect(gt("0.14.0-mf.2", "0.14.0-mf.1")).toBe(true);
    expect(gt("0.14.0-mf.10", "0.14.0-mf.9")).toBe(true);
    expect(gt("0.14.0-beta.1.mf.2", "0.14.0-beta.1.mf.1")).toBe(true);
    expect(gt("0.14.0-beta.1.mf.1", "0.14.0-beta.1")).toBe(true);
    expect(gt("0.14.0-mf.1", "0.14.0-beta.1.mf.9")).toBe(true);
    expect(gt("0.14.1-mf.1", "0.14.0-mf.9")).toBe(true);
    expect(lt("0.14.0-mf.5", "0.14.0")).toBe(true);
  });
});

describe("resolveMacDmgUrl", () => {
  const info = {
    files: [
      { url: "0.14.0-mf.2/Paseo-0.14.0-mf.2-arm64.zip" },
      { url: "0.14.0-mf.2/Paseo-0.14.0-mf.2-arm64.dmg" },
      { url: "0.14.0-mf.2/Paseo-0.14.0-mf.2-x64.dmg" },
    ],
  };

  it("picks the installer for the running architecture from the feed", () => {
    expect(resolveMacDmgUrl(info, config, "arm64")).toBe(
      `${FEED}/0.14.0-mf.2/Paseo-0.14.0-mf.2-arm64.dmg`,
    );
    expect(resolveMacDmgUrl(info, config, "x64")).toBe(
      `${FEED}/0.14.0-mf.2/Paseo-0.14.0-mf.2-x64.dmg`,
    );
  });

  it("returns null when the feed lists no matching installer", () => {
    expect(resolveMacDmgUrl({ files: [{ url: "a-arm64.zip" }] }, config, "arm64")).toBeNull();
    expect(resolveMacDmgUrl({ files: undefined }, config, "arm64")).toBeNull();
    expect(resolveMacDmgUrl(null, config, "arm64")).toBeNull();
  });
});

describe("createNotifyOnlyUpdateService", () => {
  const available: AppUpdateCheckResult = {
    hasUpdate: true,
    readyToInstall: false,
    currentVersion: "0.14.0-mf.1",
    latestVersion: "0.14.0-mf.2",
    body: null,
    date: null,
    errorMessage: null,
  };

  function setup(check: AppUpdateCheckResult = available) {
    const service: AppUpdateService = {
      checkForAppUpdate: vi.fn(async () => check),
      downloadAndInstallUpdate: vi.fn(),
      installUpdateOnQuit: vi.fn(),
    };
    const openExternal = vi.fn(async () => undefined);
    const notify = createNotifyOnlyUpdateService({
      service,
      getLastUpdateInfo: () => ({
        version: "0.14.0-mf.2",
        files: [{ url: "0.14.0-mf.2/Paseo-0.14.0-mf.2-arm64.dmg" }],
      }),
      config,
      arch: () => "arm64",
      openExternal,
    });
    return { service, notify, openExternal };
  }

  it("reports an available update as actionable without any download", async () => {
    const { notify } = setup();
    const result = await notify.checkForAppUpdate({
      currentVersion: "0.14.0-mf.1",
      releaseChannel: "stable",
      intent: "automatic",
    });
    expect(result).toMatchObject({ hasUpdate: true, readyToInstall: true });
  });

  it("leaves a no-update result untouched", async () => {
    const none = { ...available, hasUpdate: false, latestVersion: "0.14.0-mf.1" };
    const { notify } = setup(none);
    const result = await notify.checkForAppUpdate({
      currentVersion: "0.14.0-mf.1",
      releaseChannel: "stable",
      intent: "automatic",
    });
    expect(result).toEqual(none);
  });

  it("opens the DMG and never downloads or installs", async () => {
    const { notify, service, openExternal } = setup();
    const result = await notify.downloadAndInstallUpdate({
      currentVersion: "0.14.0-mf.1",
      releaseChannel: "stable",
    });
    expect(openExternal).toHaveBeenCalledWith(`${FEED}/0.14.0-mf.2/Paseo-0.14.0-mf.2-arm64.dmg`);
    expect(result.installed).toBe(false);
    expect(result.downloadOpened).toBe(true);
    expect(service.downloadAndInstallUpdate).not.toHaveBeenCalled();
  });

  it("opens nothing when no update exists", async () => {
    const { notify, openExternal } = setup({ ...available, hasUpdate: false });
    const result = await notify.downloadAndInstallUpdate({
      currentVersion: "0.14.0-mf.1",
      releaseChannel: "stable",
    });
    expect(openExternal).not.toHaveBeenCalled();
    expect(result).toMatchObject({ installed: false, message: "No update available." });
  });

  it("does not install on quit", async () => {
    const { notify, service } = setup();
    await expect(
      notify.installUpdateOnQuit({
        currentVersion: "0.14.0-mf.1",
        releaseChannel: "stable",
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(false);
    expect(service.installUpdateOnQuit).not.toHaveBeenCalled();
  });
});
