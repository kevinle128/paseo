import { z } from "zod";
import type {
  AppUpdateCheckResult,
  AppUpdateInstallResult,
  AppUpdateService,
  RuntimeUpdateInfo,
} from "./app-update-service.js";
import type { AppReleaseChannel } from "./app-update-rollout.js";

// Fork builds publish one feed (the "latest" channel) next to the installers.
// electron-builder bakes this block into the packaged package.json through
// `extraMetadata`. Upstream builds have no such block and keep every default.
const forkUpdateConfigSchema = z.object({
  macUpdateMode: z.literal("notify").optional(),
  feedBaseUrl: z.url(),
});

export type ForkUpdateConfig = z.infer<typeof forkUpdateConfigSchema>;

export function parseForkUpdateConfig(packageJson: unknown): ForkUpdateConfig | null {
  if (typeof packageJson !== "object" || packageJson === null) return null;
  const parsed = forkUpdateConfigSchema.safeParse(
    (packageJson as { paseoFork?: unknown }).paseoFork,
  );
  return parsed.success ? parsed.data : null;
}

export function isNotifyOnlyUpdateMode(
  config: ForkUpdateConfig | null,
  platform: NodeJS.Platform,
): boolean {
  return config?.macUpdateMode === "notify" && platform === "darwin";
}

// The fork feed has no beta channel, so a fork build always asks for "latest".
// Prerelease ids in the version (`X.Y.Z-mf.N`, `X.Y.Z-beta.K.mf.N`) never pick
// the feed file; electron-updater only compares them as semver.
export function resolveFeedChannel(
  releaseChannel: AppReleaseChannel,
  config: ForkUpdateConfig | null,
): "latest" | "beta" {
  if (config) return "latest";
  return releaseChannel === "beta" ? "beta" : "latest";
}

export type MacArch = "arm64" | "x64";

export function resolveMacDmgUrl(
  info: Pick<RuntimeUpdateInfo, "files"> | null,
  config: ForkUpdateConfig,
  arch: MacArch,
): string | null {
  if (!Array.isArray(info?.files)) return null;
  const base = config.feedBaseUrl.endsWith("/") ? config.feedBaseUrl : `${config.feedBaseUrl}/`;
  for (const file of info.files) {
    const url = (file as { url?: unknown } | null)?.url;
    if (typeof url !== "string") continue;
    const name = url.split("?")[0].split("/").pop() ?? "";
    if (name.endsWith(`-${arch}.dmg`)) return new URL(url, base).href;
  }
  return null;
}

export interface NotifyOnlyUpdateDeps {
  service: AppUpdateService;
  getLastUpdateInfo(): RuntimeUpdateInfo | null;
  config: ForkUpdateConfig;
  arch(): MacArch;
  openExternal(url: string): Promise<void>;
}

// macOS fork builds are ad-hoc signed, so the system would refuse a
// self-installed update. Checking stays on; downloading and installing never run.
export function createNotifyOnlyUpdateService(deps: NotifyOnlyUpdateDeps): AppUpdateService {
  const { service } = deps;

  return {
    async checkForAppUpdate(input): Promise<AppUpdateCheckResult> {
      const result = await service.checkForAppUpdate(input);
      // "Ready" makes the existing update callout offer its action right away
      // instead of waiting for a download that never starts.
      return result.hasUpdate ? { ...result, readyToInstall: true } : result;
    },

    async downloadAndInstallUpdate(input): Promise<AppUpdateInstallResult> {
      const check = await service.checkForAppUpdate({ ...input, intent: "manual" });
      if (!check.hasUpdate) {
        return {
          installed: false,
          version: input.currentVersion,
          message: check.errorMessage ?? "No update available.",
        };
      }
      const url = resolveMacDmgUrl(deps.getLastUpdateInfo(), deps.config, deps.arch());
      if (!url) {
        return {
          installed: false,
          version: input.currentVersion,
          message: "The update feed has no installer for this Mac.",
        };
      }
      await deps.openExternal(url);
      return {
        installed: false,
        version: input.currentVersion,
        message: `Opened the ${check.latestVersion} download. Install it by replacing Paseo in Applications.`,
      };
    },

    async installUpdateOnQuit(): Promise<boolean> {
      return false;
    },
  };
}
