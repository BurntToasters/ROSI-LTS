const fs = require("fs");
const path = require("path");
const { completionCount, waitForCompletion, startDownloadIpc } = require("../lib/electronApp");
const { findFiles } = require("../lib/files");

// Files named <prefix>* under the spec's temp root. When `allowedDir` is given,
// files inside it are ignored (that is where a legitimate output would go).
function escapedFiles(specRoot, prefix, allowedDir) {
  const allowed = allowedDir ? fs.realpathSync(allowedDir) + path.sep : null;
  return findFiles(specRoot, new RegExp(`^${prefix}`)).filter((file) => {
    if (!allowed) return true;
    return !fs.realpathSync(file).startsWith(allowed);
  });
}

// Returns { result, status }. `status` is null when the request was rejected.
async function downloadAndWait(page, options, timeoutMs) {
  const before = await completionCount(page);
  const result = await startDownloadIpc(page, options);
  if (!result || result.ok !== true) return { result, status: null };
  const status = await waitForCompletion(page, before, timeoutMs);
  return { result, status };
}

module.exports = {
  id: "S4",
  title: "convertFormat traversal cannot write outside the download folder",
  failureModes: ["F1"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page } = session;

    // A. A request-level payload must be rejected by validation.
    const dlA = ctx.dir("dl-a");
    await ctx.attempt("A: traversal payload request", async () => {
      const { result, status } = await downloadAndWait(
        page,
        { url: ctx.url("sample.mp4"), outputPath: dlA, convertFormat: "mp4/../../evil" },
        60_000,
      );
      ctx.check(
        "A: downloadVideo rejects convertFormat 'mp4/../../evil'",
        result && result.ok === false,
        JSON.stringify(result),
      );
      if (status) ctx.note(`A: request was accepted; final status: ${status}`);
    });
    const evilA = escapedFiles(ctx.root, "evil");
    ctx.check("A: no evil* file anywhere under the temp root", evilA.length === 0, evilA.join(", ") || "none");

    // B. Traversal persisted in settings and reached without a request-level
    //    convertFormat, so the main process reads it from settings.json.
    const dlB = ctx.dir("dl-b");
    await ctx.attempt("B: persisted traversal payload", async () => {
      const saved = await page.evaluate(() =>
        window.api.saveSettings({ convertEnabled: true, convertFormat: "mp4/../../evil2" }),
      );
      ctx.check("B: saveSettings accepts convertFormat 'mp4/../../evil2'", saved && saved.ok === true, JSON.stringify(saved));
      const { status } = await downloadAndWait(page, { url: ctx.url("sample.mp4"), outputPath: dlB }, 60_000);
      ctx.note(`B: final status: ${status}`);
    });
    const evilB = escapedFiles(ctx.root, "evil2", dlB);
    ctx.check("B: no evil2* file outside the download folder", evilB.length === 0, evilB.join(", ") || "none");

    // C. Show that the traversal really escapes. The output path is
    //    "<dir>/<stem>.mp4/../../<name>.mp4". The kernel resolves ".." only
    //    through an existing directory, so pre-create "<stem>.mp4/" in the
    //    download folder. The source is named .mkv so the download does not
    //    collide with that directory.
    const dlC = ctx.dir("dl-c");
    fs.mkdirSync(path.join(dlC, "sample-escape.mp4"));
    await ctx.attempt("C: escape through an existing <stem>.mp4 directory", async () => {
      const saved = await page.evaluate(() =>
        window.api.saveSettings({ convertEnabled: true, convertFormat: "mp4/../../evil-escape.mp4" }),
      );
      ctx.check("C: saveSettings accepts the escape payload", saved && saved.ok === true, JSON.stringify(saved));
      const { status } = await downloadAndWait(page, { url: ctx.url("sample-escape.mkv"), outputPath: dlC }, 60_000);
      ctx.note(`C: final status: ${status}`);
    });
    const evilC = escapedFiles(ctx.root, "evil-escape", dlC);
    ctx.check("C: converted output stays inside the download folder", evilC.length === 0, evilC.join(", ") || "none");
  },
};
