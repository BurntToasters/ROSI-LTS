const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

// Recursively lists files under `dir` whose basename matches `pattern`.
// Symlinks are not followed.
function findFiles(dir, pattern) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

function sameRealPath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

module.exports = { sha256File, findFiles, sameRealPath };
