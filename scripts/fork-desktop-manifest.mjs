import fs from "node:fs";
import path from "node:path";
import { dump, load } from "js-yaml";
import { isMainModule } from "./is-main-module.mjs";

// Fork releases keep installers in `<prefix>/<version>/` and the update feed at
// `<prefix>/`. electron-updater resolves each `files[].url` against the feed
// location, so every entry needs the version directory in front of it.
// Refuses a manifest that names a file the release does not contain, so a
// client never sees a feed that points at a missing installer.
export function prepareForkManifest({ manifestPath, version, availableFiles }) {
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

  const available = new Set(availableFiles);
  const missing = [...files.map((file) => file.url), manifest.path]
    .filter((name) => typeof name === "string")
    .filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`${manifestPath} names files the release lacks: ${missing.join(", ")}`);
  }

  const prefixed = (name) => `${version}/${name}`;
  const output = {
    ...manifest,
    files: files.map((file) => ({ ...file, url: prefixed(file.url) })),
  };
  if (typeof manifest.path === "string") {
    output.path = prefixed(manifest.path);
  }
  return dump(output, { lineWidth: -1, noRefs: true });
}

if (isMainModule(import.meta.url)) {
  const [, , manifestPath, version, artifactsDir, outputPath] = process.argv;
  if (!manifestPath || !version || !artifactsDir || !outputPath) {
    throw new Error(
      "Usage: node scripts/fork-desktop-manifest.mjs <manifest.yml> <version> <artifacts-dir> <out.yml>",
    );
  }
  const availableFiles = fs.readdirSync(artifactsDir);
  fs.writeFileSync(outputPath, prepareForkManifest({ manifestPath, version, availableFiles }));
  process.stdout.write(`${path.basename(outputPath)} -> ${version}/\n`);
}
