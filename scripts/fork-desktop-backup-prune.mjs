import fs from "node:fs";
import { parseArgs } from "node:util";
import { isMainModule } from "./is-main-module.mjs";

// Plans which version folders of the fork's private desktop backup to delete,
// so that only the newest versions stay. Clients read updates and installers
// from GitHub Releases, never from this backup. The plan only names whole
// version folders: files at the backup root are never touched.

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/;

function parseVersion(name) {
  const match = VERSION_PATTERN.exec(name);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Semver precedence: 0.15.3-mf.10 is newer than 0.15.3-mf.9, and a release
// without a prerelease part is newer than its prereleases.
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i += 1) {
    const order = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (order !== 0) return order;
  }
  return a.prerelease.length - b.prerelease.length;
}

// `aws s3 ls s3://bucket/prefix/` prints folders as "PRE <name>/" and files
// with a date and size. Only folders are candidates.
export function parseBackupListing(text) {
  return text
    .split("\n")
    .map((line) => /^\s*PRE (.+)\/$/.exec(line)?.[1])
    .filter((name) => name !== undefined);
}

export function planBackupPrune({ entries, keep, current }) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`keep must be a positive integer, got ${keep}`);
  }
  const ignored = entries.filter((name) => parseVersion(name) === null);
  const versions = entries
    .filter((name) => parseVersion(name) !== null)
    .sort((a, b) => compareVersions(b, a));
  const kept = versions.slice(0, keep);
  const nothing = (reason) => ({ kept: versions, removed: [], ignored, reason });

  if (versions.length <= keep) {
    return nothing(`only ${versions.length} versions, keeping all`);
  }
  // The backup of the new version must be there and among the newest before
  // anything older goes; otherwise a failed upload could leave too few copies.
  if (current && !kept.includes(current)) {
    return nothing(`${current} is not among the ${keep} newest backups, deleting nothing`);
  }
  return { kept, removed: versions.slice(keep), ignored, reason: null };
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      listing: { type: "string" },
      keep: { type: "string" },
      current: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.listing || !values.keep || !values.out) {
    console.error(
      "Usage: node scripts/fork-desktop-backup-prune.mjs --listing <file> --keep <n> --out <file> [--current <version>]",
    );
    process.exit(2);
  }
  const plan = planBackupPrune({
    entries: parseBackupListing(fs.readFileSync(values.listing, "utf8")),
    keep: Number(values.keep),
    current: values.current,
  });
  console.log(`Backup prune plan (keep the ${values.keep} newest versions):`);
  console.log(`  keep: ${plan.kept.join(", ") || "none"}`);
  console.log(`  delete: ${plan.removed.join(", ") || "none"}`);
  if (plan.ignored.length > 0) {
    console.log(`  not a version, left alone: ${plan.ignored.join(", ")}`);
  }
  if (plan.reason) console.log(`  ${plan.reason}`);
  fs.writeFileSync(values.out, plan.removed.map((name) => `${name}\n`).join(""));
}
