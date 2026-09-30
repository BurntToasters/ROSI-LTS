import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("packaging and desktop contracts", () => {
  it("keeps Linux desktop integration aligned across package and builder", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    const baseConfig = readRepoFile("electron-builder.base.yml");

    expect(pkg.desktopName).toBe("com.burnttoasters.rosi-lts.desktop");
    expect(baseConfig).toMatch(/syncDesktopName:\s*true/);
  });

  it("keeps AppStream launchable aligned with desktopName", () => {
    const pkg = JSON.parse(readRepoFile("package.json"));
    const metainfo = readRepoFile("com.burnttoasters.rosi-lts.metainfo.xml");

    expect(metainfo).toContain(
      `<launchable type="desktop-id">${pkg.desktopName}</launchable>`,
    );
  });
});
