import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildConflictReport } from "./fork-sync-conflict-report.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commitFile(cwd, name, content, message, author = "Dev One") {
  writeFileSync(path.join(cwd, name), content);
  git(cwd, "add", name);
  git(
    cwd,
    "-c",
    `user.name=${author}`,
    "-c",
    "user.email=dev@example.com",
    "commit",
    "-m",
    message,
  );
}

// Builds a work tree in the middle of a conflicted merge of `upstream/main`.
function withConflictedMerge({ lines = 3, fileName = "shared.txt" } = {}, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-sync-report-"));
  try {
    const upstream = path.join(dir, "upstream");
    const fork = path.join(dir, "fork");
    git(dir, "init", "-q", "-b", "main", upstream);
    const text = (tag) =>
      Array.from({ length: lines }, (_, i) => `${tag} line ${i}`).join("\n") + "\n";
    commitFile(upstream, fileName, text("base"), "base");
    commitFile(upstream, "clean.txt", "clean\n", "add clean");
    git(dir, "clone", "-q", upstream, fork);
    git(fork, "remote", "rename", "origin", "upstream");
    commitFile(fork, fileName, text("fork"), "fork edits shared @octocat #12", "Fork Dev");
    commitFile(upstream, fileName, text("up"), "upstream edits shared <b>x</b> #34", "Up Dev");
    git(fork, "fetch", "-q", "--no-tags", "upstream", "main");
    assert.throws(() =>
      git(
        fork,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "merge",
        "--no-edit",
        "upstream/main",
      ),
    );
    return run(fork);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

const machineBlockPattern = /^<!-- fork-sync-conflict:v1 (\{.*?\}) -->$/m;

function readMachineBlock(body) {
  const match = body.match(machineBlockPattern);
  assert.ok(match, "body has a machine block");
  return { line: match[0], fields: JSON.parse(match[1]) };
}

const options = {
  forkRepo: "kevinle128/paseo",
  runUrl: "https://example.test/run/1",
  date: "2026-11-07",
};

test("report lists files, both commit sides, hunks and resolve commands", () => {
  withConflictedMerge({}, (cwd) => {
    const { title, body, files } = buildConflictReport({ cwd, ...options });
    assert.deepEqual(files, ["shared.txt"]);
    assert.match(title, /^Upstream sync conflict: 1 file \(upstream [0-9a-f]{9}\)$/);
    assert.match(
      body,
      /https:\/\/github\.com\/getpaseo\/paseo\/compare\/[0-9a-f]{9}\.\.\.[0-9a-f]{9}/,
    );
    assert.match(body, /github\.com\/getpaseo\/paseo\/commit\/[0-9a-f]+/);
    assert.match(body, /github\.com\/kevinle128\/paseo\/commit\/[0-9a-f]+/);
    assert.match(body, /<<<<<<<|\+<<<<<<<|\+\+<<<<<<</);
    assert.match(
      body,
      /git checkout -b sync\/upstream-2026-11-07 origin\/main && git merge upstream\/main/,
    );
    assert.match(body, /gh workflow run fork-upstream-sync\.yml -R kevinle128\/paseo/);
    assert.match(body, /https:\/\/example\.test\/run\/1/);
  });
});

test("untrusted commit text cannot mention users, link issues or inject html", () => {
  withConflictedMerge({}, (cwd) => {
    const { body } = buildConflictReport({ cwd, ...options });
    assert.ok(!body.includes("@octocat"));
    assert.ok(!body.includes("#12"));
    assert.ok(!body.includes("#34"));
    assert.ok(!body.includes("<b>"));
  });
});

test("hunks are truncated per file with a note", () => {
  withConflictedMerge({ lines: 200 }, (cwd) => {
    const { body } = buildConflictReport({ cwd, ...options, maxHunkLines: 20 });
    assert.match(body, /Truncated: 20 of \d+ lines shown/);
  });
});

test("body stays under the size budget and says what was left out", () => {
  withConflictedMerge({ lines: 200 }, (cwd) => {
    const { body } = buildConflictReport({ cwd, ...options, maxBodyChars: 2500 });
    assert.ok(body.length <= 2500 + 400, `body is ${body.length} chars`);
    assert.match(body, /left out|omitted/);
  });
});

test("refuses to run outside a conflicted merge", () => {
  withConflictedMerge({}, (cwd) => {
    git(cwd, "merge", "--abort");
    assert.throws(() => buildConflictReport({ cwd, ...options }), /No unmerged files/);
  });
});

test("report starts with one machine block that holds full shas and the conflicted files", () => {
  withConflictedMerge({}, (cwd) => {
    const { body } = buildConflictReport({ cwd, ...options });
    const { line, fields } = readMachineBlock(body);
    assert.equal(body.split("\n")[0], line);
    assert.deepEqual(fields, {
      schema: 1,
      label: "upstream-sync-conflict",
      test: false,
      upstream_repo: "getpaseo/paseo",
      upstream_sha: git(cwd, "rev-parse", "upstream/main").trim(),
      fork_repo: "kevinle128/paseo",
      fork_ref: "main",
      fork_sha: git(cwd, "rev-parse", "HEAD").trim(),
      merge_base: git(cwd, "merge-base", "HEAD", "upstream/main").trim(),
      files: ["shared.txt"],
      run_url: "https://example.test/run/1",
      detected: "2026-11-07",
    });
    for (const sha of [fields.upstream_sha, fields.fork_sha, fields.merge_base]) {
      assert.match(sha, /^[0-9a-f]{40}$/);
    }
  });
});

test("a file name with comment or html markers cannot end the machine block", () => {
  withConflictedMerge({ fileName: "a-->b<c>.txt" }, (cwd) => {
    const { body } = buildConflictReport({ cwd, ...options });
    const { line, fields } = readMachineBlock(body);
    assert.equal(line.split("-->").length, 2);
    assert.ok(line.endsWith(" -->"));
    assert.deepEqual(fields.files, ["a-->b<c>.txt"]);
  });
});

test("a test report is marked in the block and the title", () => {
  withConflictedMerge({}, (cwd) => {
    const upstreamSha = git(cwd, "rev-parse", "upstream/main").trim();
    const { title, body } = buildConflictReport({
      cwd,
      ...options,
      upstreamRef: upstreamSha,
      test: true,
    });
    const { fields } = readMachineBlock(body);
    assert.equal(fields.test, true);
    assert.equal(fields.upstream_sha, upstreamSha);
    assert.equal(fields.fork_ref, "main");
    assert.match(title, /^\[test\] Upstream sync conflict: 1 file /);
  });
});
