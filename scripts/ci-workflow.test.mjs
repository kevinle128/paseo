import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relative as relativePath } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const repoRoot = new URL("../", import.meta.url);
const ciWorkflowPath = new URL(".github/workflows/ci.yml", repoRoot);
const dockerWorkflowPath = new URL(".github/workflows/docker.yml", repoRoot);
const nixWorkflowPath = new URL(".github/workflows/nix.yml", repoRoot);
const filtersPath = new URL(".github/ci-paths.yml", repoRoot);
const serverTsconfigPath = new URL("packages/server/tsconfig.server.json", repoRoot);
const desktopPackagePath = new URL("packages/desktop/package.json", repoRoot);

const gatedCiJobs = new Map([
  ["quality", { name: "quality", contracts: ["format", "quality", "relay", "sdk"] }],
  ["typecheck", { name: "typecheck", contract: "quality" }],
  ["server-tests-ubuntu", { name: "server-tests (ubuntu-latest)", contracts: ["server", "hub"] }],
  ["server-tests-windows", { name: "server-tests (windows-latest)", contracts: ["server", "hub"] }],
  [
    "server-integration-windows",
    { name: "server-integration (windows-latest)", contract: "server" },
  ],
  [
    "server-tests-macos",
    { name: "server-tests (macos-latest, file observation)", contract: "server" },
  ],
  ["desktop-tests-ubuntu", { name: "desktop-tests (ubuntu-latest)", contract: "desktop" }],
  ["desktop-tests-windows", { name: "desktop-tests (windows-latest)", contract: "desktop" }],
  ["app-tests", { name: "app-tests", contract: "app" }],
  ["playwright-1", { name: "playwright (shard 1/8)", contract: "browser" }],
  ["playwright-2", { name: "playwright (shard 2/8)", contract: "browser" }],
  ["playwright-3", { name: "playwright (shard 3/8)", contract: "browser" }],
  ["playwright-4", { name: "playwright (shard 4/8)", contract: "browser" }],
  ["playwright-5", { name: "playwright (shard 5/8)", contract: "browser" }],
  ["playwright-6", { name: "playwright (shard 6/8)", contract: "browser" }],
  ["playwright-7", { name: "playwright (shard 7/8)", contract: "browser" }],
  ["playwright-8", { name: "playwright (shard 8/8)", contract: "browser" }],
  ["cli-tests-1", { name: "cli-tests (shard 1/3)", contract: "cli" }],
  ["cli-tests-2", { name: "cli-tests (shard 2/3)", contract: "cli" }],
  ["cli-tests-3", { name: "cli-tests (shard 3/3)", contract: "cli" }],
]);

function jobBlocks(source) {
  const jobs = new Map();
  let currentJob;

  for (const line of (source.split("\njobs:\n")[1] ?? source).split("\n")) {
    const jobMatch = /^  ([a-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      jobs.set(currentJob, []);
      continue;
    }
    if (currentJob) jobs.get(currentJob).push(line);
  }
  return jobs;
}

function loadFilters(path) {
  const filters = {};
  let currentFilter;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      currentFilter = filterMatch[1];
      filters[currentFilter] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (currentFilter && patternMatch) filters[currentFilter].push(patternMatch[1]);
  }
  return filters;
}

function filesUnder(relativeDirectory, predicate) {
  const directory = new URL(`${relativeDirectory}/`, repoRoot);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      [relativeDirectory, relativePath(directory.pathname, entry.parentPath), entry.name]
        .filter(Boolean)
        .join("/")
        .replaceAll("\\", "/"),
    )
    .filter(predicate)
    .sort();
}

test("gated checks are statically named jobs with real job-level gating", () => {
  const workflowSource = readFileSync(ciWorkflowPath, "utf8");
  const jobs = jobBlocks(workflowSource);
  const trigger = workflowSource.split("jobs:", 1)[0];

  assert.match(trigger, /^\s+merge_group:\s*$/m);
  assert.doesNotMatch(workflowSource, /strategy:\s*\n\s+matrix:/);
  assert.doesNotMatch(workflowSource, /RUN_TESTS|Skip unaffected|No .* changes detected/);

  for (const [jobId, expected] of gatedCiJobs) {
    const job = jobs.get(jobId)?.join("\n");
    assert.ok(job, `missing static job ${jobId}`);
    assert.match(job, new RegExp(`^    name: ${expected.name.replace(/[()]/g, "\\$&")}$`, "m"));
    assert.match(job, /needs\.changes\.outputs\.full != 'false'/);
    for (const contract of expected.contracts ?? [expected.contract]) {
      assert.match(job, new RegExp(`needs\\.changes\\.outputs\\.${contract} != 'false'`));
    }
  }
});

test("pull-request checks run for every base branch, including stacked PRs", () => {
  for (const workflowPath of [
    ciWorkflowPath,
    new URL(".github/workflows/desktop-packages.yml", repoRoot),
  ]) {
    const trigger = readFileSync(workflowPath, "utf8").split("jobs:", 1)[0];
    const pullRequest = trigger.match(/^  pull_request:\n((?:    .*\n)*)/m);
    assert.ok(pullRequest, `${workflowPath.pathname} runs on pull requests`);
    assert.doesNotMatch(pullRequest[1], /branches/);
  }
});

