import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FORK_HEADING,
  UPSTREAM_HEADING,
  buildFallback,
  buildPrompt,
  callChatCompletions,
  capText,
  cleanSubject,
  collectCommits,
  commitKind,
  compareUrl,
  generateChangelog,
  isNoiseSubject,
  parseSubject,
  selectItems,
  toItems,
} from "./fork-release-changelog.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

let counter = 0;
function commitFile(cwd, message) {
  counter += 1;
  writeFileSync(path.join(cwd, `file-${counter}.txt`), `${counter}\n`);
  git(cwd, "add", ".");
  git(
    cwd,
    "-c",
    "user.name=Dev",
    "-c",
    "user.email=dev@example.com",
    "commit",
    "-q",
    "-m",
    message,
  );
  return git(cwd, "rev-parse", "HEAD");
}

// upstream: base, up-1 (before the first release). Fork clones it, then:
//   fork-1 -> tag mf-desktop-v1 -> upstream gets up-2, up-3 -> merge -> fork-2.
function createRepos() {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-changelog-"));
  try {
    const upstream = path.join(dir, "upstream");
    const fork = path.join(dir, "fork");
    git(dir, "init", "-q", "-b", "main", upstream);
    commitFile(upstream, "chore: base");
    commitFile(upstream, "feat: old upstream feature");
    git(dir, "clone", "-q", upstream, fork);
    git(fork, "remote", "rename", "origin", "upstream");
    commitFile(fork, "feat(app): pinned grid view (#12)");
    git(fork, "tag", "mf-desktop-v1");
    commitFile(upstream, "feat(server): upstream agent presets");
    commitFile(upstream, "fix(app): upstream scroll bug @octocat");
    commitFile(upstream, "docs: upstream docs only");
    git(fork, "fetch", "-q", "--no-tags", "upstream", "main");
    git(
      fork,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "merge",
      "--no-edit",
      "-q",
      "upstream/main",
    );
    commitFile(fork, "fix(desktop): updater feed owner");
    commitFile(fork, "test(desktop): cover updater");
    commitFile(fork, "ci: tweak workflow");
    return {
      fork,
      head: git(fork, "rev-parse", "HEAD"),
      cleanup: () => rmSync(dir, { force: true, recursive: true }),
    };
  } catch (error) {
    rmSync(dir, { force: true, recursive: true });
    throw error;
  }
}

function withRepos(run) {
  const repos = createRepos();
  try {
    return run(repos);
  } finally {
    repos.cleanup();
  }
}

async function withReposAsync(run) {
  const repos = createRepos();
  try {
    return await run(repos);
  } finally {
    repos.cleanup();
  }
}

const subjects = (commits) => commits.map((commit) => commit.subject);

test("parseSubject reads type, scope and strips the pull request number", () => {
  assert.deepEqual(parseSubject("feat(app)!: Add thing (#42)"), {
    subject: "feat(app)!: Add thing",
    type: "feat",
    scope: "app",
    text: "Add thing",
  });
  assert.equal(parseSubject("Plain subject").type, null);
  assert.equal(cleanSubject("a\u0007b\nc"), "a b c");
  assert.equal(cleanSubject("x".repeat(300)).length, 200);
});

test("noise filter drops test, ci, docs, chore, style, build, merge and version subjects", () => {
  for (const subject of [
    "test: a",
    "ci(release): b",
    "docs: c",
    "chore: d",
    "style: e",
    "build(deps): f",
    "Merge branch 'x'",
    "v1.2.3",
    "Release 0.1.0",
    "bump deps",
    "feat(ci): c1",
    "fix(release): r1",
    "feat(CI): c2",
  ]) {
    assert.equal(isNoiseSubject(subject), true, subject);
  }
  for (const subject of [
    "feat: a",
    "fix(x): b",
    "refactor: c",
    "perf: d",
    "Add a thing",
    "feat(app): x",
    "fix(cli): y",
  ]) {
    assert.equal(isNoiseSubject(subject), false, subject);
  }
  assert.equal(commitKind("feat(x): a"), "feat");
  assert.equal(commitKind("fix: a"), "fix");
  assert.equal(commitKind("refactor: a"), "other");
  assert.equal(commitKind("Add a thing"), "other");
});

