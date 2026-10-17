const fs = require("fs");
const path = require("path");

const PLACEHOLDER_NOTE = "(add release notes)";
const TABLE_START = "# ⬇️ Downloads";
const TABLE_END = "### ℹ️ Enjoying ROSI?";
const SECTION_HEADING_PREFIX = "## Changes in `v";

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Like Arlet/Zinnia: point the CHANGELOG download table at `version` and add a
 * placeholder section when it is missing. ensure-draft-release refuses the
 * placeholder, so notes must be written before a release.
 */
function syncChangelogForVersion(changelog, version) {
  const eol = changelog.includes("\r\n") ? "\r\n" : "\n";
  const text = changelog.replace(/\r\n/g, "\n");

  const start = text.indexOf(TABLE_START);
  const end = start === -1 ? -1 : text.indexOf(TABLE_END, start);
  if (start === -1 || end === -1) {
    throw new Error(
      `CHANGELOG.md download table markers not found ("${TABLE_START}" ... "${TABLE_END}").`,
    );
  }

  const table = text
    .slice(start, end)
    .replace(
      /\/releases\/download\/v[^/\s)"'<>]+\//g,
      `/releases/download/v${version}/`,
    );
  let updated = text.slice(0, start) + table + text.slice(end);

  const heading = `${SECTION_HEADING_PREFIX}${version}:\``;
  const headingPattern = new RegExp(`^${escapeRegExp(heading)}[ \\t]*$`, "m");
  if (!headingPattern.test(updated)) {
    // Newest first: insert above the most recent version section.
    const anchor = updated.search(
      new RegExp(`^${escapeRegExp(SECTION_HEADING_PREFIX)}`, "m"),
    );
    if (anchor === -1) {
      throw new Error(
        `CHANGELOG.md has no "${SECTION_HEADING_PREFIX}..." section to insert v${version} above.`,
      );
    }
    updated =
      updated.slice(0, anchor) +
      `${heading}\n* **PKG:** ${PLACEHOLDER_NOTE}\n\n` +
      updated.slice(anchor);
  }

  return eol === "\n" ? updated : updated.replace(/\n/g, eol);
}

function parseRoot(argv) {
  const index = argv.indexOf("--root");
  if (index === -1) return path.join(__dirname, "..");
  const value = argv[index + 1];
  if (!value) throw new Error("--root requires a directory");
  return path.resolve(value);
}

function run(argv = process.argv.slice(2)) {
  const root = parseRoot(argv);
  const version = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("package.json must contain a non-empty string version");
  }

  const changelogPath = path.join(root, "CHANGELOG.md");
  const current = fs.readFileSync(changelogPath, "utf8");
  const next = syncChangelogForVersion(current, version);
  if (next === current) {
    console.log(`sync-changelog: CHANGELOG.md already matches v${version}`);
    return;
  }
  fs.writeFileSync(changelogPath, next);
  console.log(`sync-changelog: CHANGELOG.md → v${version}`);
  if (next.includes(PLACEHOLDER_NOTE)) {
    console.log(
      `   Added a placeholder "Changes in v${version}" section; replace "${PLACEHOLDER_NOTE}" before releasing.`,
    );
  }
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`✗ ${error && error.message ? error.message : error}`);
    process.exit(1);
  }
}

module.exports = { PLACEHOLDER_NOTE, syncChangelogForVersion, run };
