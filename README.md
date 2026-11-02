# Klangbild – Live Audio & Video Editing for Firefox and Chrome

Edits audio and video on any website in real time – YouTube, Twitch, media libraries, embedded players and more.

## Features

**Playback**
- Speed 0.25× – 4× (optionally preserving pitch), quick buttons for 0.5× – 3×
- Audio delay from −1000 to +5000 ms to sync sound and picture
  - **Positive:** sound is early → the sound is delayed
  - **Negative:** sound is late (e.g. Bluetooth headphones) → the picture is delayed: the video is made invisible and a canvas on top shows its frames with an offset
- **Skip silence**: pauses play 3× as fast (on top of the speed setting), the sound itself at its speed – for talks, lectures and podcasts. Silence is relative to the recording: the level of what is heard is followed, and what stays 20 dB under it (between −60 and −36 dBFS) for 0.25 s is a pause, so room noise counts as silence but a quiet speaker doesn't. The sidebar's timeline shows the time saved
- **Continue watching**: videos and audio of 2 minutes or more continue where they were left, on any website (2 s earlier, to get back into it). Not when the page starts somewhere itself, e.g. a link with a time. Positions are stored locally under a hash of the address, never from private windows; the last 1000 are kept. Can be switched off and cleared in the options

**Audio** (Web Audio API)
- Volume 0 – 400 % (boost above 100 %)
- 3-band equalizer (bass 200 Hz, mids 1 kHz, treble 4 kHz, ±15 dB each)
- Left/right balance, mono downmix, swap left/right
- Stereo width 0 – 200 % (0 % = mono, 200 % = extra wide; above 100 % the limiter is always on)
- Compressor to even out quiet and loud passages
- "Enhance voice": filters out rumble and lifts the speech range around 3 kHz
- Limiter at −1 dBFS against clipping when boosting the volume
- Loudness leveling: brings quiet and loud media to a similar level (averaged over 3 s, at most ±12 dB, pauses are ignored)
- Reverb 0 – 100 % (a generated room, computed only while it is on)
- **Voice ↔ background** (−100 … +100): separates speech mixed to the center from music, effects and room sound, then lowers one of them by up to 24 dB. Per frequency it measures how similar the left and right channels are (STFT, no AI model); only the speech band counts as voice. Works best with stereo, with mono only the frequency range separates. Runs in an AudioWorklet and delays the sound by about 21 ms; switched completely out of the chain at 0
- Live spectrum (48 bands) and level meter with peak hold
- **System audio analyzer** (separate window, Audio tab → "System audio"): spectrum of everything the computer plays – also for copy-protected streams like Prime Video, whose audio pages can't access. Nothing is recorded.
  - Chrome on Windows: share the screen with "Also share system audio" (the picture is discarded immediately)
  - Any browser: a loopback input such as "Stereo Mix" or the free virtual cable VB-CABLE

