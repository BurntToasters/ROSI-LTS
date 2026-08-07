import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const {
  cleanReleaseArtifacts,
  copyReleaseAssets,
  getAfterPackLocation,
  isBetaReleaseVersion,
  pathsEqual,
  run,
  shouldSkipBetaMirror,
  verifyCopiedPath,
} = require("../../build-scripts/post-release-assets.js");

const STABLE_VERSION = "3.6.6";
const BETA_VERSION = "3.6.6-beta.1";

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("post-release-assets helpers", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads AFTER_PACK_LOC from the environment", () => {
    expect(getAfterPackLocation({})).toBe("");
    expect(
      getAfterPackLocation({ AFTER_PACK_LOC: "  /tmp/rosi-lts-mirror  " }),
    ).toBe("/tmp/rosi-lts-mirror");
  });

  it("cleans build-only release artifacts", () => {
    const releaseDir = makeTempDir("rosi-lts-release-clean-");
    tempDirs.push(releaseDir);
    fs.mkdirSync(path.join(releaseDir, "win-unpacked"));
    fs.writeFileSync(path.join(releaseDir, "builder-debug.yml"), "debug");

    cleanReleaseArtifacts(releaseDir);

    expect(fs.existsSync(path.join(releaseDir, "win-unpacked"))).toBe(false);
    expect(fs.existsSync(path.join(releaseDir, "builder-debug.yml"))).toBe(
      false,
    );
  });

  it("mirrors and verifies cleaned release assets", () => {
    const releaseDir = makeTempDir("rosi-lts-release-src-");
    const destination = makeTempDir("rosi-lts-release-dest-");
    tempDirs.push(releaseDir, destination);
    fs.writeFileSync(path.join(releaseDir, "ROSI-LTS-Linux-amd64.deb"), "deb");

    expect(
      run({
        releaseDir,
        env: { AFTER_PACK_LOC: destination },
        version: STABLE_VERSION,
      }),
    ).toEqual({
      mirrored: true,
      destination: path.resolve(destination),
      copiedEntries: 1,
      skippedBetaMirror: false,
    });
    expect(
      fs.readFileSync(
        path.join(destination, "ROSI-LTS-Linux-amd64.deb"),
        "utf8",
      ),
    ).toBe("deb");
  });

  it("skips AFTER_PACK_LOC mirroring for beta versions unless overridden", () => {
    const releaseDir = makeTempDir("rosi-lts-release-beta-");
    const destination = makeTempDir("rosi-lts-release-beta-dest-");
    tempDirs.push(releaseDir, destination);
    fs.mkdirSync(path.join(releaseDir, "win-unpacked"));
    fs.writeFileSync(path.join(releaseDir, "ROSI-LTS-Linux-amd64.deb"), "deb");

    expect(isBetaReleaseVersion(BETA_VERSION)).toBe(true);
    expect(shouldSkipBetaMirror({}, BETA_VERSION)).toBe(true);
    expect(
      shouldSkipBetaMirror({ OVERRIDE_BETA_MIRROR_SKIP: "1" }, BETA_VERSION),
    ).toBe(false);

    expect(
      run({
        releaseDir,
        env: { AFTER_PACK_LOC: destination },
        version: BETA_VERSION,
      }),
    ).toEqual({
      mirrored: false,
      destination: null,
      skippedBetaMirror: true,
    });
    expect(fs.existsSync(path.join(releaseDir, "win-unpacked"))).toBe(false);
    expect(
      fs.existsSync(path.join(destination, "ROSI-LTS-Linux-amd64.deb")),
    ).toBe(false);

    fs.writeFileSync(path.join(releaseDir, "ROSI-LTS-Linux-amd64.deb"), "deb");
    expect(
      run({
        releaseDir,
        env: {
          AFTER_PACK_LOC: destination,
          OVERRIDE_BETA_MIRROR_SKIP: "1",
        },
        version: BETA_VERSION,
      }),
    ).toEqual({
      mirrored: true,
      destination: path.resolve(destination),
      copiedEntries: 1,
      skippedBetaMirror: false,
    });
  });

  it("compares Windows paths without case sensitivity", () => {
    expect(
      pathsEqual(
        "C:/Users/Main/ROSI-LTS/release",
        "c:/users/main/rosi-lts/release",
        "win32",
      ),
    ).toBe(true);
  });

  it("fails when the release directory is missing", () => {
    const root = makeTempDir("rosi-lts-release-missing-");
    tempDirs.push(root);
    expect(() =>
      copyReleaseAssets(path.join(root, "missing"), path.join(root, "mirror")),
    ).toThrow("release directory does not exist");
  });

  it("fails when the release directory is empty", () => {
    const releaseDir = makeTempDir("rosi-lts-release-empty-");
    tempDirs.push(releaseDir);
    expect(() =>
      copyReleaseAssets(releaseDir, path.join(releaseDir, "..", "mirror")),
    ).toThrow("release directory is empty");
  });

  it("rejects the release directory as its own mirror", () => {
    const releaseDir = makeTempDir("rosi-lts-release-same-");
    tempDirs.push(releaseDir);
    fs.writeFileSync(path.join(releaseDir, "artifact.txt"), "data");
    expect(() => copyReleaseAssets(releaseDir, releaseDir)).toThrow(
      "AFTER_PACK_LOC cannot be the release directory",
    );
  });

  it("rejects mirroring inside the release directory", () => {
    const releaseDir = makeTempDir("rosi-lts-release-nested-");
    tempDirs.push(releaseDir);
    fs.writeFileSync(path.join(releaseDir, "artifact.txt"), "data");
    expect(() =>
      copyReleaseAssets(releaseDir, path.join(releaseDir, "mirror")),
    ).toThrow("AFTER_PACK_LOC cannot be inside the release directory");
  });

  it("detects a mirrored file with the wrong size", () => {
    const root = makeTempDir("rosi-lts-release-size-");
    tempDirs.push(root);
    const source = path.join(root, "source.bin");
    const destination = path.join(root, "destination.bin");
    fs.writeFileSync(source, "expected");
    fs.writeFileSync(destination, "bad");
    expect(() => verifyCopiedPath(source, destination)).toThrow(
      "mirrored file size differs",
    );
  });
});