test("collectCommits splits fork and upstream commits since the previous tag", () => {
  withRepos(({ fork, head }) => {
    const result = collectCommits({ cwd: fork, previousTag: "mf-desktop-v1", head });
    assert.deepEqual(subjects(result.fork), [
      "ci: tweak workflow",
      "test(desktop): cover updater",
      "fix(desktop): updater feed owner",
    ]);
    assert.deepEqual(subjects(result.upstream), [
      "docs: upstream docs only",
      "fix(app): upstream scroll bug @octocat",
      "feat(server): upstream agent presets",
    ]);
    assert.ok(result.upstreamCompare);
    assert.notEqual(result.upstreamCompare.from, result.upstreamCompare.to);
    assert.deepEqual(result.warnings, []);
  });
});

test("collectCommits without a previous tag starts at the upstream merge base", () => {
  withRepos(({ fork, head }) => {
    const result = collectCommits({ cwd: fork, previousTag: "", head });
    assert.ok(subjects(result.fork).includes("feat(app): pinned grid view (#12)"));
    assert.ok(!subjects(result.upstream).includes("feat: old upstream feature"));
    assert.ok(!subjects(result.fork).includes("feat: old upstream feature"));
    assert.equal(result.upstreamCompare, null);
  });
});

test("collectCommits warns for an unknown tag and a missing upstream ref", () => {
  withRepos(({ fork, head }) => {
    const unknownTag = collectCommits({ cwd: fork, previousTag: "mf-desktop-v99", head });
    assert.match(unknownTag.warnings[0], /mf-desktop-v99 not found/);
    assert.ok(subjects(unknownTag.fork).includes("feat(app): pinned grid view (#12)"));

    const noUpstream = collectCommits({
      cwd: fork,
      previousTag: "mf-desktop-v1",
      head,
      upstreamRef: "nowhere/main",
    });
    assert.match(noUpstream.warnings[0], /nowhere\/main is not available/);
    assert.equal(noUpstream.upstream.length, 0);
    assert.ok(subjects(noUpstream.fork).includes("feat(server): upstream agent presets"));
  });
});

test("collectCommits caps the number of commits", () => {
  withRepos(({ fork, head }) => {
    const result = collectCommits({ cwd: fork, previousTag: "mf-desktop-v1", head, maxCommits: 2 });
    assert.equal(result.fork.length + result.upstream.length, 2);
  });
});

test("collectCommits rejects an unknown head", () => {
  withRepos(({ fork }) => {
    assert.throws(() => collectCommits({ cwd: fork, head: "does-not-exist" }), /Cannot resolve/);
  });
});

test("selectItems keeps features first and honours item and character limits", () => {
  const items = toItems([
    { sha: "1", subject: "refactor: a" },
    { sha: "2", subject: "fix: b" },
    { sha: "3", subject: "feat: c" },
  ]);
  const { kept, omitted } = selectItems(items, 2, 10000);
  assert.deepEqual(
    kept.map((item) => item.kind),
    ["feat", "fix"],
  );
  assert.equal(omitted, 1);
  assert.equal(selectItems(items, 10, 5).kept.length, 0);
});

test("buildPrompt carries the rules, both sections and the omitted count", () => {
  const many = Array.from({ length: 70 }, (_, i) => ({ sha: String(i), subject: `fix: bug ${i}` }));
  const prompt = buildPrompt({
    version: "0.14.0-mf.3",
    fork: toItems(many),
    upstream: toItems([{ sha: "u", subject: "feat(server): presets" }]),
  });
  assert.match(prompt.system, /Vietnamese/);
  assert.match(prompt.system, /do not invent/);
  assert.match(prompt.system, /Keep technical names in English/);
  assert.ok(prompt.system.includes(FORK_HEADING));
  assert.ok(prompt.system.includes(UPSTREAM_HEADING));
  assert.match(prompt.user, /Release version: 0\.14\.0-mf\.3/);
  assert.match(prompt.user, /FORK COMMITS .*60 shown, 10 more omitted/);
  assert.match(prompt.user, /- \[feat\] feat\(server\): presets/);

  const forkOnly = buildPrompt({ version: "1", fork: toItems(many.slice(0, 1)), upstream: [] });
  assert.ok(!forkOnly.user.includes("UPSTREAM COMMITS"));
});

