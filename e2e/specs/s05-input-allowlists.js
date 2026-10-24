const fs = require("fs");
const path = require("path");
const {
  completionCount,
  waitForCompletion,
  startDownloadIpc,
} = require("../lib/electronApp");

async function expectRejected(ctx, page, label, options, dl) {
  const before = await completionCount(page);
  const result = await startDownloadIpc(page, { url: ctx.url("sample.mp4"), outputPath: dl, ...options });
  ctx.check(label, result && result.ok === false, JSON.stringify(result));
  // If the payload was accepted, let that download finish so the next call
  // starts from an idle app.
  if (result && result.ok === true) {
    await waitForCompletion(page, before, 60_000);
  }
}

module.exports = {
  id: "S5",
  title: "videoFormat, audioFormat and browserChoice are allowlisted",
  failureModes: ["F2"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page, downloadDir, userDataDir } = session;
    const settingsFile = path.join(userDataDir, "settings.json");

    await ctx.attempt("videoFormat '--exec'", () =>
      expectRejected(ctx, page, "downloadVideo rejects videoFormat '--exec'", { videoFormat: "--exec" }, downloadDir),
    );
    await ctx.attempt("videoFormat 'bad format!'", () =>
      expectRejected(ctx, page, "downloadVideo rejects videoFormat 'bad format!'", { videoFormat: "bad format!" }, downloadDir),
    );
    await ctx.attempt("audioFormat '--exec'", () =>
      expectRejected(ctx, page, "downloadVideo rejects audioFormat '--exec'", { audioFormat: "--exec" }, downloadDir),
    );

    await ctx.attempt("browserChoice 'not-a-browser'", async () => {
      const result = await page.evaluate(() =>
        window.api.saveSettings({ browserChoice: "not-a-browser" }),
      );
      ctx.check("saveSettings rejects browserChoice 'not-a-browser'", result && result.ok === false, JSON.stringify(result));
      const persisted = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      ctx.check("rejected browserChoice is not persisted", persisted.browserChoice !== "not-a-browser", String(persisted.browserChoice));
    });

    // Positive controls: valid values must still be accepted, otherwise a
    // fix that over-blocks would look like a pass.
    await ctx.attempt("positive controls", async () => {
      const saved = await page.evaluate(() => window.api.saveSettings({ browserChoice: "Firefox" }));
      ctx.check("saveSettings accepts browserChoice 'Firefox'", saved && saved.ok === true, JSON.stringify(saved));

      const before = await completionCount(page);
      const started = await startDownloadIpc(page, {
        url: ctx.url("sample.mp4"),
        outputPath: downloadDir,
        videoFormat: "best[ext=mp4]",
      });
      ctx.check("downloadVideo accepts videoFormat 'best[ext=mp4]'", started && started.ok === true, JSON.stringify(started));
      if (started && started.ok) {
        const status = await waitForCompletion(page, before, 60_000);
        ctx.check("valid videoFormat download completes", /Download complete/.test(status), status);
      }
    });
  },
};