**Video** (CSS filters, GPU-accelerated)
- Brightness, contrast, saturation, hue, gamma, color temperature (SVG filter)
- Sharpness (SVG convolution filter), blur, grayscale, sepia, invert
- Color vision correction for red, green or blue weakness (daltonization: what the affected eye can't tell apart is shifted into colors it still distinguishes)
- Zoom, move the picture horizontally/vertically, flip horizontally/vertically, rotate in 90° steps
- **Ambilight** 0 – 100 %: a soft glow around the picture in the colors of its edges. It lies over the page with a hole for the picture (clicks go through) and blends with "screen", so it shows on dark pages and in fullscreen black bars and disappears on white ones

**Extras**
- Presets: Clear speech, Night mode, Bass boost, Cinema, Vivid colors, Easy on the eyes – they keep speed and A/V offset. Custom presets can be saved, applied and deleted.
- Tools: jump ±10 s, frame-by-frame back/forward (at the measured frame rate), play/pause, A-B loop, repeat the whole video, sleep timer (15 – 90 min, fades out over the last 10 s, then pauses), screenshot as PNG (including the active color filters), video resolution, frame rate and dropped frames
- Default for all sites: the current settings become the starting point for every site without its own remembered settings
- **Sliders**: the thumb carries three rings and turns like a knob around the point where it was grabbed – the ring it was grabbed by sets the step size: inner 1 step per notch (fine), middle 5, outer 10, one notch every 18°, clockwise up; hovering lights up the ring under the pointer and names its step size (±1, ±5, ±10) below the thumb. Options page ("Sliders"): Drag (default) – pulled along the track the thumb moves in steps of the ring it was grabbed by (1, 5 or 10), pulled up or down and circled it turns; Turn – a press always turns. Both: a click on the track jumps there, double-click resets, the mouse wheel steps (Shift: 10 steps), a bubble above the thumb shows the value while it changes
- Options page (Extras → "Manage sites & backup"): list and delete remembered sites, disabled sites and custom presets, remove the default, export everything to a JSON backup and import it again (merged, values are checked; positions for "continue watching" are not exported)
- **Rules**: settings for addresses, set up in the options page – a preset and/or a speed for e.g. `example.com/podcasts/*` or `example.com/watch?v=*`. A host includes its subdomains, `*` stands for any text, a path without `*` is a prefix; the most specific matching rule wins. Applied on top of the site's remembered settings when a page loads, and again when a single-page site (YouTube, …) enters, leaves or switches a rule without reloading. The panel's status line names the active rule
- "Disable on this site": Klangbild leaves video and audio on that site completely alone (the page is reloaded); re-enable it from the panel or the options page
- **Firefox sidebar** (sidebar icon or View → Sidebar → Klangbild): the panel stays open and follows the active tab, with more room than the compact popup:
  - Timeline of the primary media: position, seek bar with the A-B loop marked, jump back/forward (short and long jump, adjustable), frame by frame, play/pause
  - Extended limits: speed 0.1 – 16×, volume up to 800 %, EQ ±24 dB, audio delay up to 10 s, brightness/contrast/saturation up to 500 %, zoom 25 – 500 % and more (Firefox mutes the sound outside 0.25 – 4×). Can be switched off in the Customize tab.
  - − / + buttons on every slider and a custom step size per slider (Customize tab); the steps always pass through the default, so 1× stays reachable
  - Mixer: every video and audio of every tab, each with its own volume (0 – 200 %), mute, play/pause and level meter, on top of the tab's settings and until the page is reloaded. Media from another server without CORS permission is controlled through the player's own volume instead (at most 100 %), so it can't go silent. Plus the browser's tab mute, which also works for copy-protected media
- Light and dark design, following the system setting
- The toolbar icon shows the tab's speed when it isn't 1×, and "off" while all effects are bypassed
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
| *(unassigned)* | Open in the sidebar (Firefox), reset speed to 1×, jump back/forward 10 s, volume ±10 % |

Every change made with a shortcut is briefly shown on top of the video.

**Languages**
- English and German – the panel, on-screen messages and shortcut names follow the browser's language. Texts live in `src/_locales/<lang>/messages.json`.

**Controls**
- Switch at the top right: all effects on/off (A/B comparison; speed is kept)
- Double-clicking a slider name or clicking "reset" restores its default
- "Remember for *site*": settings are stored per website and applied automatically on the next visit; sites without their own settings use the default for all sites, if one is set

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
npm test               # unit tests; the Web Audio tests need Chrome (CHROME_PATH), else they're skipped
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
- **Sharpness, gamma and color temperature** are an SVG filter computed on the CPU in Firefox; 4K videos may stutter.
- **Screenshots** aren't possible for DRM content and videos from other domains without CORS permission.
- **Frame stepping** uses the frame rate measured during the first seconds of playback. Before that (e.g. a video that was never played) it moves in 1/30-second steps.
- Some players reset the speed on their own; the extension restores it as long as it isn't 1×. If a player keeps fighting back, it gives up after 10 corrections within 2 seconds instead of switching back and forth forever.
- **After an extension update** a media element stays connected to the old version's Web Audio routing (it can be connected only once and never released).
  - Firefox: the old version is shut down, its routing keeps the last settings and can't be reached any more. The panel says so right away and offers "Reload and continue", which reloads the tab and continues playback at the same position.
  - Chrome: the old version keeps running and stays the audio engine of its elements; the new one sends it the settings (through events on the element), so everything keeps working without a reload. This needs the old version to be 1.2.0 or newer; with older ones the panel offers the reload as in Firefox.
- **Sleep timer** runs in the page: it ends when the page is left or reloaded, and in background tabs the browser may delay it by up to a minute.
- Media that is never inserted into the page (e.g. played in the background via `new Audio()`) can't be found. Videos inside web components (shadow DOM) are detected.

## Structure

```
manifests/
├── firefox.json      Firefox manifest
└── chrome.json       Chrome manifest
scripts/
├── build.mjs         src/ + manifest → dist/<browser>/
└── make-icons.mjs    renders the PNG icons
test/                 Unit tests (Node) and end-to-end tests (extension in headless Chrome), fixtures/
src/
├── common.js         Defaults, helpers, browser API adapter (shared)
├── content.js        Finds <video>/<audio> and applies the effects
├── videodelay.js     Picture delay via canvas overlay (negative audio delay)
├── ambilight.js      Glow around the picture (canvas overlay with a hole)
├── dialog.js         Voice ↔ background: STFT center extraction (content script and AudioWorklet)
├── dialog-worklet.js AudioWorklet around dialog.js
├── background.js     Site settings and default, keyboard shortcuts, toolbar badge, screenshot download
├── _locales/         UI texts (en, de)
├── popup/
│   ├── popup.js      Sliders, tabs, state
│   ├── spectrum.js   Live spectrum and level meter
│   ├── presets.js    Built-in and custom presets
│   ├── tools.js      Loop, frames, seeking, screenshot, video info, shortcut list
│   ├── defaults.js   Default for all sites
│   ├── sidebar.js    Firefox sidebar: timeline, extended limits, slider steps
│   ├── sliderfx.js   Slider extras: drag or turn (ring knob), wheel, value bubble
│   ├── mixer.js      Firefox sidebar: mixer across all tabs
│   └── icons.js      Inline SVG icons
├── options/          Options page: sites, presets, default, backup
└── icons/            SVG (Firefox) and PNG (Chrome) icons
```

## License

[MIT](LICENSE)
