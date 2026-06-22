### Welcome to ROSI LTS v3!
After a lot of release script improvements with V4, ROSI LTS is no longer on hiatus! 

# ⬇️ Downloads

[<img src="https://get.microsoft.com/images/en-us%20dark.svg" width="175"/>](https://apps.microsoft.com/detail/9p4q134b2jw3?referrer=appbadge&mode=direct)

| <img height="20" src="https://github.com/user-attachments/assets/340d360e-79b1-4c70-bfab-d944085f75df" /> Windows | <img height="20" src="https://github.com/user-attachments/assets/42d7e887-4616-4e8c-b1d3-e44e01340f8c" /> MacOS | <img height="20" src="https://github.com/user-attachments/assets/e0cc4f33-4516-408b-9c5c-be71a3ac316b" /> Linux |
| :--- | :--- | :--- |
| **[Universal EXE](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-Windows.exe)** <br>*(Both x64 and arm64)* | **[Universal DMG](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-MacOS-universal.dmg)** | **AppImage:** [x64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-Linux-x86_64.AppImage) / [arm64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-Linux-arm64.AppImage) |
| **Other:** [x64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-Windows-x64.exe) / [arm64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-Windows-arm64.exe) | | **DEB:** [x64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-linux_amd64.deb) / [arm64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-linux_arm64.deb) |
| | | **RPM:** [x64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-linux.x86_64.rpm) / [arm64](https://github.com/BurntToasters/ROSI-LTS/releases/download/v3.6.5-LTS/ROSI-LTS-linux.aarch64.rpm) |

### ℹ️ Enjoying ROSI? Consider [❤️ Supporting Me! ❤️](https://rosie.run/support)

---

### Below are the highlights of the original V3 release so user's can see what's changed from V2 -> V3 LTS.

## Changes in `v3.6.5-LTS`:
* **PKG:** Updated packages.
* **macOS:** Re-sign bundled yt-dlp with helper entitlements after packaging so PyInstaller can load its Python runtime on signed builds.
* **macOS:** Fall back to Homebrew/system yt-dlp when the bundled binary fails its startup check.

## Changes in `v3.6.4-LTS`:
* **Electron:** Updated electron to `42.2.0`.
* **PKG:** Updated packages.

#  v3.0.0 Highlights

###  Revamped UI (Again)
Rebuilt from the ground up to be more space-efficient and aesthetically pleasing.
* **Window Size:** The app's default window size has been increased.
* **Navigation:** Settings menu is now a sidebar instead of a dropdown.
* **Layout:** Allows more space for optional user elements.
* *Note:* UI is still undergoing tweaks before the stable release.

###  Feature Updates
* **YT-DLP:** Updated YT-DLP to `2025.12.08`.
* **Advanced Formats:** Better YT-DLP argument support has been added if a user turns on the advanced format selection option.
* **Progress Bar:** Finally added! Users can now see download progress for videos/media (no more "silent" downloads).
* **Audio-Only Downloads:** A new setting has been added to easily download only audio from your URL!
* **Open Downloaded File:** A button will now pop-up after a download to easily, bring you to your downloaded media!
* * **Misc:** Removed old, unused code.
* **App Notifications:** A new notification system has been added to notify you when downloads are done! (This can be disabled in settings).
* **Linux ARM Support:** Added support for Linux on Arm64 devices (using `yt-dlp` arm64 binary).
* **Auto-Update Support:** Added `electron-updater` for non-MS Store builds.
    * Replaces the manual download method.
    * Users can now download and install updates directly through the app.

### Fixed Issues:
* Fixed an issue with HTML sometimes not rendering correctly (malformed tags).
* Fixed button text-state not sometimes restoring.
* Fixed duplicate handlers for the `ESC` key listening at once.
* Fixed URL input Validation.
* Fixed multiple issues leading to YT-DLP hanging.

---

# ℹ️ Installation & Notes

### 🔐 GPG Signing
ROSI-LTS Binaries (`v2.1.2+`) are GPG signed. You can verify the authenticity of your download by downloading the installer, its accompanying sig, and the public key attached to this release.

*ROSI's MacOS release is the only GitHub release that is fully codesigned by a developer cert from apple. If you are looking for a version of ROSI that is codesigned for windows, check out the [Microsoft Store](https://apps.microsoft.com/detail/9p4q134b2jw3?referrer=appbadge&mode=direct) version!*

# CURRENT VERSION:
Users who are looking for the most current builds of ROSI should go to: [https://github.com/BurntToasters/ROSI](https://github.com/BurntToasters/ROSI)