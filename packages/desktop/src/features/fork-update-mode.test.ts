import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { load } from "js-yaml";
import { AppUpdater } from "electron-updater/out/AppUpdater.js";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import { gt, lt, parse } from "semver";
import type { AppUpdateCheckResult, AppUpdateService } from "./app-update-service";
import {
  createNotifyOnlyUpdateService,
  isNotifyOnlyUpdateMode,
  parseForkUpdateConfig,
  resolveAllowPrerelease,
  resolveFeedChannel,
  resolveMacDmgUrl,
  type ForkUpdateConfig,
} from "./fork-update-mode";

const DOWNLOAD_BASE = "https://github.com/kevinle128/paseo/releases/download";
const config: ForkUpdateConfig = { macUpdateMode: "notify", downloadBaseUrl: DOWNLOAD_BASE };
const TAG = "mf-desktop-v0.14.0-mf.2";

describe("parseForkUpdateConfig", () => {
  it("reads the block that electron-builder bakes into package.json", () => {
    expect(parseForkUpdateConfig({ version: "1.0.0", paseoFork: config })).toEqual(config);
  });

  it("returns null for upstream builds and malformed blocks", () => {
    expect(parseForkUpdateConfig({ version: "1.0.0" })).toBeNull();
    expect(parseForkUpdateConfig(null)).toBeNull();
    expect(parseForkUpdateConfig({ paseoFork: { downloadBaseUrl: "not a url" } })).toBeNull();
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

describe("resolveAllowPrerelease", () => {
  it("keeps the upstream mapping when no fork config exists", () => {
    expect(resolveAllowPrerelease("stable", null)).toBe(false);
    expect(resolveAllowPrerelease("beta", null)).toBe(true);
  });

  it("never allows prereleases in fork builds", () => {
    expect(resolveAllowPrerelease("stable", config)).toBe(false);
    expect(resolveAllowPrerelease("beta", config)).toBe(false);
  });
});

describe("fork build files", () => {
  const forkBuildConfig = load(
    readFileSync(new URL("../../electron-builder.fork.yml", import.meta.url), "utf8"),
  ) as {
    publish: Array<Record<string, unknown>>;
    extraMetadata: { paseoFork: unknown };
  };

  it("bakes an updater feed that points at the fork's GitHub releases only", () => {
    expect(forkBuildConfig.publish).toEqual([
      {
        provider: "github",
        owner: "kevinle128",
        repo: "paseo",
        releaseType: "release",
        channel: "latest",
      },
    ]);
    expect(JSON.stringify(forkBuildConfig)).not.toMatch(/getpaseo|wasabi/i);
  });

  it("derives the download base from the publish entry and passes the config schema", () => {
    const parsed = parseForkUpdateConfig({ paseoFork: forkBuildConfig.extraMetadata.paseoFork });
    expect(parsed).toEqual(config);
    const [publish] = forkBuildConfig.publish;
    expect(parsed?.downloadBaseUrl).toBe(
      `https://github.com/${publish?.owner}/${publish?.repo}/releases/download`,
    );
  });
});

// electron-updater's own classes decide the requests and the file URLs, so these
// tests drive the real GitHub provider and the real version check instead of a
// copy of their rules.
describe("GitHub release feed", () => {
  const MANIFEST = [
    "version: 0.14.0-mf.2",
    "files:",
    "  - url: Paseo-0.14.0-mf.2-arm64.dmg",
    "    sha512: a",
    "    size: 1",
    "  - url: Paseo-0.14.0-mf.2-x64.dmg",
    "    sha512: b",
    "    size: 1",
    "path: Paseo-0.14.0-mf.2-arm64.dmg",
    "sha512: a",
    "releaseDate: '2026-11-07T00:00:00.000Z'",
    "",
  ].join("\n");

  function atom(tags: string[]) {
    const entries = tags
      .map(
        (tag) =>
          `<entry><link rel="alternate" type="text/html" href="https://github.com/kevinle128/paseo/releases/tag/${tag}"/><title>${tag}</title><content>notes</content></entry>`,
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
  }

  function createProvider(input: {
    platform: NodeJS.Platform;
    allowPrerelease: boolean;
    releaseChannel: "stable" | "beta";
    currentVersion?: string;
  }) {
    const requested: string[] = [];
    const [publish] = (
      load(readFileSync(new URL("../../electron-builder.fork.yml", import.meta.url), "utf8")) as {
        publish: Array<Record<string, unknown>>;
      }
    ).publish;
    const updater = {
      channel: resolveFeedChannel(input.releaseChannel, config),
      allowPrerelease: input.allowPrerelease,
      currentVersion: parse(input.currentVersion ?? "0.14.0-mf.1"),
      fullChangelog: false,
    };
    const provider = new GitHubProvider(
      publish as never,
      updater as never,
      {
        platform: input.platform,
        executor: {
          request: async (options: { path: string }) => {
            requested.push(options.path);
            if (options.path.endsWith("/releases.atom"))
              return atom([TAG, "mf-desktop-v0.14.0-mf.1"]);
            if (options.path.endsWith("/releases/latest")) return JSON.stringify({ tag_name: TAG });
            if (options.path.includes(`/releases/download/${TAG}/latest`)) return MANIFEST;
            throw new Error(`unexpected request ${options.path}`);
          },
        },
      } as never,
    );
    return { provider, requested, updater };
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
  ] as const)("%s reads %s from the latest release", async (platform, file) => {
    const { provider, requested } = createProvider({
      platform,
      allowPrerelease: resolveAllowPrerelease("beta", config),
      releaseChannel: "beta",
    });
    const info = await provider.getLatestVersion();
    expect(info.tag).toBe(TAG);
    expect(requested).toContain("/kevinle128/paseo/releases/latest");
    expect(requested).toContain(`/kevinle128/paseo/releases/download/${TAG}/${file}`);
  });

  it("offers a prerelease version published as a normal release", async () => {
    const { provider, updater } = createProvider({
      platform: "darwin",
      allowPrerelease: false,
      releaseChannel: "stable",
    });
    const info = await provider.getLatestVersion();
    const check = (
      AppUpdater.prototype as unknown as {
        isUpdateAvailable(this: unknown, info: unknown): Promise<boolean>;
      }
    ).isUpdateAvailable;
    const checker = {
      currentVersion: updater.currentVersion,
      allowDowngrade: false,
      isUpdateSupported: () => true,
      isUserWithinRollout: () => true,
    };
    expect(info.version).toBe("0.14.0-mf.2");
    await expect(check.call(checker, info)).resolves.toBe(true);
    await expect(
      check.call({ ...checker, currentVersion: parse("0.14.0-mf.2") }, info),
    ).resolves.toBe(false);
  });

  it("finds no release when prereleases are allowed, because the fork tags have no semver id", async () => {
    const { provider } = createProvider({
      platform: "darwin",
      allowPrerelease: true,
      releaseChannel: "beta",
    });
    await expect(provider.getLatestVersion()).rejects.toMatchObject({
      code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
    });
  });

  it("resolves the DMG link to the same URL electron-updater downloads from", async () => {
    const { provider } = createProvider({
      platform: "darwin",
      allowPrerelease: false,
      releaseChannel: "stable",
    });
    const info = await provider.getLatestVersion();
    for (const arch of ["arm64", "x64"] as const) {
      const expected = provider
        .resolveFiles(info)
        .map((file) => file.url.href)
        .find((href) => href.endsWith(`-${arch}.dmg`));
      expect(expected).toBe(`${DOWNLOAD_BASE}/${TAG}/Paseo-0.14.0-mf.2-${arch}.dmg`);
      expect(resolveMacDmgUrl(info, config, arch)).toBe(expected);
    }
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
    tag: TAG,
    files: [
      { url: "Paseo-0.14.0-mf.2-arm64.zip" },
      { url: "Paseo-0.14.0-mf.2-arm64.dmg" },
      { url: "Paseo-0.14.0-mf.2-x64.dmg" },
    ],
  };

  it("picks the installer for the running architecture from the release", () => {
    expect(resolveMacDmgUrl(info, config, "arm64")).toBe(
      `${DOWNLOAD_BASE}/${TAG}/Paseo-0.14.0-mf.2-arm64.dmg`,
    );
    expect(resolveMacDmgUrl(info, config, "x64")).toBe(
      `${DOWNLOAD_BASE}/${TAG}/Paseo-0.14.0-mf.2-x64.dmg`,
    );
  });

  it("returns null when the release lists no matching installer or has no tag", () => {
    expect(resolveMacDmgUrl({ files: [{ url: "a-arm64.zip" }] }, config, "arm64")).toBeNull();
    expect(resolveMacDmgUrl({ files: undefined }, config, "arm64")).toBeNull();
    expect(resolveMacDmgUrl(null, config, "arm64")).toBeNull();
    expect(resolveMacDmgUrl({ files: info.files }, config, "arm64")).toBeNull();
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
        tag: TAG,
        files: [{ url: "Paseo-0.14.0-mf.2-arm64.dmg" }],
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
    expect(openExternal).toHaveBeenCalledWith(
      `${DOWNLOAD_BASE}/${TAG}/Paseo-0.14.0-mf.2-arm64.dmg`,
    );
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
