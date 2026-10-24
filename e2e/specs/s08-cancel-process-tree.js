const {
  closeApp,
  completionCount,
  findProgressLine,
  sleep,
  startDownloadIpc,
  waitForCompletion,
  waitForProgress,
} = require("../lib/electronApp");
const { findProcessesWithTokens } = require("../lib/processes");

const SETTLE_MS = 6000;
const PROGRESS = /\[download\]\s+\d+(\.\d+)?%/;

function describe(processes) {
  return processes.map((proc) => `pid ${proc.pid}: ${proc.command.slice(0, 160)}`).join(" | ");
}

module.exports = {
  id: "S8",
  title: "Cancel and app quit kill the whole yt-dlp process tree",
  failureModes: ["F5"],
  async run(ctx) {
    // Phase 1: cancel a throttled download, then look for survivors.
    const cancelToken = ctx.token("cancel");
    const cancelSession = await ctx.launch();
    const { page } = cancelSession;
    const beforeCancel = await completionCount(page);
    await startDownloadIpc(page, {
      url: ctx.throttledUrl(cancelToken, "big.mp4"),
      outputPath: cancelSession.downloadDir,
    });
    await waitForProgress(page, PROGRESS, 60_000);
    ctx.note(`phase 1 progress: ${await findProgressLine(page, "[download]")}`);

    // The download button cannot start a download on the current code (F10),
    // so the cancel request goes through the same IPC the button uses.
    await page.evaluate(() => window.api.cancelDownload());
    const cancelStatus = await waitForCompletion(page, beforeCancel, 30_000);
    ctx.check("cancel reports Cancelled", /Cancelled/.test(cancelStatus), cancelStatus);

    await sleep(SETTLE_MS);
    const survivorsAfterCancel = findProcessesWithTokens([cancelToken]);
    ctx.check(
      "no yt-dlp process survives cancel (6 s later)",
      survivorsAfterCancel.length === 0,
      describe(survivorsAfterCancel) || "none",
    );
    await closeApp(cancelSession);

    // Phase 2: quit the app while a throttled download is running.
    const quitToken = ctx.token("quit");
    const quitSession = await ctx.launch();
    await startDownloadIpc(quitSession.page, {
      url: ctx.throttledUrl(quitToken, "big.mp4"),
      outputPath: quitSession.downloadDir,
    });
    await waitForProgress(quitSession.page, PROGRESS, 60_000);
    await closeApp(quitSession);

    await sleep(SETTLE_MS);
    const survivorsAfterQuit = findProcessesWithTokens([quitToken]);
    ctx.check(
      "no yt-dlp process survives app quit (6 s later)",
      survivorsAfterQuit.length === 0,
      describe(survivorsAfterQuit) || "none",
    );
  },
};
