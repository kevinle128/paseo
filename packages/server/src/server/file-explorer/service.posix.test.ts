// POSIX-only: symlink fixtures
/* eslint-disable max-nested-callbacks */
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getDownloadableFileInfo,
  inspectExplorerPath,
  listDirectoryEntries,
  readExplorerFile,
} from "./service.js";
import { isPlatform } from "../../test-utils/platform.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe.skipIf(isPlatform("win32"))("service POSIX-only", () => {
  it("lists directory entries even when a dangling symlink exists", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      await mkdir(path.join(root, "packages", "server"), { recursive: true });
      const serverDir = path.join(root, "packages", "server");
      await writeFile(path.join(serverDir, "README.md"), "# server\n", "utf-8");
      await symlink("CLAUDE.md", path.join(serverDir, "AGENTS.md"));

      const result = await listDirectoryEntries({
        root,
        relativePath: "packages/server",
      });

      expect(result.path).toBe("packages/server");
      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("README.md");
      expect(names).not.toContain("AGENTS.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinked files that resolve outside the workspace", async () => {
    const root = await createTempDir("paseo-file-explorer-");
    const outsideRoot = await createTempDir("paseo-file-explorer-outside-");

    try {
      const externalFile = path.join(outsideRoot, "secret.txt");
      await writeFile(externalFile, "top secret\n", "utf-8");
      await symlink(externalFile, path.join(root, "secret-link.txt"));

      await expect(
        readExplorerFile({
          root,
          relativePath: "secret-link.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("skips listed symlink entries that resolve outside the workspace", async () => {
    const root = await createTempDir("paseo-file-explorer-");
    const outsideRoot = await createTempDir("paseo-file-explorer-outside-");

    try {
      await writeFile(path.join(root, "visible.txt"), "visible\n", "utf-8");
      const externalFile = path.join(outsideRoot, "secret.txt");
      await writeFile(externalFile, "top secret\n", "utf-8");
      await symlink(externalFile, path.join(root, "secret-link.txt"));

      const result = await listDirectoryEntries({ root });

      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("visible.txt");
      expect(names).not.toContain("secret-link.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("uses canonical paths for downloadable symlink targets inside the workspace", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      const target = path.join(root, "safe.txt");
      const link = path.join(root, "safe-link.txt");
      await writeFile(target, "safe\n", "utf-8");
      await symlink("safe.txt", link);

      const file = await readExplorerFile({
        root,
        relativePath: "safe-link.txt",
      });
      const info = await getDownloadableFileInfo({
        root,
        relativePath: "safe-link.txt",
      });

      expect(file.path).toBe("safe-link.txt");
      expect(file.content).toBe("safe\n");
      expect(info.path).toBe("safe-link.txt");
      expect(info.fileName).toBe("safe-link.txt");
      expect(info.absolutePath).toBe(await realpath(target));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("inspects a symlink as a symlink without following it, even when the target is outside", async () => {
    const root = await createTempDir("paseo-file-explorer-");
    const outsideRoot = await createTempDir("paseo-file-explorer-outside-");

    try {
      const externalFile = path.join(outsideRoot, "secret.txt");
      await writeFile(externalFile, "top secret\n", "utf-8");
      await symlink(externalFile, path.join(root, "escape-link"));

      const inspection = await inspectExplorerPath({ root, relativePath: "escape-link" });

      expect(inspection.exists).toBe(true);
      expect(inspection.kind).toBe("symlink");
      expect(Object.keys(inspection).sort()).toEqual(["exists", "kind", "size"]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("refuses to inspect a path below a symlinked directory that leaves the workspace", async () => {
    const root = await createTempDir("paseo-file-explorer-");
    const outsideRoot = await createTempDir("paseo-file-explorer-outside-");

    try {
      await writeFile(path.join(outsideRoot, "secret.txt"), "top secret\n", "utf-8");
      await symlink(outsideRoot, path.join(root, "outside-dir"));

      await expect(
        inspectExplorerPath({ root, relativePath: "outside-dir/secret.txt" }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("refuses a path below an escaping symlink whether or not the outside path exists", async () => {
    const root = await createTempDir("paseo-file-explorer-");
    const outsideRoot = await createTempDir("paseo-file-explorer-outside-");

    try {
      await mkdir(path.join(outsideRoot, "present"));
      await symlink(outsideRoot, path.join(root, "outside-dir"));
      await symlink(path.join(outsideRoot, "gone"), path.join(root, "dangling-outside"));

      for (const relativePath of [
        "outside-dir/present/probe",
        "outside-dir/absent/probe",
        "dangling-outside/probe",
      ]) {
        await expect(inspectExplorerPath({ root, relativePath })).rejects.toThrow(
          "Access outside of workspace is not allowed",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("follows symlinked parent directories that stay inside the workspace", async () => {
    const root = await createTempDir("paseo-file-explorer-");

    try {
      await mkdir(path.join(root, "real"));
      await writeFile(path.join(root, "real", "notes.txt"), "hello", "utf-8");
      await symlink("real", path.join(root, "relative-link"));
      await symlink(path.join(root, "real"), path.join(root, "absolute-link"));

      for (const relativePath of ["relative-link/notes.txt", "absolute-link/notes.txt"]) {
        await expect(inspectExplorerPath({ root, relativePath })).resolves.toEqual({
          exists: true,
          kind: "file",
          size: 5,
        });
      }
      await expect(
        inspectExplorerPath({ root, relativePath: "relative-link/missing/notes.txt" }),
      ).resolves.toEqual({ exists: false, kind: null, size: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("inspects the workspace root as a directory when the root is a symlink", async () => {
    const realRoot = await createTempDir("paseo-file-explorer-real-");
    const linkParent = await createTempDir("paseo-file-explorer-link-");
    const root = path.join(linkParent, "workspace-link");

    try {
      await symlink(realRoot, root);

      const inspection = await inspectExplorerPath({ root, relativePath: "." });

      expect(inspection).toMatchObject({ exists: true, kind: "directory" });
    } finally {
      await rm(linkParent, { recursive: true, force: true });
      await rm(realRoot, { recursive: true, force: true });
    }
  });
});
