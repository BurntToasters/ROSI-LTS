const { sleep } = require("../lib/electronApp");

// Probes used (both run in the renderer):
//   notifications: Notification.requestPermission()
//   microphone:    navigator.mediaDevices.getUserMedia({ audio: true })
// A permission request passes only if it is denied or rejected.
module.exports = {
  id: "S7",
  title: "Renderer permission requests are denied",
  failureModes: ["F4"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page } = session;
    await sleep(500);

    const notification = await page.evaluate(async () => {
      if (typeof Notification === "undefined") return { state: "unavailable" };
      try {
        return { state: await Notification.requestPermission() };
      } catch (error) {
        return { rejected: error.name || String(error) };
      }
    });
    ctx.note(`notifications probe: ${JSON.stringify(notification)}`);
    ctx.check(
      "Notification.requestPermission is denied or rejected",
      notification.state === "denied" || notification.rejected !== undefined,
      JSON.stringify(notification),
    );

    const microphone = await page.evaluate(async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { state: "unavailable" };
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return { granted: true };
      } catch (error) {
        return { rejected: error.name || String(error) };
      }
    });
    ctx.note(`microphone probe: ${JSON.stringify(microphone)}`);
    ctx.check(
      "getUserMedia({audio}) is not granted",
      microphone.granted !== true,
      JSON.stringify(microphone),
    );
  },
};
