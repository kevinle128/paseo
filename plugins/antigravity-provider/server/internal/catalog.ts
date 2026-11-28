import { createHash } from "node:crypto";
import { execCommand } from "@getpaseo/plugin/server";
import type {
  ProviderLaunch,
  ProviderMode,
  ProviderModel,
  ProviderStatus,
} from "@getpaseo/plugin/server/provider";

const MIN_VERSION = [1, 5, 15] as const;

const EFFORT_OPTIONS = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra"],
  ["max", "Max"],
] as const;

const MODE_VISUALS: Readonly<Record<string, Pick<ProviderMode, "icon" | "colorTier">>> = {
  default: { icon: "ShieldCheck", colorTier: "safe" },
  "accept-edits": { icon: "ShieldAlert", colorTier: "moderate" },
  auto: { icon: "ShieldAlert", colorTier: "moderate" },
  plan: { icon: "ShieldCheck", colorTier: "planning" },
};

export const FULL_ACCESS_MODE_ID = "full-access";
export const NATIVE_FULL_ACCESS_BASE_MODE = "accept-edits";

const FULL_ACCESS_MODE: ProviderMode = {
  id: FULL_ACCESS_MODE_ID,
  label: "Full access",
  description: "Approve edits and commands without asking.",
  icon: "ShieldOff",
  colorTier: "dangerous",
  isUnattended: true,
};

const variantCache = new Map<string, ReadonlySet<string>>();

export function acpLaunch(launch: ProviderLaunch): ProviderLaunch {
  if (launch.args.includes("acp")) return launch;
  return { ...launch, args: [...launch.args, "acp"] };
}

function cliArgs(launch: ProviderLaunch, subcommand: readonly string[]): string[] {
  const index = launch.args.indexOf("acp");
  const base =
    index === -1 ? launch.args : [...launch.args.slice(0, index), ...launch.args.slice(index + 1)];
  return [...base, ...subcommand];
}

export function catalogCacheKey(launch: ProviderLaunch): string {
  const normalized = acpLaunch(launch);
  const env = Object.entries(normalized.env).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256")
    .update(JSON.stringify([normalized.command, normalized.args, env]))
    .digest("hex");
}

function isSupportedVersion(version: string): boolean | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  const [, major, minor, patch] = match.map(Number);
  const [minMajor, minMinor, minPatch] = MIN_VERSION;
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

export function diagnostic(error: unknown): string {
  const stderr =
    error instanceof Error && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "";
  const message = stderr || (error instanceof Error ? error.message : String(error));
  if (/auth|sign.in|log.in/i.test(message)) {
    return "Antigravity authentication failed. Run `agy` and sign in, then retry.";
  }
  return message;
}

function parseModelIds(output: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const line of output.trim().split(/\r?\n/)) {
    if (!line) continue;
    const [id, label, ...extra] = line.split("\t");
    if (!id || !label || extra.length > 0) {
      throw new Error("Invalid `agy models` output");
    }
    ids.add(id);
  }
  return ids;
}

function cacheVariants(key: string, variants: ReadonlySet<string>): void {
  if (variantCache.size >= 16 && !variantCache.has(key)) {
    const oldest = variantCache.keys().next().value;
    if (oldest !== undefined) variantCache.delete(oldest);
  }
  variantCache.set(key, variants);
}

export async function getStatus(launch: ProviderLaunch): Promise<ProviderStatus> {
  try {
    const { stdout: rawVersion } = await execCommand(
      launch.command,
      cliArgs(launch, ["--version"]),
      { env: launch.env, timeout: 10_000 },
    );
    const version = rawVersion.trim();
    const supported = isSupportedVersion(version);
    if (supported === null) {
      return {
        available: false,
        diagnostic: `Could not read the Antigravity version. Update \`agy\` to ${MIN_VERSION.join(".")} or later.`,
      };
    }
    if (!supported) {
      return {
        available: false,
        diagnostic: `Antigravity ${version} is unsupported. Update \`agy\` to ${MIN_VERSION.join(".")} or later.`,
      };
    }
    const { stdout: modelsOutput } = await execCommand(
      launch.command,
      cliArgs(launch, ["models"]),
      {
        env: launch.env,
        timeout: 10_000,
      },
    );
    cacheVariants(catalogCacheKey(launch), parseModelIds(modelsOutput));
    return { available: true };
  } catch (error) {
    return { available: false, diagnostic: diagnostic(error) };
  }
}

export function cachedModelVariants(launch: ProviderLaunch): ReadonlySet<string> {
  return variantCache.get(catalogCacheKey(launch)) ?? new Set();
}

export async function refreshModelVariants(
  launch: ProviderLaunch,
  cwd?: string,
): Promise<ReadonlySet<string>> {
  try {
    const { stdout } = await execCommand(launch.command, cliArgs(launch, ["models"]), {
      env: launch.env,
      cwd,
      timeout: 10_000,
    });
    const parsed = parseModelIds(stdout);
    cacheVariants(catalogCacheKey(launch), parsed);
    return parsed;
  } catch {
    return cachedModelVariants(launch);
  }
}

function pickDefaultThinkingId(
  options: ReadonlyArray<{ id: string }>,
  preferred: string | undefined,
): string | undefined {
  if (options.length === 0) return undefined;
  if (preferred && options.some((option) => option.id === preferred)) return preferred;
  for (const fallback of ["high", "medium"]) {
    if (options.some((option) => option.id === fallback)) return fallback;
  }
  return options.at(-1)?.id;
}

export function enrichModels(
  models: readonly ProviderModel[],
  variants: ReadonlySet<string>,
  preferredThinking?: string,
): ProviderModel[] {
  if (variants.size === 0) return [...models];
  const baseIds = new Set(models.map((model) => model.id));
  return models.map((model) => {
    const thinkingOptions = EFFORT_OPTIONS.filter(([effort]) => {
      const candidate = `${model.id}-${effort}`;
      return variants.has(candidate) && !baseIds.has(candidate);
    }).map(([id, label]) => ({ id, label }));
    const defaultThinkingOptionId = pickDefaultThinkingId(thinkingOptions, preferredThinking);
    const aliases =
      thinkingOptions.length > 0
        ? thinkingOptions.map((option) => `${model.id}-${option.id}`)
        : undefined;
    return {
      ...model,
      thinkingOptions,
      defaultThinkingOptionId,
      ...(aliases ? { aliases } : {}),
    };
  });
}

export function enrichModes(modes: readonly ProviderMode[]): ProviderMode[] {
  const decorated = modes.map((mode) => ({
    ...mode,
    ...MODE_VISUALS[mode.id],
  }));
  if (!decorated.some((mode) => mode.id === FULL_ACCESS_MODE_ID)) {
    decorated.push(FULL_ACCESS_MODE);
  }
  return decorated;
}
