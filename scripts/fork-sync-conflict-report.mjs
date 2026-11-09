import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { parseArgs } from "node:util";
import { isMainModule } from "./is-main-module.mjs";

// Builds the GitHub issue title and Markdown body for a blocked upstream sync.
// Run it while the conflicted merge is still in the work tree: the conflict
// hunks come from `git diff`, which only shows markers before `merge --abort`.
// Git is called without a shell and the output is written to files, so commit
// subjects and file names from upstream never reach a shell or a workflow
// expression.

// GitHub rejects issue and comment bodies over 65536 characters.
const DEFAULT_MAX_BODY_CHARS = 60000;
const DEFAULT_MAX_HUNK_LINES = 150;
const MAX_LINE_CHARS = 400;
const MAX_COMMITS_PER_SIDE = 20;
const MAX_LISTED_FILES = 200;
const ZERO_WIDTH_SPACE = "​";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

// Commit subjects and author names are untrusted. Break @mentions, `#123`
// references (they would point at this repository, not upstream) and HTML.
function sanitizeInline(text) {
  return text
    .replaceAll("@", `@${ZERO_WIDTH_SPACE}`)
    .replace(/#(\d)/g, `#${ZERO_WIDTH_SPACE}$1`)
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// One HTML comment with the fields that automation reads from the issue body.
// JSON keeps `<` and `>` as escapes, so no file name can close the comment.
const MACHINE_BLOCK_PREFIX = "<!-- fork-sync-conflict:v1 ";

function machineBlock(fields) {
  const json = JSON.stringify(fields).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  return `${MACHINE_BLOCK_PREFIX}${json} -->`;
}

function fenceFor(content) {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function fencedBlock(language, content) {
  const fence = fenceFor(content);
  return `${fence}${language}\n${content}\n${fence}`;
}

function commitList({ cwd, range, file, repo }) {
  const output = git(cwd, ["log", "--format=%h%x09%s%x09%an", range, "--", file]);
  if (output === "") {
    return ["_None._"];
  }
  const rows = output.split("\n");
  const lines = rows.slice(0, MAX_COMMITS_PER_SIDE).map((row) => {
    const [sha, subject = "", author = ""] = row.split("\t");
    return `- [\`${sha}\`](https://github.com/${repo}/commit/${sha}) ${sanitizeInline(subject)} (${sanitizeInline(author)})`;
  });
  if (rows.length > MAX_COMMITS_PER_SIDE) {
    lines.push(`- _and ${rows.length - MAX_COMMITS_PER_SIDE} more_`);
  }
  return lines;
}

function conflictHunks({ cwd, file, maxHunkLines }) {
  const diff = git(cwd, ["diff", "--", file]);
  if (diff === "") {
    return "_Git shows no textual hunks for this file (for example a delete/modify or binary conflict). Inspect it locally._";
  }
  const lines = diff
    .split("\n")
    .map((line) =>
      line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)} [line truncated]` : line,
    );
  const kept = lines.slice(0, maxHunkLines);
  let block = fencedBlock("diff", kept.join("\n"));
  if (lines.length > maxHunkLines) {
    block += `\n_Truncated: ${maxHunkLines} of ${lines.length} lines shown. Run \`git diff -- ${file}\` in the conflicted merge for the rest._`;
  }
  return block;
}

export function buildConflictReport({
  cwd = process.cwd(),
  upstreamRef = "upstream/main",
  upstreamRepo = "getpaseo/paseo",
  forkRepo,
  runUrl,
  date = new Date().toISOString().slice(0, 10),
  test = false,
  maxHunkLines = DEFAULT_MAX_HUNK_LINES,
  maxBodyChars = DEFAULT_MAX_BODY_CHARS,
}) {
  const files = git(cwd, ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter((name) => name !== "");
  if (files.length === 0) {
    throw new Error("No unmerged files: run this during a conflicted merge.");
  }

  const mergeBase = git(cwd, ["merge-base", "HEAD", upstreamRef]);
  const upstreamFull = git(cwd, ["rev-parse", upstreamRef]);
  const forkFull = git(cwd, ["rev-parse", "HEAD"]);
  const oldSha = git(cwd, ["rev-parse", "--short=9", mergeBase]);
  const newSha = git(cwd, ["rev-parse", "--short=9", upstreamRef]);
  const forkSha = git(cwd, ["rev-parse", "--short=9", "HEAD"]);
  const upstreamCount = git(cwd, ["rev-list", "--count", `${mergeBase}..${upstreamRef}`]);
  const compareUrl = `https://github.com/${upstreamRepo}/compare/${oldSha}...${newSha}`;

  const listedFiles = files.slice(0, MAX_LISTED_FILES).map((file) => `- \`${file}\``);
  if (files.length > MAX_LISTED_FILES) {
    listedFiles.push(`- _and ${files.length - MAX_LISTED_FILES} more_`);
  }

  const machine = {
    schema: 1,
    label: "upstream-sync-conflict",
    test,
    upstream_repo: upstreamRepo,
    upstream_sha: upstreamFull,
    fork_repo: forkRepo,
    fork_ref: "main",
    fork_sha: forkFull,
    merge_base: mergeBase,
    files,
    run_url: runUrl,
    detected: date,
  };

  const header = [
    machineBlock(machine),
    "",
    "## Upstream sync conflict",
    "",
    `The daily sync could not merge \`${upstreamRepo}\` into the fork. The merge was aborted and nothing was pushed.`,
    "",
    `- Upstream range: [\`${oldSha}...${newSha}\`](${compareUrl}) (${upstreamCount} commits)`,
    `- Fork \`main\`: [\`${forkSha}\`](https://github.com/${forkRepo}/commit/${forkSha})`,
    `- Run: ${runUrl}`,
    `- Detected: ${date}`,
    "",
    `### Conflicting files (${files.length})`,
    "",
    ...listedFiles,
    "",
  ].join("\n");

  const resolve = [
    "### How to resolve",
    "",
    fencedBlock(
      "bash",
      [
        "git fetch upstream && git checkout -b sync/upstream-" +
          date +
          " origin/main && git merge upstream/main",
        "# resolve the files above and keep fork behavior, then:",
        "git add -A && git commit",
        "npm run typecheck && npm run lint",
        "git push origin HEAD",
      ].join("\n"),
    ),
    "",
    "Open a pull request from the branch (or merge it into `main` yourself), then re-run the sync:",
    "",
    fencedBlock(
      "bash",
      `gh workflow run fork-upstream-sync.yml -R ${forkRepo} -f force_build=true`,
    ),
    "",
    "A later successful sync closes this issue.",
    "",
  ].join("\n");

  const sections = files.map((file) => {
    const details = [
      `#### \`${file}\``,
      "",
      "Upstream commits that touched it:",
      "",
      ...commitList({ cwd, range: `${mergeBase}..${upstreamRef}`, file, repo: upstreamRepo }),
      "",
      "Fork commits since the merge base that touched it:",
      "",
      ...commitList({ cwd, range: `${mergeBase}..HEAD`, file, repo: forkRepo }),
      "",
    ].join("\n");
    const hunks = ["Conflict hunks:", "", conflictHunks({ cwd, file, maxHunkLines }), ""].join(
      "\n",
    );
    return { file, details, hunks };
  });

  let remaining = maxBodyChars - header.length - resolve.length - 400;
  const rendered = [];
  let omitted = 0;
  let hunksDropped = 0;
  for (const { file, details, hunks } of sections) {
    if (details.length + hunks.length <= remaining) {
      rendered.push(details + hunks);
      remaining -= details.length + hunks.length;
    } else if (details.length + 120 <= remaining) {
      rendered.push(
        `${details}_Conflict hunks omitted to stay under the GitHub size limit. Run \`git diff -- ${file}\` in the conflicted merge._\n`,
      );
      remaining -= details.length + 120;
      hunksDropped += 1;
    } else {
      omitted += 1;
    }
  }

  const notes = [];
  if (hunksDropped > 0) {
    notes.push(
      `Conflict hunks were left out for ${hunksDropped} file(s) to stay under the GitHub size limit.`,
    );
  }
  if (omitted > 0) {
    notes.push(`Details for ${omitted} file(s) were left out to stay under the GitHub size limit.`);
  }

  const body = [
    header,
    "### Details per file",
    "",
    ...(notes.length > 0 ? [`> ${notes.join(" ")}`, ""] : []),
    rendered.join("\n"),
    resolve,
  ].join("\n");

  return {
    title: `${test ? "[test] " : ""}Upstream sync conflict: ${files.length} ${files.length === 1 ? "file" : "files"} (upstream ${newSha})`,
    body,
    files,
    machine,
  };
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      "body-out": { type: "string" },
      "title-out": { type: "string" },
      "run-url": { type: "string" },
      repo: { type: "string" },
      date: { type: "string" },
      "upstream-ref": { type: "string" },
      test: { type: "boolean" },
    },
  });
  for (const key of ["body-out", "title-out", "run-url", "repo"]) {
    if (!values[key]) {
      console.error(
        "Usage: node scripts/fork-sync-conflict-report.mjs --body-out <file> --title-out <file> --run-url <url> --repo <owner/name> [--date YYYY-MM-DD] [--upstream-ref <ref>] [--test]",
      );
      process.exit(2);
    }
  }
  const report = buildConflictReport({
    forkRepo: values.repo,
    runUrl: values["run-url"],
    date: values.date,
    upstreamRef: values["upstream-ref"],
    test: values.test === true,
  });
  fs.writeFileSync(values["body-out"], report.body);
  fs.writeFileSync(values["title-out"], report.title);
  console.log(
    `Wrote conflict report for ${report.files.length} file(s) (${report.body.length} chars).`,
  );
}
