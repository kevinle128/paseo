import fs from "node:fs";
import path from "node:path";
import { dump, load } from "js-yaml";
import { isMainModule } from "./is-main-module.mjs";

// GitHub release assets live in one flat directory and electron-updater
// resolves each `files[].url` as `releases/download/<tag>/<url>`, so every entry
// must be a bare file name. Refuses a manifest that names a file the release
// does not contain or that nests a file in a directory, so a client never sees
// a feed that points at a missing installer.
export function validateForkManifest({ manifestPath, version, availableFiles }) {
  const manifest = load(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || manifest.version !== version) {
    throw new Error(
      `${manifestPath} is for version ${manifest?.version ?? "unknown"}, expected ${version}`,
    );
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) {
    throw new Error(`${manifestPath} lists no files`);
  }

  const names = [...files.map((file) => file.url), manifest.path].filter(
    (name) => typeof name === "string",
  );
  const nested = names.filter((name) => name.includes("/"));
  if (nested.length > 0) {
    throw new Error(
      `${manifestPath} names files outside the flat release layout: ${nested.join(", ")}`,
    );
  }
  // GitHub renames an asset with a space, so the feed would name a file that
  // does not exist.
  const spaced = names.filter((name) => /\s/.test(name));
  if (spaced.length > 0) {
    throw new Error(`${manifestPath} names files with whitespace: ${spaced.join(", ")}`);
  }
  const available = new Set(availableFiles);
  const missing = names.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`${manifestPath} names files the release lacks: ${missing.join(", ")}`);
  }

  return dump(manifest, { lineWidth: -1, noRefs: true });
}

if (isMainModule(import.meta.url)) {
  const [, , manifestPath, version, artifactsDir, outputPath] = process.argv;
  if (!manifestPath || !version || !artifactsDir || !outputPath) {
    throw new Error(
      "Usage: node scripts/fork-desktop-manifest.mjs <manifest.yml> <version> <artifacts-dir> <out.yml>",
    );
  }
  const availableFiles = fs.readdirSync(artifactsDir);
  fs.writeFileSync(outputPath, validateForkManifest({ manifestPath, version, availableFiles }));
  process.stdout.write(`${path.basename(outputPath)} ok for ${version}\n`);
}
