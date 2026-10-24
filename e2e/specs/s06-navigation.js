const { sleep } = require("../lib/electronApp");

module.exports = {
  id: "S6",
  title: "Renderer cannot navigate the main window to a file: URL",
  failureModes: ["F3"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page } = session;
    const before = page.url();

    // Navigation tears down the page context, so the evaluate may throw.
    await page.evaluate(() => {
      location.href = "file:///etc/hosts";
    }).catch(() => {});
    await sleep(3000);

    const after = page.url();
    ctx.note(`url before: ${before}`);
    ctx.note(`url after: ${after}`);
    ctx.check(
      "main window is still index.html after navigation attempt",
      after.endsWith("/index.html"),
      after,
    );
  },
};