test("buildFallback lists the raw changes with a Vietnamese note and the compare link", () => {
  const fork = toItems(
    Array.from({ length: 17 }, (_, i) => ({ sha: String(i), subject: `fix: bug ${i}` })),
  );
  const upstream = toItems([{ sha: "u", subject: "feat: presets @octocat" }]);
  const text = buildFallback({
    fork,
    upstream,
    reason: "thiếu OPENAI_API_KEY",
    upstreamUrl: "https://github.com/getpaseo/paseo/compare/aaa...bbb",
  });
  assert.match(text, /^_Không tạo được bản tóm tắt tiếng Việt \(thiếu OPENAI_API_KEY\)/);
  assert.ok(text.includes(FORK_HEADING));
  assert.ok(text.includes(UPSTREAM_HEADING));
  assert.match(text, /- … và 2 thay đổi khác/);
  assert.ok(text.includes("compare/aaa...bbb"));
  assert.ok(!text.includes("@octocat"), "mentions are escaped");
});

test("capText cuts at a line boundary", () => {
  const text = Array.from({ length: 100 }, (_, i) => `- line ${i}`).join("\n");
  const capped = capText(text, 100);
  assert.ok(capped.length <= 110);
  assert.ok(capped.endsWith("\n- …"));
  assert.equal(capText("short", 100), "short");
});

test("compareUrl is null without a range", () => {
  assert.equal(compareUrl("getpaseo/paseo", null), null);
  assert.equal(
    compareUrl("getpaseo/paseo", { from: "a".repeat(40), to: "b".repeat(40) }),
    `https://github.com/getpaseo/paseo/compare/${"a".repeat(12)}...${"b".repeat(12)}`,
  );
});

function okResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { role: "assistant", content: text } }] }),
  };
}

const baseEnv = {
  OPENAI_BASE_URL: "https://llm.example.ts.net/v1",
  OPENAI_API_KEY: "k",
  OPENAI_MODEL: "m",
};

const apiOptions = {
  baseUrl: "https://llm.example.ts.net/v1/",
  apiKey: "test-key",
  model: "m",
  system: "s",
  user: "u",
  retryDelayMs: 0,
};

test("callChatCompletions sends the request and returns the text blocks", async () => {
  let seen;
  const text = await callChatCompletions({
    ...apiOptions,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return okResponse("  xin chào  ");
    },
  });
  assert.equal(text, "xin chào");
  assert.equal(seen.url, "https://llm.example.ts.net/v1/chat/completions");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, "Bearer test-key");
  assert.equal(seen.init.headers["content-type"], "application/json");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, "m");
  assert.ok(body.temperature <= 0.3);
  assert.ok(body.max_tokens > 0);
  assert.deepEqual(body.messages, [
    { role: "system", content: "s" },
    { role: "user", content: "u" },
  ]);
});

test("callChatCompletions retries once on a server error and then succeeds", async () => {
  let calls = 0;
  const text = await callChatCompletions({
    ...apiOptions,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 503 } : okResponse("ok");
    },
  });
  assert.equal(text, "ok");
  assert.equal(calls, 2);
});

test("callChatCompletions fails after one retry on repeated server errors", async () => {
  let calls = 0;
  await assert.rejects(
    callChatCompletions({
      ...apiOptions,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 500 };
      },
    }),
    /HTTP 500/,
  );
  assert.equal(calls, 2);
});

test("callChatCompletions does not retry a client error", async () => {
  let calls = 0;
  await assert.rejects(
    callChatCompletions({
      ...apiOptions,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 401 };
      },
    }),
    /HTTP 401/,
  );
  assert.equal(calls, 1);
});

test("callChatCompletions times out a request that never answers", async () => {
  let calls = 0;
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => {
      calls += 1;
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  await assert.rejects(
    callChatCompletions({ ...apiOptions, timeoutMs: 20, fetchImpl: hang }),
    /hết thời gian chờ/,
  );
  assert.equal(calls, 2);
});

test("callChatCompletions rejects an empty answer", async () => {
  await assert.rejects(
    callChatCompletions({ ...apiOptions, fetchImpl: async () => okResponse("   ") }),
    /nội dung rỗng/,
  );
});

test("generateChangelog returns the model answer, escaped, with the upstream link", async () => {
  await withReposAsync(async ({ fork, head }) => {
    let requestBody;
    const result = await generateChangelog({
      cwd: fork,
      previousTag: "mf-desktop-v1",
      head,
      version: "0.14.0-mf.2",
      env: { ...baseEnv, OPENAI_MODEL: "custom-model" },
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(init.body);
        return okResponse(
          `${FORK_HEADING}\n- Sửa lỗi updater @octocat\n\n${UPSTREAM_HEADING}\n- Preset agent mới`,
        );
      },
      retryDelayMs: 0,
      log: () => {},
    });
    assert.equal(result.source, "llm");
    assert.equal(result.model, "custom-model");
    assert.equal(requestBody.model, "custom-model");
    assert.ok(
      !requestBody.messages[1].content.includes("tweak workflow"),
      "ci commits are filtered",
    );
    assert.ok(
      !requestBody.messages[1].content.includes("cover updater"),
      "test commits are filtered",
    );
    assert.ok(requestBody.messages[1].content.includes("[fix] fix(desktop): updater feed owner"));
    assert.ok(
      requestBody.messages[1].content.includes("[feat] feat(server): upstream agent presets"),
    );
    assert.ok(!result.markdown.includes("@octocat"));
    assert.match(
      result.markdown,
      /So sánh thay đổi upstream: https:\/\/github\.com\/getpaseo\/paseo\/compare\//,
    );
  });
});

