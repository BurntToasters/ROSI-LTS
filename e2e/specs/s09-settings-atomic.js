const fs = require("fs");
const path = require("path");
const { closeApp } = require("../lib/electronApp");

// A temp file left next to settings.json means a write was staged and not
// renamed into place.
function settingsTempLeftovers(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => /settings.*\.tmp$|\.tmp$/i.test(name));
}

function tryParse(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: error.message };
  }
}

module.exports = {
  id: "S9",
  title: "settings.json is complete JSON after saves, with no .tmp leftovers",
  failureModes: ["F8"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page, userDataDir } = session;
    const file = path.join(userDataDir, "settings.json");

    const saved = await page.evaluate(() =>
      window.api.saveSettings({ showConsoleOutput: true, consoleCollapsed: true }),
    );
    ctx.check("saveSettings reports ok", saved && saved.ok === true, JSON.stringify(saved));

    const exists = fs.existsSync(file);
    ctx.check("settings.json exists in the isolated userData dir", exists, file);
    if (exists) {
      const parsed = tryParse(file);
      ctx.check("settings.json parses as JSON after save", parsed.value !== undefined, parsed.error || "");
      ctx.check(
        "saved values are persisted",
        parsed.value && parsed.value.showConsoleOutput === true && parsed.value.consoleCollapsed === true,
        "",
      );
    }
    const leftovers = settingsTempLeftovers(userDataDir);
    ctx.check("no settings temp file remains after save", leftovers.length === 0, leftovers.join(", ") || "none");

    // Several saves in a row, to catch a stale temp file left by an earlier one.
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate((n) => window.api.saveSettings({ notifications: n % 2 === 0 }), i);
    }
    const afterMany = tryParse(file);
    ctx.check("settings.json parses after repeated saves", afterMany.value !== undefined, afterMany.error || "");

    await closeApp(session);
    const afterQuit = tryParse(file);
    ctx.check("settings.json parses after app quit", afterQuit.value !== undefined, afterQuit.error || "");
    ctx.check(
      "no settings temp file remains after app quit",
      settingsTempLeftovers(userDataDir).length === 0,
      settingsTempLeftovers(userDataDir).join(", ") || "none",
    );
    if (fs.existsSync(file)) ctx.recordFile("settings.json", file);
  },
};
