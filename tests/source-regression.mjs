#!/usr/bin/env node
/**
 * ƝØVΛ — Advanced AI Agent Platform for Telegram
 * Copyright (C) 2026 Hsoofi82
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Source regression tests: keep the open-source distribution healthy.
 *  - required community/license files exist
 *  - every source file carries the AGPL license header
 *  - wrangler.toml contains no credentials
 *  - no secret-looking values anywhere in the tracked tree
 *
 * Run: npm test
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── tracked files ────────────────────────────────────────────────────────────
const tracked = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

console.log("\n[1] Required files");
const required = [
  "LICENSE", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md",
  "CODE_OF_CONDUCT.md", "THIRD_PARTY_NOTICES.md",
  ".env.example", ".dev.vars.example", ".gitignore",
  "package.json", "tsconfig.json", "wrangler.toml",
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  "src/index.ts", "tests/source-regression.mjs",
];
for (const f of required) {
  existsSync(f) ? ok(f) : fail(`missing required file: ${f}`);
}
// CI workflow: either enabled in place, or shipped as the example to rename.
const CI_ENABLED = ".github/workflows/ci.yml";
const CI_EXAMPLE = ".github/ci-workflow.example.yml";
if (existsSync(CI_ENABLED)) ok(CI_ENABLED);
else if (existsSync(CI_EXAMPLE)) ok(`${CI_EXAMPLE} (CI ready to enable)`);
else fail(`missing CI workflow (${CI_ENABLED} or ${CI_EXAMPLE})`);

console.log("\n[2] License metadata");
const license = readFileSync("LICENSE", "utf8");
license.includes("GNU AFFERO GENERAL PUBLIC LICENSE") &&
license.includes("Version 3, 19 November 2007")
  ? ok("LICENSE is the GNU AGPL v3.0 text")
  : fail("LICENSE does not look like the AGPL v3.0 text");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.license === "AGPL-3.0-or-later"
  ? ok('package.json license = "AGPL-3.0-or-later"')
  : fail(`package.json license is "${pkg.license}", expected "AGPL-3.0-or-later"`);

console.log("\n[3] AGPL headers on source files");
const SPDX = "SPDX-License-Identifier: AGPL-3.0-or-later";
const sourceFiles = tracked.filter((f) =>
  (f.startsWith("src/") && (f.endsWith(".ts") || f.endsWith(".html"))) ||
  f === "globals.d.ts"
);
// Vendored third-party works keep their own licenses (see THIRD_PARTY_NOTICES.md).
const headerExempt = new Set(["src/telegram-web-app.txt"]);
for (const f of sourceFiles) {
  if (headerExempt.has(f)) continue;
  readFileSync(f, "utf8").includes(SPDX)
    ? ok(f)
    : fail(`${f}: missing AGPL SPDX header`);
}

console.log("\n[4] wrangler.toml hygiene");
const toml = readFileSync("wrangler.toml", "utf8");
const CREDENTIAL_VARS = [
  "TOKEN", "BOT_OWNER_ID", "WEBHOOK_SECRET",
  "GEMINI_KEY_1", "GEMINI_KEY_2", "GEMINI_KEY_3", "GEMINI_KEY_4", "GEMINI_KEY_5",
  "GOOGLE_SEARCH_API_KEY", "GOOGLE_SEARCH_ENGINE_ID",
  "CF_ID_1", "CF_TOKEN_1", "CF_ID_2", "CF_TOKEN_2", "CF_ID_3", "CF_TOKEN_3",
];
for (const name of CREDENTIAL_VARS) {
  new RegExp(`^${name}\\s*=`, "m").test(toml)
    ? fail(`wrangler.toml sets "${name}" — credentials must be Worker Secrets, not [vars]`)
    : ok(`no "${name}" in wrangler.toml`);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dbId = toml.match(/^database_id\s*=\s*"([^"]*)"/m)?.[1] ?? "";
dbId === "<YOUR_D1_DATABASE_ID>" || UUID_RE.test(dbId)
  ? ok(`D1 database_id is configured ("${dbId === "<YOUR_D1_DATABASE_ID>" ? "placeholder" : "uuid"}")`)
  : fail("wrangler.toml database_id should be the <YOUR_D1_DATABASE_ID> placeholder or a D1 uuid");

console.log("\n[5] Secret-leak guard (whole tree)");
// Patterns that indicate real credentials. Placeholders in examples are empty strings.
const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key (AIza…)"],
  [/\b\d{8,10}:AA[0-9A-Za-z_-]{30,}/, "Telegram bot token"],
  [/\bcfat_[0-9A-Za-z_-]{20,}/, "Cloudflare API token (cfat_…)"],
  [/[0-9a-f]{64}/, "64-char hex secret (webhook secret / private key material)"],
];
let scanned = 0;
for (const f of tracked) {
  if (!/\.(ts|html|txt|toml|json|md|yml|yaml|js|mjs|css|d\.ts)$/i.test(f)) continue;
  const content = readFileSync(f, "utf8");
  scanned++;
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(content)) fail(`${f}: contains a ${label}`);
  }
}
ok(`scanned ${scanned} tracked text files`);

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} problem(s) found.\n`);
  process.exit(1);
}
console.log("All source regression checks passed. ✓\n");
