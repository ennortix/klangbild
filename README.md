# Klangbild – Live Audio & Video Editing for Firefox and Chrome

Edits audio and video on any website in real time – YouTube, Twitch, media libraries, embedded players and more.

## Features

**Playback**
- Speed 0.25× – 4× (optionally preserving pitch)
- Audio delay from −1000 to +5000 ms to sync sound and picture
  - **Positive:** sound is early → the sound is delayed
  - **Negative:** sound is late (e.g. Bluetooth headphones) → the picture is delayed: the video is made invisible and a canvas on top shows its frames with an offset

**Audio** (Web Audio API)
- Volume 0 – 400 % (boost above 100 %)
- 3-band equalizer (bass 200 Hz, mids 1 kHz, treble 4 kHz, ±15 dB each)
- Left/right balance, mono downmix
- Compressor to even out quiet and loud passages
- "Enhance voice": filters out rumble and lifts the speech range around 3 kHz
- Limiter at −1 dBFS against clipping when boosting the volume
- Live spectrum (48 bands) and level meter with peak hold
- **System audio analyzer** (separate window, Audio tab → "System audio"): spectrum of everything the computer plays – also for copy-protected streams like Prime Video, whose audio pages can't access. Nothing is recorded.
  - Chrome on Windows: share the screen with "Also share system audio" (the picture is discarded immediately)
  - Any browser: a loopback input such as "Stereo Mix" or the free virtual cable VB-CABLE

**Video** (CSS filters, GPU-accelerated)
- Brightness, contrast, saturation, hue
- Sharpness (SVG convolution filter), blur, grayscale, sepia, invert
- Zoom, flip horizontally/vertically, rotate in 90° steps

**Extras**
- Presets: Clear speech, Night mode, Bass boost, Cinema, Vivid colors, Easy on the eyes – they keep speed and A/V offset. Custom presets can be saved, applied and deleted.
- Tools: frame-by-frame back/forward, play/pause, A-B loop, screenshot as PNG (including the active color filters)
- Tools, shortcuts and the analyzer act on the tab's "primary media": playing beats paused, large beats small – embedded players included

**Keyboard shortcuts** (change them at `about:addons` → gear icon → Manage Extension Shortcuts)

| Shortcut | Action |
| --- | --- |
| Alt+Shift+A | Open panel |
| Alt+Shift+↑ / ↓ | Speed ±0.25× |
| Alt+Shift+→ / ← | Audio delay ±10 ms |
| Alt+Shift+E | All effects on/off |
| Alt+Shift+L | A-B loop: set A → set B → off |
| Alt+Shift+S | Save screenshot |

Every change made with a shortcut is briefly shown on top of the video.

**Controls**
- Switch at the top right: all effects on/off (A/B comparison; speed is kept)
- Double-clicking a slider name or clicking "reset" restores its default
- "Remember for *site*": settings are stored per website and applied automatically on the next visit

## Installation (development)

One shared code base in `src/`, one manifest per browser in `manifests/`. The build copies both into `dist/<browser>/` (no dependencies needed):

```sh
npm run build          # → dist/firefox/ and dist/chrome/
```

**Firefox** (140 or newer): open `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on …" → select `dist/firefox/manifest.json`.

**Chrome** (116 or newer, also Edge, Brave, Opera): open `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select the `dist/chrome` folder. After rebuilding, click the reload icon on the extension card.

With [web-ext](https://github.com/mozilla/web-ext):

```sh
npm install
npm start              # Firefox with the extension loaded
npm run start:chrome   # Chrome/Chromium with the extension loaded
npm run lint           # checks the Firefox build
npm run package        # store-ready .zip files in web-ext-artifacts/{firefox,chrome}/
npm run icons          # regenerates the PNG icons Chrome needs from the SVG's shapes
```

On installation the browser asks for permission to access all websites – it is needed to control media elements on pages.

### Browser differences

| | Firefox | Chrome |
| --- | --- | --- |
| Background | event page (`background.scripts`) | service worker (`importScripts`) |
| Icons | SVG | PNG (`src/icons/icon-*.png`) |
| Preset shortcuts | all 8 | 4 (Chrome's limit); assign the rest at `chrome://extensions/shortcuts` |
| Screenshot download | blob URL | data URL (service workers have no `URL.createObjectURL`) |

`src/common.js` maps `browser` to `chrome` in Chrome and wraps message listeners, since Chrome ignores promises returned from `onMessage`.

## Known limitations

- **Copy-protected videos (Prime Video, Netflix, Disney+ …):** Firefox hands out neither the sound nor the frames of DRM content to extensions. Audio effects, analyzer, screenshot and picture delay are technically impossible there. The extension detects such videos, leaves their sound untouched (instead of silencing it) and shows a notice. Speed, video filters, loop and frame stepping still work.
- **Picture delay (negative values):**
  - When the `<video>` element itself is fullscreen (rather than the player around it), the original is shown without delay. With the fullscreen button of YouTube and most other players the delay works.
  - Costs some CPU/GPU and memory (buffered frames), hence a maximum of 1000 ms.
- **Audio effects are permanent per element:** once an audio effect (volume, EQ, delay, …) is used for the first time, the element's sound runs through the Web Audio API until the page is reloaded. At neutral settings this is inaudible.
- **Silent sound with some sources:** media loaded from another domain without CORS permission is not handed to the Web Audio API by Firefox for security reasons – the sound goes silent as soon as an audio effect is active. Reset the audio values and reload the page. Speed and video filters still work there.
- **The analyzer** only works while the sound runs through Web Audio (once an audio effect is active or "Start analyzer" was clicked) – with the same risk of silence as above.
- **Sharpness** is an SVG filter computed on the CPU in Firefox; 4K videos may stutter.
- **Screenshots** aren't possible for DRM content and videos from other domains without CORS permission.
- **Frame stepping** moves in 1/30-second steps because browsers don't expose the real frame rate.
- Some players reset the speed on their own; the extension restores it as long as it isn't 1×. If a player keeps fighting back, it gives up after 10 corrections within 2 seconds instead of switching back and forth forever.
- **After an extension update** audio effects in tabs that were already open are blocked until reload (a media element can be connected to Web Audio only once). The panel points this out. In Chrome the old, orphaned instance hands over to the new one and makes its audio routing transparent.
- Media that is never inserted into the page (e.g. played in the background via `new Audio()`) can't be found. Videos inside web components (shadow DOM) are detected.

## Structure

```
manifests/
├── firefox.json      Firefox manifest
└── chrome.json       Chrome manifest
scripts/
├── build.mjs         src/ + manifest → dist/<browser>/
└── make-icons.mjs    renders the PNG icons
src/
├── common.js         Defaults, helpers, browser API adapter (shared)
├── content.js        Finds <video>/<audio> and applies the effects
├── videodelay.js     Picture delay via canvas overlay (negative audio delay)
├── background.js     Site settings, keyboard shortcuts, screenshot download
├── popup/
│   ├── popup.js      Sliders, tabs, state
│   ├── spectrum.js   Live spectrum and level meter
│   ├── presets.js    Built-in and custom presets
│   ├── tools.js      Loop, frames, screenshot, shortcut list
│   └── icons.js      Inline SVG icons
└── icons/            SVG (Firefox) and PNG (Chrome) icons
```

## License

[MIT](LICENSE)