test("generateChangelog posts to the configured endpoint", async () => {
  await withReposAsync(async ({ fork, head }) => {
    let seen;
    await generateChangelog({
      cwd: fork,
      previousTag: "mf-desktop-v1",
      head,
      env: { ...baseEnv, OPENAI_BASE_URL: "https://llm.example.ts.net/v1/" },
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return okResponse("x");
      },
      log: () => {},
    });
    assert.equal(seen.url, "https://llm.example.ts.net/v1/chat/completions");
    assert.equal(seen.init.headers.authorization, "Bearer k");
  });
});

for (const [name, key, code, note] of [
  ["base URL", "OPENAI_BASE_URL", "missing-base-url", /thiếu OPENAI_BASE_URL/],
  ["key", "OPENAI_API_KEY", "missing-key", /thiếu OPENAI_API_KEY/],
  ["model", "OPENAI_MODEL", "missing-model", /chưa cấu hình model/],
]) {
  test(`generateChangelog falls back without a ${name} and never calls the API`, async () => {
    await withReposAsync(async ({ fork, head }) => {
      const result = await generateChangelog({
        cwd: fork,
        previousTag: "mf-desktop-v1",
        head,
        env: { ...baseEnv, [key]: "  " },
        fetchImpl: async () => {
          throw new Error("must not be called");
        },
        log: () => {},
      });
      assert.equal(result.source, "fallback");
      assert.equal(result.reason, code);
      assert.match(result.markdown, note);
      assert.ok(result.markdown.includes("- fix(desktop): updater feed owner"));
    });
  });
}

test("generateChangelog falls back on an API error", async () => {
  await withReposAsync(async ({ fork, head }) => {
    const result = await generateChangelog({
      cwd: fork,
      previousTag: "mf-desktop-v1",
      head,
      env: baseEnv,
      fetchImpl: async () => ({ ok: false, status: 401 }),
      retryDelayMs: 0,
      log: () => {},
    });
    assert.equal(result.source, "fallback");
    assert.equal(result.reason, "api-error");
    assert.match(result.markdown, /HTTP 401/);
  });
});

test("generateChangelog falls back on a timeout", async () => {
  await withReposAsync(async ({ fork, head }) => {
    const result = await generateChangelog({
      cwd: fork,
      previousTag: "mf-desktop-v1",
      head,
      env: baseEnv,
      timeoutMs: 20,
      retryDelayMs: 0,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
      log: () => {},
    });
    assert.equal(result.source, "fallback");
    assert.match(result.markdown, /hết thời gian chờ/);
  });
});

test("generateChangelog reports no changes when only noise commits exist", async () => {
  await withReposAsync(async ({ fork, head }) => {
    commitFile(fork, "docs: only docs");
    const newHead = git(fork, "rev-parse", "HEAD");
    git(fork, "tag", "mf-desktop-v2", head);
    const result = await generateChangelog({
      cwd: fork,
      previousTag: "mf-desktop-v2",
      head: newHead,
      env: baseEnv,
      fetchImpl: async () => {
        throw new Error("must not be called");
      },
      log: () => {},
    });
    assert.equal(result.source, "empty");
  });
});

test("generateChangelog does not throw when git cannot read the history", async () => {
  const result = await generateChangelog({
    cwd: tmpdir(),
    head: "HEAD",
    env: baseEnv,
    log: () => {},
  });
  assert.equal(result.source, "fallback");
  assert.equal(result.reason, "git");
});