test("change gating allows superseded workflow runs to cancel", () => {
  const ci = readFileSync(ciWorkflowPath, "utf8");
  assert.match(
    ci,
    /^concurrency:\n  group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true$/m,
    "a newer push to any ref, main included, cancels the superseded run",
  );
  for (const workflowPath of [ciWorkflowPath, dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    assert.doesNotMatch(
      source,
      /\$\{\{\s*always\(\)/,
      "always() keeps jobs alive after concurrency cancellation; use !cancelled() for fail-open gating",
    );
  }
});

test("published npm packages declare and ship the repository license", () => {
  const rootManifest = JSON.parse(readFileSync(new URL("package.json", repoRoot), "utf8"));
  const workspaceArgs = rootManifest.scripts["release:publish"].match(/--workspace=\S+/g);
  assert.notEqual(workspaceArgs, null, "release:publish must select public packages");
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json", ...workspaceArgs], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
  const manifests = new Map(
    rootManifest.workspaces.map((workspace) => {
      const directory = new URL(`${workspace}/`, repoRoot);
      const manifest = JSON.parse(readFileSync(new URL("package.json", directory), "utf8"));
      return [manifest.name, { directory, manifest }];
    }),
  );
  const licenses = packed.map(({ name, files }) => ({
    name,
    license: manifests.get(name).manifest.license,
    files: files.filter((file) => file.path === "LICENSE").map((file) => file.path),
  }));
  assert.deepEqual(
    licenses,
    workspaceArgs.map((workspace) => ({
      name: workspace.slice("--workspace=".length),
      license: "Apache-2.0",
      files: ["LICENSE"],
    })),
  );
  const repositoryLicense = readFileSync(new URL("LICENSE", repoRoot), "utf8");
  for (const { name } of packed) {
    const { directory } = manifests.get(name);
    assert.equal(readFileSync(new URL("LICENSE", directory), "utf8"), repositoryLicense, name);
  }
});

test("focused contracts stay inside existing required checks", () => {
  const jobs = jobBlocks(readFileSync(ciWorkflowPath, "utf8"));
  const changes = jobs.get("changes")?.join("\n") ?? "";
  const server = jobs.get("server-tests-ubuntu")?.join("\n") ?? "";
  const desktop = jobs.get("desktop-tests-ubuntu")?.join("\n") ?? "";

  assert.match(changes, /scripts\/daemon-launch-contract\.test\.mjs/);
  assert.doesNotMatch(changes, /Install dependencies|npm run build/);

  assert.match(server, /test:hub-cli-contract/);
  assert.match(server, /npm run test --workspace=@getpaseo\/server/);
  assert.ok(!jobs.has("hub-cli-contract"));

  assert.match(desktop, /test:e2e:renderer/);
  assert.match(desktop, /test:e2e:browser-tabs/);
  assert.match(desktop, /npm run test --workspace=@getpaseo\/desktop/);
  assert.ok(!jobs.has("desktop-browser-bridge"));
  assert.ok(!jobs.has("playwright-desktop"));
});

test("ordinary CI keeps app tests without prebuilding Android modules", () => {
  const source = readFileSync(ciWorkflowPath, "utf8");
  const app = jobBlocks(source).get("app-tests").join("\n");
  assert.match(app, /npm run build:app-deps/);
  assert.match(app, /npm run test --workspace=@getpaseo\/app/);
  assert.doesNotMatch(source, /test:android|expo prebuild|gradlew|actions\/setup-java/);
});

test("server builds exclude test utilities at every domain depth", () => {
  const tsconfig = JSON.parse(readFileSync(serverTsconfigPath, "utf8"));
  assert.ok(tsconfig.exclude.includes("src/server/**/test-utils/**"));
  assert.ok(!tsconfig.exclude.includes("src/server/test-utils/**"));
});

test("PR routing declares stable behavior ownership", () => {
  const filters = loadFilters(filtersPath);
  assert.deepEqual(filters, {
    routing: [".github/ci-paths.yml"],
    workspace: [
      ".mise.toml",
      ".tool-versions",
      "package.json",
      "package-lock.json",
      "patches/**",
      "scripts/**",
      "tsconfig.json",
      "tsconfig.base.json",
      "vitest.config.ts",
    ],
    ci: [".github/actions/**", ".github/workflows/ci.yml"],
    format: [
      ".agents/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      ".github/**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}",
      "packages/expo-two-way-audio/**",
    ],
    quality: ["**/*.{cjs,js,json,jsx,mjs,ts,tsx}", "packages/expo-two-way-audio/**"],
    hub: ["packages/cli/src/commands/hub/**", "packages/server/src/server/hub/**"],
    server: ["plugins/**", "packages/server/**", "packages/app/e2e/support/fixtures/recording.*"],
    desktop: [
      "packages/desktop/**",
      "packages/app/src/desktop/**",
      "packages/app/src/**/*.electron.{ts,tsx}",
      "packages/server/src/server/browser-tools/**",
      "packages/app/e2e/support/**",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    app: ["packages/app/**", "packages/expo-two-way-audio/**"],
    sdk: [
      "packages/plugin/**",
      "plugin-examples/**",
      "public-docs/plugins/**",
      "packages/client/**",
      "packages/highlight/**",
      "packages/protocol/**",
    ],
    browser: [
      "packages/server/src/server/agent/provider-snapshot-manager.ts",
      "packages/server/src/server/session/provider/provider-catalog-session.ts",
      "packages/client/src/compat/normalize-provider-models.ts",
      "packages/protocol/src/client-capabilities.ts",
      "packages/server/src/server/agent/provider-registry.ts",
      "packages/server/src/server/agent/agent-sdk-types.ts",
      "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
      "packages/server/src/server/agent/providers/claude/agent.ts",
      "packages/server/src/server/agent/plugin-provider.ts",
      "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
      "packages/server/src/executable-resolution/**",
      "packages/plugin/src/server/provider.ts",
      "packages/app/src/!(desktop)/**",
      "packages/app/e2e/browser/**",
      "packages/app/e2e/support/**",
      "packages/app/assets/**",
      "packages/app/public/**",
      "packages/app/index.ts",
      "packages/app/*config.{cjs,js,ts}",
      "packages/app/package.json",
    ],
    relay: ["packages/relay/**"],
    cli: ["packages/cli/**"],
  });
});

test("cross-package invariants live in the suite that owns them", () => {
  const cliTests = filesUnder("packages/cli", (path) => path.endsWith(".test.ts"));
  assert.ok(cliTests.length > 0);
  for (const path of cliTests) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /server\/src\/server\/test-utils/,
      path,
    );
  }

  const protocolWireCompatibility = new URL(
    "packages/protocol/src/messages.wire-compat.test.ts",
    repoRoot,
  );
  assert.match(readFileSync(protocolWireCompatibility, "utf8"), /wire schema compatibility/);
});

test("browser and desktop tests have exclusive, directory-owned suites", () => {
  const filters = loadFilters(filtersPath);
  const browserSpecs = filesUnder("packages/app/e2e", (path) => path.endsWith(".spec.ts"));
  const desktopSpecs = filesUnder("packages/desktop/e2e", (path) => path.endsWith(".spec.ts"));

  assert.ok(browserSpecs.length > 0);
  assert.ok(desktopSpecs.length > 0);
  assert.ok(browserSpecs.every((path) => path.startsWith("packages/app/e2e/browser/")));
  assert.ok(desktopSpecs.every((path) => path.startsWith("packages/desktop/e2e/")));

  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  assert.match(desktopPackage.scripts.test, /--exclude ["']e2e\/\*\*["']/);

  for (const path of browserSpecs) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /paseoDesktop|injectDesktopBridge/,
    );
  }
  for (const path of desktopSpecs) {
    assert.ok(path.startsWith("packages/desktop/e2e/"));
  }

  const routingSource = readFileSync(filtersPath, "utf8");
  assert.doesNotMatch(routingSource, /desktop_bridge|playwright_desktop|browser-\*|browser-\*\//);
  assert.deepEqual(filters.desktop, [
    "packages/desktop/**",
    "packages/app/src/desktop/**",
    "packages/app/src/**/*.electron.{ts,tsx}",
    "packages/server/src/server/browser-tools/**",
    "packages/app/e2e/support/**",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
  assert.deepEqual(filters.browser, [
    "packages/server/src/server/agent/provider-snapshot-manager.ts",
    "packages/server/src/server/session/provider/provider-catalog-session.ts",
    "packages/client/src/compat/normalize-provider-models.ts",
    "packages/protocol/src/client-capabilities.ts",
    "packages/server/src/server/agent/provider-registry.ts",
    "packages/server/src/server/agent/agent-sdk-types.ts",
    "packages/server/src/server/agent/providers/codex-app-server-agent.ts",
    "packages/server/src/server/agent/providers/claude/agent.ts",
    "packages/server/src/server/agent/plugin-provider.ts",
    "packages/server/src/server/plugins/{index,plugin-process,plugin-process-protocol,runtime}.ts",
    "packages/server/src/executable-resolution/**",
    "packages/plugin/src/server/provider.ts",
    "packages/app/src/!(desktop)/**",
    "packages/app/e2e/browser/**",
    "packages/app/e2e/support/**",
    "packages/app/assets/**",
    "packages/app/public/**",
    "packages/app/index.ts",
    "packages/app/*config.{cjs,js,ts}",
    "packages/app/package.json",
  ]);
});

test("packaging runs on main without allocating pull-request runners", () => {
  for (const workflowPath of [dockerWorkflowPath, nixWorkflowPath]) {
    const source = readFileSync(workflowPath, "utf8");
    const trigger = source.split("jobs:", 1)[0];
    assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
    assert.doesNotMatch(trigger, /pull_request/);
    assert.doesNotMatch(source, /dorny\/paths-filter/);
  }
});

test("desktop packaging smokes main pushes and only the pull requests that touch packaging", () => {
  const source = readFileSync(new URL(".github/workflows/desktop-packages.yml", repoRoot), "utf8");
  const trigger = source.split("jobs:", 1)[0];
  assert.match(trigger, /push:\s*\n\s+branches: \[main\]/);
  assert.match(trigger, /pull_request:\s*\n\s+paths:/);
  assert.match(trigger, /- "packages\/desktop\/\*\*"/);
  assert.doesNotMatch(source, /dorny\/paths-filter/);
  for (const action of ["actions/checkout", "actions/setup-node", "actions/upload-artifact"]) {
    assert.match(source, new RegExp(`${action}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+`));
  }
});

test("stable iOS releases upload once and distribute to external testers before App Store review", () => {
  const source = readFileSync(
    new URL("packages/app/.eas/workflows/release-mobile.yml", repoRoot),
    "utf8",
  );
  const jobs = jobBlocks(source);
  const uploads = [...jobs.entries()].filter(
    ([, lines]) =>
      lines.some((line) => /^    type: (submit|testflight)$/.test(line)) &&
      lines.some((line) => line.includes("needs.build_ios.outputs.build_id")),
  );
  assert.equal(uploads.length, 1, "the iOS binary must be uploaded exactly once");
  const [distributionId, distributionLines] = uploads[0];
  const distribution = distributionLines.join("\n");
  assert.match(distribution, /^    type: testflight$/m);
  assert.match(distribution, /external_groups:\s*\n\s+- Paseo Beta/);
  assert.match(distribution, /^      submit_beta_review: true$/m);

  const review = jobs.get("submit_ios_for_review").join("\n");
  assert.match(review, new RegExp(`needs: \\[build_ios, ${distributionId}\\]`));
  assert.match(review, /APP_VERSION="\$\{\{ needs\.build_ios\.outputs\.app_version \}\}"/);
  assert.match(
    review,
    /APP_BUILD_VERSION="\$\{\{ needs\.build_ios\.outputs\.app_build_version \}\}"/,
  );
  assert.match(review, /bundle exec fastlane ios submit_review/);
});

test("eight Playwright shards share two-worker coverage", () => {
  const source = readFileSync(ciWorkflowPath, "utf8");
  const jobs = jobBlocks(source);
  assert.equal(jobs.size, 21);
  for (let shard = 1; shard <= 8; shard++) {
    const job = jobs.get(`playwright-${shard}`).join("\n");
    assert.match(job, new RegExp(`PLAYWRIGHT_SHARD: "${shard}/8"`));
    assert.match(job, new RegExp(`PLAYWRIGHT_ARTIFACT: "${shard}"`));
    assert.match(
      job,
      shard === 1 ? /steps: &playwright_test_steps/ : /steps: \*playwright_test_steps/,
    );
  }
  const shared = jobs.get("playwright-1").join("\n");
  assert.match(shared, /E2E_WORKERS: "2"/);
  const weights = /PWTEST_SHARD_WEIGHTS: "([\d:]+)"/.exec(shared)[1].split(":").map(Number);
  assert.equal(weights.length, 8);
  assert.ok(weights.every((weight) => weight > 0));
  assert.match(shared, /npm run test:e2e --workspace=@getpaseo\/app -- --shard=/);

  // No fan-in result job: a gate needs its own runner and under contention it
  // queued 8m08s behind the last shard. Required checks name the shards directly.
  assert.equal(jobs.has("playwright"), false);
});

test("quality preserves commands and routes each domain independently after failures", () => {
  const jobs = jobBlocks(readFileSync(ciWorkflowPath, "utf8"));
  const quality = jobs.get("quality").join("\n");
  assert.doesNotMatch(quality, /^\s+continue-on-error:/m);
  const commands = {
    format: ["npm run format:check"],
    quality: [
      "npx --yes lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https --validate-integrity",
      "npm audit signatures",
      "npm run lint",
      "node --test scripts/oxlint/paseo-plugin.test.mjs",
    ],
    relay: ["npm run build:relay", "npm run test --workspace=@getpaseo/relay"],
    sdk: [
      "npm run build:relay && npm run build:client",
      "npm run build:plugin",
      "npm run test --workspace=@getpaseo/plugin",
      "npm run test --workspace=@getpaseo/protocol",
      "npm run test --workspace=@getpaseo/client",
      "npm run test --workspace=@getpaseo/highlight",
      "npm run typecheck:examples --workspace=@getpaseo/client",
    ],
  };
  const checks = [...quality.matchAll(/        if: \$\{\{ (.+) \}\}\n        run: (.+)/g)];
  assert.deepEqual(
    checks.map(([, , command]) => command),
    Object.values(commands).flat(),
  );
  const domains = Object.keys(commands);
  function accepts(expression, outputs, { cancelled = false, installed = true } = {}) {
    // Prior checks have failed: success() is false. Explicit !cancelled() must
    // override Actions' default success condition so later domains still run.
    assert.match(expression, /!cancelled\(\)/);
    return runInNewContext(expression, {
      needs: { changes: { outputs } },
      steps: { install: { outcome: installed ? "success" : "failure" } },
      cancelled: () => cancelled,
      success: () => false,
    });
  }
  const disabled = { full: "false", ...Object.fromEntries(domains.map((key) => [key, "false"])) };
  const jobCondition = /    if: \$\{\{ (.+) \}\}/.exec(quality)[1];
  assert.equal(accepts(jobCondition, disabled), false);
  for (const selected of domains) {
    const outputs = { ...disabled, [selected]: "true" };
    assert.equal(accepts(jobCondition, outputs), true);
    for (const [, expression, command] of checks) {
      assert.equal(accepts(expression, outputs), commands[selected].includes(command), command);
    }
  }
  for (const [, expression] of checks) {
    assert.equal(accepts(expression, { ...disabled, full: "true" }), true);
    assert.equal(accepts(expression, {}), true, "missing routing outputs fail open");
    assert.equal(accepts(expression, {}, { cancelled: true }), false);
    assert.equal(accepts(expression, {}, { installed: false }), false);
  }
  assert.equal(accepts(jobCondition, {}, { cancelled: true }), false);
});

test("Windows units and integration run independently with complete routed coverage", () => {
  const source = readFileSync(ciWorkflowPath, "utf8");
  const jobs = jobBlocks(source);
  const ubuntu = jobs.get("server-tests-ubuntu").join("\n");
  const windows = jobs.get("server-tests-windows").join("\n");
  const integration = jobs.get("server-integration-windows").join("\n");
  assert.match(ubuntu, /run: npm run test --workspace=@getpaseo\/server/);
  assert.match(windows, /run: npm run test:unit --workspace=@getpaseo\/server/);
  assert.doesNotMatch(windows, /run: npm run test(?: |:integration)/);
  assert.match(integration, /run: npm run test:integration --workspace=@getpaseo\/server/);
  assert.doesNotMatch(integration, /test:unit|server_plugin_tests|server_hub_contract/);
  for (const job of [windows, integration]) {
    assert.match(job, /^    needs: changes$/m, "both phases become eligible independently");
    assert.match(job, /^    runs-on: windows-latest$/m);
    assert.doesNotMatch(job, /continue-on-error|maxWorkers|--exclude/);
    for (const step of [
      "server_capacity",
      "server_checkout",
      "server_node",
      "server_fetch",
      "server_install",
      "server_agent_clis",
      "server_build",
    ]) {
      assert.match(ubuntu, new RegExp(`&${step}\\b`));
      assert.match(job, new RegExp(`- \\*${step}\\b`));
    }
    assert.match(job, /env: \*server_test_env/);
  }
  assert.match(windows, /- \*server_plugin_tests/);
  assert.match(windows, /- \*server_hub_contract/);
  assert.match(ubuntu, /run: npm run test --workspace=@getpaseo\/builtin-plugins/);
  assert.match(ubuntu, /run: npm run test:hub-cli-contract --workspace=@getpaseo\/server/);

  const scripts = JSON.parse(
    readFileSync(new URL("packages/server/package.json", repoRoot), "utf8"),
  ).scripts;
  assert.equal(scripts.test, "npm run test:unit && npm run test:integration");
  assert.equal(scripts["test:unit"], 'vitest run --fileParallelism --exclude "**/*.e2e.test.ts"');
  const invocations = scripts["test:integration"].split(" && ");
  // Each vitest start costs about half a minute on Windows, so the
  // name-filtered files share one invocation and one combined filter.
  assert.equal(invocations.length, 2);
  assert.ok(invocations.every((command) => command.startsWith("vitest run --maxWorkers=1 ")));
  assert.doesNotMatch(invocations[0], / -t /);
  assert.equal(
    invocations[1],
    'vitest run --maxWorkers=1 src/server/agent/providers/omp/history.e2e.test.ts src/server/daemon-e2e/git-operations.e2e.test.ts src/server/session.create-agent-worktree-autoarchive.e2e.test.ts src/server/agent/providers/opencode-bridge.local.e2e.test.ts src/server/daemon-e2e/relay-transport.e2e.test.ts -t "merges into|creates a worktree and auto-archives both|versioned runtime|oversized attachments|connected hosts|password-protected daemon refuses|replays selected OMP history"',
  );
  const serverConfig = readFileSync(new URL("packages/server/vitest.config.ts", repoRoot), "utf8");
  assert.doesNotMatch(serverConfig, /maxWorkers/);

  function condition(job) {
    return /    if: \$\{\{ (.+) \}\}/.exec(job)[1];
  }
  function selected(expression, outputs, cancelled = false) {
    return runInNewContext(expression, {
      needs: { changes: { outputs } },
      cancelled: () => cancelled,
    });
  }
  const unitCondition = condition(windows);
  const integrationCondition = condition(integration);
  const unitStep = /      - name: Run server unit tests\n        if: \$\{\{ (.+) \}\}/.exec(
    windows,
  )[1];
  const hubStep =
    /      - &server_hub_contract\n        name: Run Hub CLI\/daemon contract\n        if: \$\{\{ (.+) \}\}/.exec(
      ubuntu,
    )[1];
  const pluginStep =
    /      - &server_plugin_tests\n        name: Run built-in plugin tests\n        if: \$\{\{ (.+) \}\}/.exec(
      ubuntu,
    )[1];
  for (const [outputs, units, integrations, hub] of [
    [{ full: "true", server: "false", hub: "false" }, true, true, false],
    [{ full: "false", server: "true", hub: "false" }, true, true, false],
    [{ full: "false", server: "false", hub: "true" }, true, false, true],
    [{ full: "false", server: "false", hub: "false" }, false, false, false],
    [{}, true, true, false],
  ]) {
    assert.equal(selected(unitCondition, outputs), units);
    assert.equal(selected(integrationCondition, outputs), integrations);
    assert.equal(selected(unitStep, outputs), integrations);
    assert.equal(selected(pluginStep, outputs), integrations);
    assert.equal(selected(hubStep, outputs), hub);
    assert.equal(selected(unitCondition, outputs, true), false);
    assert.equal(selected(integrationCondition, outputs, true), false);
  }
});

test("macOS release retries only transient stapling failures without rebuilding the signed app", async (t) => {
  const workflow = readFileSync(new URL(".github/workflows/desktop-release.yml", repoRoot), "utf8");
  const wrapper = workflow
    .match(/<<'STAPLER'\n([\s\S]*?)\n          STAPLER/)[1]
    .replace(/^          /gm, "");
  const networkError =
    'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."';
  const cases = [
    {
      name: "success",
      outcomes: [0],
      output: "stapled",
      command: "stapler",
      expected: 0,
      attempts: 1,
    },
    {
      name: "transient then success",
      outcomes: [68, 0],
      output: networkError,
      command: "stapler",
      expected: 0,
      attempts: 2,
    },
    {
      name: "exhausted network retries",
      outcomes: [68, 68, 68, 68, 0],
      output: networkError,
      command: "stapler",
      expected: 68,
      attempts: 4,
    },
    {
      name: "non-network staple error",
      outcomes: [68, 0],
      output: "ticket not found",
      command: "stapler",
      expected: 68,
      attempts: 1,
    },
    {
      name: "different exit code",
      outcomes: [1, 0],
      output: networkError,
      command: "stapler",
      expected: 1,
      attempts: 1,
    },
    {
      name: "notary submission is not retried",
      outcomes: [68, 0],
      output: networkError,
      command: "notarytool",
      expected: 68,
      attempts: 1,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const directory = mkdtempSync(join(tmpdir(), "stapler-retry-"));
      try {
        const statePath = join(directory, "state.json");
        const realXcrun = join(directory, "real-xcrun");
        const wrapperPath = join(directory, "xcrun");
        writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
        writeFileSync(join(directory, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        writeFileSync(
          statePath,
          JSON.stringify({ outcomes: scenario.outcomes, output: scenario.output, calls: [] }),
        );
        writeFileSync(
          realXcrun,
          `#!/usr/bin/env node
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.STAPLER_STATE, "utf8"));
state.calls.push(process.argv.slice(2));
const code = state.outcomes.shift();
fs.writeFileSync(process.env.STAPLER_STATE, JSON.stringify(state));
console.log(state.output);
process.exit(code);
`,
          { mode: 0o755 },
        );
        const args = [scenario.command, "staple", "-v", "Paseo signed.app"];
        const result = spawnSync("bash", [wrapperPath, ...args], {
          encoding: "utf8",
          env: {
            ...process.env,
            PASEO_REAL_XCRUN: realXcrun,
            STAPLER_STATE: statePath,
            PATH: `${directory}:${process.env.PATH}`,
          },
          timeout: 5000,
        });
        assert.equal(result.status, scenario.expected, result.stdout + result.stderr);
        const state = JSON.parse(readFileSync(statePath, "utf8"));
        assert.deepEqual(
          state.calls,
          Array.from({ length: scenario.attempts }, () => args),
        );
        assert.match(result.stdout, /stapled|network connection was lost|ticket not found/);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("fork macOS build retries only a busy DMG volume and removes partial images first", async (t) => {
  const workflow = readFileSync(
    new URL(".github/workflows/fork-desktop-build.yml", repoRoot),
    "utf8",
  );
  const wrapper = workflow
    .match(/<<'DMGRETRY'\n([\s\S]*?)\n {10}DMGRETRY/)[1]
    .replace(/^ {10}/gm, "");
  assert.match(
    workflow,
    /"\$retry_bin\/retry-busy-dmg" \\\n {12}npm run build:desktop -- --config electron-builder\.fork\.yml/,
  );
  const busy =
    'dmgbuild.core.DMGError: Unable to detach device cleanly: hdiutil: couldn\'t eject "disk2" - Resource busy';
  const cases = [
    { name: "success", outcomes: [0], output: "built", expected: 0, attempts: 1 },
    { name: "busy then success", outcomes: [1, 0], output: busy, expected: 0, attempts: 2 },
    { name: "busy every time", outcomes: [1, 1, 1, 0], output: busy, expected: 1, attempts: 3 },
    {
      name: "other build error",
      outcomes: [1, 0],
      output: "Error: tsc failed",
      expected: 1,
      attempts: 1,
    },
    {
      name: "busy resource without the detach error",
      outcomes: [1, 0],
      output: "hdiutil: create failed - Resource busy",
      expected: 1,
      attempts: 1,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const directory = mkdtempSync(join(tmpdir(), "dmg-retry-"));
      try {
        const statePath = join(directory, "state.json");
        const releaseDir = join(directory, "release");
        const build = join(directory, "build");
        const wrapperPath = join(directory, "retry-busy-dmg");
        mkdirSync(releaseDir);
        writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
        writeFileSync(join(directory, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        writeFileSync(
          statePath,
          JSON.stringify({ outcomes: scenario.outcomes, output: scenario.output, calls: [] }),
        );
        // Each attempt records which release files it found, then leaves a
        // partial DMG behind next to the zip that the build always writes.
        writeFileSync(
          build,
          `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const state = JSON.parse(fs.readFileSync(process.env.DMG_STATE, "utf8"));
state.calls.push(fs.readdirSync(process.env.DMG_RELEASE_DIR).sort());
const code = state.outcomes.shift();
for (const name of ["Paseo-x64.dmg", "Paseo-x64.dmg.blockmap", "Paseo-x64.zip"]) {
  fs.writeFileSync(path.join(process.env.DMG_RELEASE_DIR, name), "partial");
}
fs.writeFileSync(process.env.DMG_STATE, JSON.stringify(state));
console.log(state.output);
process.exit(code);
`,
          { mode: 0o755 },
        );
        const result = spawnSync("bash", [wrapperPath, build], {
          encoding: "utf8",
          env: {
            ...process.env,
            DMG_RELEASE_DIR: releaseDir,
            DMG_STATE: statePath,
            PATH: `${directory}:${process.env.PATH}`,
          },
          timeout: 5000,
        });
        assert.equal(result.status, scenario.expected, result.stdout + result.stderr);
        const state = JSON.parse(readFileSync(statePath, "utf8"));
        assert.deepEqual(state.calls, [
          [],
          ...Array.from({ length: scenario.attempts - 1 }, () => ["Paseo-x64.zip"]),
        ]);
        assert.match(result.stdout, /built|Resource busy|tsc failed/);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

// GitHub retires macOS 14 on 2026-11-02; brownouts already reject these jobs.
test("workflows avoid retired macOS 14 runners", () => {
  for (const path of filesUnder(".github/workflows", (candidate) => /\.ya?ml$/.test(candidate))) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /macos-14(?:-large|-xlarge)?\b/,
      path,
    );
  }
});

test("macOS jobs use latest runners while preserving release architectures", () => {
  for (const [workflow, jobId] of [
    [ciWorkflowPath, "server-tests-macos"],
    [nixWorkflowPath, "build-desktop-darwin"],
  ]) {
    assert.match(
      jobBlocks(readFileSync(workflow, "utf8")).get(jobId).join("\n"),
      /^    runs-on: macos-latest$/m,
    );
  }
  const release = readFileSync(new URL(".github/workflows/desktop-release.yml", repoRoot), "utf8");
  assert.match(release, /runner: macos-latest\n\s+electron_arch: arm64/);
  // GitHub has no standard macos-latest-intel alias; use the newest Intel image.
  assert.match(release, /runner: macos-26-intel\n\s+electron_arch: x64/);
});

test("Nix desktop packaging resolves the workspace-local builder", () => {
  const source = readFileSync(new URL("nix/desktop-package.nix", repoRoot), "utf8");
  const invocation = source.match(/^\s+([^\n]*electron-builder) \\\n/m)?.[1];
  assert.ok(invocation, "Nix invokes the desktop packaging tool");
  const directory = mkdtempSync(join(tmpdir(), "nix-builder-resolution-"));
  try {
    const desktop = join(directory, "packages/desktop");
    mkdirSync(join(desktop, "node_modules/.bin"), { recursive: true });
    mkdirSync(join(desktop, "node_modules/electron-builder"));
    writeFileSync(
      join(desktop, "node_modules/electron-builder/package.json"),
      JSON.stringify({
        name: "electron-builder",
        version: "1.0.0",
        bin: { "electron-builder": "../.bin/electron-builder" },
      }),
    );
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ private: true, workspaces: ["packages/desktop"] }),
    );
    writeFileSync(
      join(desktop, "package.json"),
      JSON.stringify({
        name: "desktop-fixture",
        private: true,
        devDependencies: { "electron-builder": "1.0.0" },
      }),
    );
    writeFileSync(
      join(desktop, "node_modules/.bin/electron-builder"),
      '#!/bin/sh\nprintf "workspace-builder\\n"\n',
      { mode: 0o755 },
    );
    const result = spawnSync("sh", ["-c", `${invocation} --version`], {
      cwd: desktop,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "workspace-builder");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const forkSyncWorkflowPath = new URL(".github/workflows/fork-upstream-sync.yml", repoRoot);
const forkResumeWorkflowPath = new URL(".github/workflows/fork-sync-resume.yml", repoRoot);

// Returns the `run: |` script of the step with this id, without its YAML indent.
function stepRunScript(source, id) {
  const lines = source.split("\n");
  const idLine = lines.findIndex((line) => line.trim() === `id: ${id}`);
  assert.ok(idLine >= 0, `step ${id} exists`);
  const runLine = lines.findIndex((line, index) => index > idLine && /^\s+run: \|$/.test(line));
  const keyIndent = lines[runLine].search(/\S/);
  const body = [];
  for (const line of lines.slice(runLine + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.search(/\S/)));
  return body.map((line) => line.slice(indent)).join("\n");
}

// A fake `gh` that serves canned issues and pull requests and records each call.
const fakeGh = `#!/usr/bin/env node
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const args = process.argv.slice(2);
state.calls.push(args);
fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
if (args[0] === "issue" && args[1] === "list") {
  console.log(JSON.stringify(state.issues));
} else if (args[0] === "issue" && args[1] === "view") {
  console.log(JSON.stringify({ body: state.issues.find((issue) => String(issue.number) === args[2]).body }));
} else if (args[0] === "api") {
  console.log(JSON.stringify(state.pulls));
}
`;

function runWithFakeGh(script, { issues = [], pulls = [], env = {}, cwd } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "fork-sync-"));
  try {
    const statePath = join(directory, "state.json");
    const outputPath = join(directory, "output.txt");
    writeFileSync(join(directory, "gh"), fakeGh, { mode: 0o755 });
    writeFileSync(join(directory, "script.sh"), script);
    writeFileSync(outputPath, "");
    writeFileSync(statePath, JSON.stringify({ issues, pulls, calls: [] }));
    const result = spawnSync("bash", [join(directory, "script.sh")], {
      cwd: cwd ?? directory,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        FAKE_GH_STATE: statePath,
        GITHUB_OUTPUT: outputPath,
        PATH: `${directory}:${process.env.PATH}`,
      },
      timeout: 10000,
    });
    return {
      status: result.status,
      stdout: result.stdout + result.stderr,
      output: readFileSync(outputPath, "utf8"),
      calls: JSON.parse(readFileSync(statePath, "utf8")).calls,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const realIssue = {
  number: 21,
  url: "https://github.com/kevinle128/paseo/issues/21",
  labels: [{ name: "upstream-sync-conflict" }],
};
const testIssue = {
  number: 22,
  url: "https://github.com/kevinle128/paseo/issues/22",
  labels: [{ name: "upstream-sync-conflict" }, { name: "sync-test" }],
};

test("fork sync test runs need both replay shas and never push or build", async (t) => {
  const source = readFileSync(forkSyncWorkflowPath, "utf8");
  const guard = stepRunScript(source, "inputs");
  const sha = "a".repeat(40);
  for (const scenario of [
    { name: "real run", fork: "", upstream: "", status: 0, output: "test=false" },
    { name: "test run", fork: sha, upstream: "b".repeat(40), status: 0, output: "test=true" },
    { name: "only one sha", fork: sha, upstream: "", status: 1, output: "" },
    { name: "short sha", fork: sha.slice(1), upstream: sha, status: 1, output: "" },
  ]) {
    await t.test(scenario.name, () => {
      const result = runWithFakeGh(guard, {
        env: { TEST_FORK_SHA: scenario.fork, TEST_UPSTREAM_SHA: scenario.upstream },
      });
      assert.equal(result.status, scenario.status, result.stdout);
      assert.equal(result.output.trim(), scenario.output);
    });
  }

  const merge = stepRunScript(source, "merge");
  assert.match(merge, /git worktree add --detach "\$\{RUNNER_TEMP\}\/replay" "\$TEST_FORK_SHA"/);
  const jobs = jobBlocks(source);
  const sync = jobs.get("sync").join("\n");
  assert.match(
    sync,
    /- name: Push main\n\s+id: push\n\s+if: steps\.merge\.outputs\.changed == 'true' && steps\.inputs\.outputs\.test != 'true'/,
  );
  assert.match(
    jobs.get("build").join("\n"),
    /needs\.sync\.outputs\.changed == 'true' && inputs\.test_fork_sha == '' && inputs\.test_upstream_sha == ''/,
  );
  assert.match(sync, /id: merge\n\s+if: steps\.pause\.outputs\.paused != 'true'/);
});

test("a scheduled sync pauses for a real conflict issue and a test run only for a test issue", async (t) => {
  const pause = stepRunScript(readFileSync(forkSyncWorkflowPath, "utf8"), "pause");
  for (const scenario of [
    { name: "real issue pauses the schedule", test: "false", issues: [realIssue], paused: 21 },
    { name: "test issue never pauses the schedule", test: "false", issues: [testIssue], paused: 0 },
    {
      name: "test issue pauses a test run",
      test: "true",
      issues: [realIssue, testIssue],
      paused: 22,
    },
    { name: "real issue never pauses a test run", test: "true", issues: [realIssue], paused: 0 },
    { name: "no issue", test: "false", issues: [], paused: 0 },
  ]) {
    await t.test(scenario.name, () => {
      const result = runWithFakeGh(pause, {
        issues: scenario.issues,
        env: { TEST: scenario.test },
      });
      assert.equal(result.status, 0, result.stdout);
      if (scenario.paused) {
        assert.equal(result.output.trim(), "paused=true");
        assert.match(
          result.stdout,
          new RegExp(`Sync paused: conflict issue #${scenario.paused} is open`),
        );
      } else {
        assert.equal(result.output.trim(), "");
      }
    });
  }
});

test("the blocked notice mentions the resolver once, and a test only when asked", async (t) => {
  const compose = stepRunScript(readFileSync(forkSyncWorkflowPath, "utf8"), "blocked");
  const mention =
    "@Tiểu Hổ hãy giải quyết conflict ở issue #21: https://github.com/kevinle128/paseo/issues/21";
  for (const scenario of [
    { name: "new real issue", test: "false", created: "true", mention: "", expected: true },
    { name: "updated real issue", test: "false", created: "false", mention: "", expected: false },
    { name: "test issue", test: "true", created: "true", mention: "false", expected: false },
    {
      name: "test issue that asks",
      test: "true",
      created: "true",
      mention: "true",
      expected: true,
    },
  ]) {
    await t.test(scenario.name, () => {
      const result = runWithFakeGh(compose, {
        env: {
          TEST: scenario.test,
          TEST_MENTION: scenario.mention,
          RESOLVER: "Tiểu Hổ",
          RANGE: "33faacc05..0e4002251 (210 commits)",
          FILES: "packages/app/src/composer/input/input.tsx",
          ISSUE_URL: realIssue.url,
          ISSUE_NUMBER: "21",
          CREATED: scenario.created,
          RUN_URL: "https://example.test/run/1",
        },
      });
      assert.equal(result.status, 0, result.stdout);
      const text = result.output.split("\n").slice(1, -2).join("\n");
      assert.equal(text.startsWith("[TEST] "), scenario.test === "true");
      assert.equal(text.split("\n").includes(mention), scenario.expected, text);
    });
  }
});

test("every fork sync notice goes to the configured Buzz route", () => {
  const source = readFileSync(forkSyncWorkflowPath, "utf8");
  const notices = source.split("uses: ./.github/actions/buzz-notify").slice(1);
  assert.equal(notices.length, 3);
  for (const notice of notices) {
    assert.match(
      notice.split("\n      - ")[0],
      /repository_name: \$\{\{ vars\.BUZZ_REPOSITORY_NAME \|\| 'paseo' \}\}/,
    );
  }
});

test("the build starts only after a sync pull request merge that contains the issue's upstream commit", async (t) => {
  const workflow = readFileSync(forkResumeWorkflowPath, "utf8");
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]\n/);
  const resume = workflow.match(/<<'RESUME'\n([\s\S]*?)\n {10}RESUME/)[1].replace(/^ {10}/gm, "");
  const repo = mkdtempSync(join(tmpdir(), "fork-resume-repo-"));
  try {
    const gitIn = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    gitIn("init", "-q", "-b", "main");
    gitIn(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "upstream",
    );
    const upstreamSha = gitIn("rev-parse", "HEAD");
    gitIn("checkout", "-q", "--orphan", "other");
    gitIn(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "unrelated",
    );
    const unrelatedSha = gitIn("rev-parse", "HEAD");
    gitIn("checkout", "-q", "main");
    gitIn(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "merge",
    );
    const mergeSha = gitIn("rev-parse", "HEAD");
    const block = (sha) =>
      `<!-- fork-sync-conflict:v1 {"schema":1,"upstream_sha":"${sha}","fork_ref":"main"} -->\n\nreport`;
    const syncPull = {
      merged_at: "2026-11-09T00:00:00Z",
      base: { ref: "main" },
      head: { ref: "sync/upstream-21-abcdef01" },
    };
    const featurePull = { ...syncPull, head: { ref: "feat/pinned-grid" } };
    const closes = (calls) => calls.filter((call) => call[0] === "issue" && call[1] === "close");
    const builds = (calls) => calls.filter((call) => call[0] === "workflow" && call[1] === "run");
    for (const scenario of [
      {
        name: "sync merge with the upstream commit",
        pulls: [syncPull],
        issues: [{ ...realIssue, body: block(upstreamSha) }],
        closed: [21],
        built: true,
      },
      {
        name: "feature merge",
        pulls: [featurePull],
        issues: [{ ...realIssue, body: block(upstreamSha) }],
        closed: [],
        built: false,
      },
      {
        name: "squash merge without the upstream commit",
        pulls: [syncPull],
        issues: [{ ...realIssue, body: block(unrelatedSha) }],
        closed: [],
        built: false,
      },
      {
        name: "test issue is ignored",
        pulls: [syncPull],
        issues: [{ ...testIssue, body: block(unrelatedSha) }],
        closed: [],
        built: true,
      },
      {
        name: "push without a pull request",
        pulls: [],
        issues: [{ ...realIssue, body: block(upstreamSha) }],
        closed: [],
        built: false,
      },
    ]) {
      await t.test(scenario.name, () => {
        const result = runWithFakeGh(resume, {
          cwd: repo,
          issues: scenario.issues,
          pulls: scenario.pulls,
          env: { GH_REPO: "kevinle128/paseo", SHA: mergeSha },
        });
        assert.equal(result.status, 0, result.stdout);
        assert.deepEqual(
          closes(result.calls).map((call) => Number(call[2])),
          scenario.closed,
        );
        assert.deepEqual(
          builds(result.calls),
          scenario.built
            ? [
                [
                  "workflow",
                  "run",
                  "fork-desktop-build.yml",
                  "--ref",
                  "main",
                  "-f",
                  `ref=${mergeSha}`,
                ],
              ]
            : [],
        );
      });
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
