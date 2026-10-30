# Answers for the store review forms

Copy these into the corresponding fields. They match what the code actually does.

## Chrome Web Store – "Privacy practices" tab

**Single purpose description**

> Klangbild adjusts how audio and video play on web pages in real time: playback speed, audio/video synchronization, sound (volume, equalizer, voice enhancement, dynamics) and picture (color filters, sharpness, zoom, rotation).

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `storage` | Stores the user's settings locally: settings remembered per website and the user's own presets. Nothing is synced or sent anywhere. |
| `scripting` | Injects the extension's own content script into tabs that were already open before installation, and asks each frame of the active tab which one contains the playing video, so the panel controls the right player (including embedded players in iframes). |
| `downloads` | Saves a screenshot of the current video frame as a PNG file when the user clicks "Save frame" or uses the screenshot shortcut. |
| Host permission `<all_urls>` | The extension's core function is to find and modify `<video>` and `<audio>` elements (playback rate, Web Audio processing, CSS filters) on whatever website the user watches or listens on. Media players exist on arbitrary sites and in cross-origin iframes, so access cannot be limited to a fixed list of domains. No page content, form data or browsing history is read, stored or transmitted. |

**Remote code:** No, I am not using remote code. All code is included in the package; there are no external scripts, `eval` or remote resources.

**Data usage:** Check **none** of the data categories. Then confirm all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** the public address where you publish `privacy-policy.md` (see README).

## Firefox Add-ons (AMO) – submission

- **Distribution:** "On this site" (listed on addons.mozilla.org)
- **Source code:** Not required. The package contains the unmodified source files; the build step (`scripts/build.mjs`) only copies `src/` and adds the browser's manifest – no minification, bundling or transpiling.
- **Data collection:** declared in the manifest as `"data_collection_permissions": { "required": ["none"] }`.
- **License:** your choice (e.g. MIT if the code may be reused, or "All rights reserved").

**Notes to reviewer** (paste into "Notes for Reviewers"):

> Klangbild changes playback of <video>/<audio> elements on web pages: playbackRate, a Web Audio processing chain (createMediaElementSource → delay/EQ/dynamics → destination), CSS filters/transforms on the video element, and an optional canvas overlay that shows buffered frames delayed (for audio that lags behind the picture).
>
> - Host permission <all_urls> is required because media players live on arbitrary sites and in cross-origin iframes.
> - The extension makes no network requests. The only fetch() in background.js converts a locally created screenshot data: URL into a blob for downloads.download().
> - Copy-protected (EME) media is detected (mediaKeys / "encrypted" event) and deliberately left untouched for audio and picture capture.
> - popup/analyzer.html is an optional window that analyzes system audio via getDisplayMedia (Chrome only) or getUserMedia on a user-chosen input device. The stream is analyzed locally and not recorded.
>
> To test: open any page with a video (e.g. a YouTube video), click the toolbar button and change e.g. Speed, Volume, Brightness or Audio delay.
