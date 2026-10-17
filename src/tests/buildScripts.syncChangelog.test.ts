import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.join(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "build-scripts", "sync-changelog.js");
const ARTIFACT_DIR = path.join(REPO_ROOT, "dist", "e2e", "changelog-sync");
const NEXT_VERSION = "9.9.9-LTS";

function runSync(root: string) {
  return execFileSync(process.execPath, [SCRIPT, "--root", root], {
    encoding: "utf8",
  });
}

function makeFixture(changelog: string, version = NEXT_VERSION) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rosi-lts-changelog-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version }),
  );
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
  return root;
}

describe("sync-changelog (E2E against the real CHANGELOG.md)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repoints downloads, adds one placeholder section, and is idempotent", () => {
    const original = fs.readFileSync(
      path.join(REPO_ROOT, "CHANGELOG.md"),
      "utf8",
    );
    const root = makeFixture(original);
    tempDirs.push(root);
    const changelogPath = path.join(root, "CHANGELOG.md");

    expect(runSync(root)).toContain(`v${NEXT_VERSION}`);
    const synced = fs.readFileSync(changelogPath, "utf8");

    const table = synced.slice(
      synced.indexOf("# ⬇️ Downloads"),
      synced.indexOf("### ℹ️ Enjoying ROSI?"),
    );
    const links = table.match(/\/releases\/download\/[^/]+\//g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    expect(new Set(links)).toEqual(
      new Set([`/releases/download/v${NEXT_VERSION}/`]),
    );

    const heading = `## Changes in \`v${NEXT_VERSION}:\``;
    expect(synced.split(heading)).toHaveLength(2);
    expect(synced.indexOf(heading)).toBeLessThan(
      synced.indexOf("## Changes in `v3.6.10-LTS:`"),
    );
    expect(synced).toContain("(add release notes)");

    // Only the table and the new section change; existing notes are untouched.
    const {
      syncChangelogForVersion,
    } = require("../../build-scripts/sync-changelog.js");
    expect(synced.slice(synced.indexOf("## Changes in `v3.6.10-LTS:`"))).toBe(
      original.slice(original.indexOf("## Changes in `v3.6.10-LTS:`")),
    );
    expect(syncChangelogForVersion(synced, NEXT_VERSION)).toBe(synced);

    expect(runSync(root)).toContain("already matches");
    expect(fs.readFileSync(changelogPath, "utf8")).toBe(synced);

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, "CHANGELOG.input.md"), original);
    fs.writeFileSync(path.join(ARTIFACT_DIR, "CHANGELOG.synced.md"), synced);
  });

  it("is a no-op on the committed CHANGELOG for the current version", () => {
    const original = fs.readFileSync(
      path.join(REPO_ROOT, "CHANGELOG.md"),
      "utf8",
    );
    const { version } = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    const root = makeFixture(original, version);
    tempDirs.push(root);

    expect(runSync(root)).toContain("already matches");
  });

  it("preserves CRLF line endings", () => {
    const original = fs.readFileSync(
      path.join(REPO_ROOT, "CHANGELOG.md"),
      "utf8",
    );
    const root = makeFixture(original.replace(/\r?\n/g, "\r\n"));
    tempDirs.push(root);

    runSync(root);
    const synced = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    expect(synced.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("fails without writing when the download table markers are missing", () => {
    const broken = "## Changes in `v1.0.0-LTS:`\n* notes\n";
    const root = makeFixture(broken);
    tempDirs.push(root);

    expect(() => runSync(root)).toThrow();
    expect(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")).toBe(
      broken,
    );
  });

  it("does not rewrite release links outside the download table", () => {
    const changelog = [
      "# ⬇️ Downloads",
      "[exe](https://github.com/BurntToasters/ROSI-LTS/releases/download/v1.0.0-LTS/ROSI-LTS-Windows.exe)",
      "### ℹ️ Enjoying ROSI?",
      "## Changes in `v1.0.0-LTS:`",
      "* See [old](https://github.com/BurntToasters/ROSI-LTS/releases/download/v0.9.0-LTS/old.exe)",
      "",
    ].join("\n");
    const root = makeFixture(changelog);
    tempDirs.push(root);

    runSync(root);
    const synced = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    expect(synced).toContain(`/download/v${NEXT_VERSION}/ROSI-LTS-Windows.exe`);
    expect(synced).toContain("/download/v0.9.0-LTS/old.exe");
  });
});
