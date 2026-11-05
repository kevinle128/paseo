import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { load } from "js-yaml";
import { test } from "vitest";
import { prepareForkManifest } from "./fork-desktop-manifest.mjs";

function withManifest(body, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-fork-manifest-"));
  try {
    const manifestPath = path.join(dir, "latest.yml");
    writeFileSync(manifestPath, body);
    return run(manifestPath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

const manifest = [
  "version: 0.14.0-beta.1.mf.2",
  "files:",
  "  - url: Paseo-Setup-0.14.0-beta.1.mf.2-x64.exe",
  "    sha512: abc",
  "    size: 10",
  "path: Paseo-Setup-0.14.0-beta.1.mf.2-x64.exe",
  "sha512: abc",
  "releaseDate: '2026-11-05T00:00:00.000Z'",
  "",
].join("\n");

test("prefixes every file url and the path with the version directory", () => {
  const output = withManifest(manifest, (manifestPath) =>
    prepareForkManifest({
      manifestPath,
      version: "0.14.0-beta.1.mf.2",
      availableFiles: ["Paseo-Setup-0.14.0-beta.1.mf.2-x64.exe"],
    }),
  );
  const parsed = load(output);
  assert.equal(parsed.files[0].url, "0.14.0-beta.1.mf.2/Paseo-Setup-0.14.0-beta.1.mf.2-x64.exe");
  assert.equal(parsed.path, "0.14.0-beta.1.mf.2/Paseo-Setup-0.14.0-beta.1.mf.2-x64.exe");
  assert.equal(parsed.sha512, "abc");
  assert.equal(parsed.releaseDate, "2026-11-05T00:00:00.000Z");
});

test("rejects a manifest that names a file the release lacks", () => {
  assert.throws(
    () =>
      withManifest(manifest, (manifestPath) =>
        prepareForkManifest({ manifestPath, version: "0.14.0-beta.1.mf.2", availableFiles: [] }),
      ),
    /names files the release lacks/,
  );
});

test("rejects a manifest built for another version", () => {
  assert.throws(
    () =>
      withManifest(manifest, (manifestPath) =>
        prepareForkManifest({
          manifestPath,
          version: "0.14.0-beta.1.mf.3",
          availableFiles: ["Paseo-Setup-0.14.0-beta.1.mf.2-x64.exe"],
        }),
      ),
    /expected 0\.14\.0-beta\.1\.mf\.3/,
  );
});

test("rejects a manifest without files", () => {
  assert.throws(
    () =>
      withManifest("version: 1.0.0-mf.1\nfiles: []\n", (manifestPath) =>
        prepareForkManifest({ manifestPath, version: "1.0.0-mf.1", availableFiles: [] }),
      ),
    /lists no files/,
  );
});
