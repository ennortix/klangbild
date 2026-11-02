# Answers for the store review forms

Copy these into the corresponding fields. They match what the code actually does (version 1.2.0).

## Chrome Web Store – "Privacy practices" tab

**Single purpose description**

> Klangbild adjusts how audio and video play on web pages in real time: playback speed, audio/video synchronization, sound (volume, equalizer, voice enhancement, dynamics) and picture (color filters, sharpness, zoom, rotation).

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `storage` | Stores the user's settings locally: settings remembered per website, the user's own presets and address rules, and – for "continue watching" – the last playback position of longer videos, keyed by a SHA-256 hash of the page address (never from incognito windows, can be switched off and cleared). Nothing is synced or sent anywhere. |
| `scripting` | Injects the extension's own content script into tabs that were already open before installation, and asks each frame of the active tab which one contains the playing video, so the panel controls the right player (including embedded players in iframes). |
| `downloads` | Saves a screenshot of the current video frame as a PNG file when the user clicks "Save frame" or uses the screenshot shortcut. |
| Host permission `<all_urls>` | The extension's core function is to find and modify `<video>` and `<audio>` elements (playback rate, Web Audio processing, CSS filters) on whatever website the user watches or listens on. Media players exist on arbitrary sites and in cross-origin iframes, so access cannot be limited to a fixed list of domains. No page content or form data is read; nothing is transmitted. |

**Remote code:** No, I am not using remote code. All code is included in the package; there are no external scripts, `eval` or remote resources. The AudioWorklet for "voice ↔ background" is loaded from the package itself (`dialog.js`, `dialog-worklet.js`, listed as web-accessible resources so the page's audio context can load them).

**Data usage:** Check **none** of the data categories – no data leaves the device. (The playback positions for "continue watching" stay in the browser's local extension storage, under hashed addresses; they are not collected or transmitted.) Then confirm all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://ennortix.github.io/klangbild/privacy.html

## Firefox Add-ons (AMO) – submission

- **Distribution:** "On this site" (listed on addons.mozilla.org)
- **Source code:** Not required. The package contains the unmodified source files; the build step (`scripts/build.mjs`) only copies `src/` and adds the browser's manifest – no minification, bundling or transpiling.
- **Data collection:** declared in the manifest as `"data_collection_permissions": { "required": ["none"] }`.
- **License:** MIT (see `LICENSE`)

**Notes to reviewer** (paste into "Notes for Reviewers"):

> Klangbild changes playback of <video>/<audio> elements on web pages: playbackRate, a Web Audio processing chain (createMediaElementSource → delay/EQ/dynamics → destination), CSS filters/transforms on the video element, and optional canvas overlays: one shows buffered frames delayed (for audio that lags behind the picture), one draws a blurred glow around the picture ("ambilight").
>
> - Host permission <all_urls> is required because media players live on arbitrary sites and in cross-origin iframes.
> - The extension makes no network requests. The only fetch() in background.js converts a locally created screenshot data: URL into a blob for downloads.download().
> - dialog.js / dialog-worklet.js are web-accessible only so the page's AudioContext can load the packaged AudioWorklet ("voice ↔ background", a local STFT-based mid/side separation). No remote code.
> - "Continue watching" stores the playback position of videos of 2 minutes or more in storage.local, keyed by a SHA-256 hash of the address (time parameters removed); nothing from private windows; at most 1000 entries; can be switched off and cleared on the options page.
> - The sidebar (sidebar_action) shows the same panel; its mixer lists media of all tabs via tabs.query and the content scripts, and uses tabs.update only for the tab's own mute.
> - Copy-protected (EME) media is detected (mediaKeys / "encrypted" event) and deliberately left untouched for audio and picture capture.
> - popup/analyzer.html is an optional window that analyzes system audio via getDisplayMedia (Chrome only) or getUserMedia on a user-chosen input device. The stream is analyzed locally and not recorded.
>
> To test: open any page with a video (e.g. a YouTube video), click the toolbar button and change e.g. Speed, Volume, Brightness or Audio delay. The sidebar opens via View → Sidebar → Klangbild.
