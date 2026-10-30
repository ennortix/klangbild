// 24×24 stroke icons. Path prefixes: "F:" filled, "D:" dashed.
const ICONS = {
  // Tabs
  playback: ["M7 4l13 8-13 8z"],
  audio: ["M11 5L6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  video: ["M3 6h12v12H3z", "M15 10l6-3v10l-6-3"],

  // Playback
  speed: ["M3.34 19a10 10 0 1 1 17.32 0", "M12 14l4-4"],
  delay: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M12 7v5l3 2"],
  pitch: ["M9 18V5l12-2v13", "M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M15 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0"],

  // Audio
  volume: ["M11 5L6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
  pan: ["M3 12h18", "M8 7l-5 5 5 5", "M16 7l5 5-5 5"],
  // EQ bands: more waves = higher frequency
  bass: ["M2 12c2.5-6 7.5-6 10 0s7.5 6 10 0"],
  mid: ["M2 12c1.25-5 3.75-5 5 0s3.75 5 5 0 3.75-5 5 0 3.75 5 5 0"],
  treble: [
    "M2 12c.6-4 1.9-4 2.5 0s1.9 4 2.5 0 1.9-4 2.5 0 1.9 4 2.5 0 1.9-4 2.5 0 1.9 4 2.5 0 1.9-4 2.5 0 1.9 4 2.5 0",
  ],
  equalizer: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6"],
  mono: ["M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16", "F:M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5"],
  compressor: ["M4 9h5V4", "M20 9h-5V4", "M4 15h5v5", "M20 15h-5v5"],

  // Video
  color: ["M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"],
  brightness: [
    "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
    "M12 2v2",
    "M12 20v2",
    "M4.93 4.93l1.41 1.41",
    "M17.66 17.66l1.41 1.41",
    "M2 12h2",
    "M20 12h2",
    "M6.34 17.66l-1.41 1.41",
    "M19.07 4.93l-1.41 1.41",
  ],
  contrast: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "F:M12 3a9 9 0 0 1 0 18z"],
  saturate: ["M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z", "F:M6.3 14h11.4a6 6 0 0 1-11.4 0z"],
  hue: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M12 12V3", "M12 12l7.8 4.5", "M12 12l-7.8 4.5"],
  effects: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
  blur: ["F:M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6", "D:M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14", "D:M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20"],
  grayscale: ["M4 4h16v16H4z", "F:M4 4h8v16H4z"],
  sepia: ["M4 5h16v14H4z", "M4 16l5-5 4 4 2-2 5 5", "M15.5 7.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3"],
  invert: ["M4 4h10v10H4z", "F:M10 10h10v10H10z"],
  geometry: ["M4 4h7v7H4z", "M13 13h7v7h-7z", "M17.5 4a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5", "M4 20l3.5-6 3.5 6z"],
  zoom: ["M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14", "M21 21l-5-5", "M11 8v6", "M8 11h6"],
  flipH: ["F:M9 6L3 18h6z", "M15 6l6 12h-6z", "D:M12 2v20"],
  flipV: ["F:M6 9l12-6v6z", "M6 15l12 6v-6z", "D:M2 12h20"],
  rotate: ["M21 12a9 9 0 1 1-3-6.7", "M21 3v6h-6"],

  voice: ["M9 3h6v10a3 3 0 0 1-6 0z", "M5 11a7 7 0 0 0 14 0", "M12 18v3", "M8 21h8"],
  limiter: ["M3 6h18", "M3 15c2-5 3-8 4.5-8S10 16 12 16s2.5-9 4.5-9S19 11 21 15"],
  spectrum: ["M4 20v-6", "M8 20V9", "M12 20V4", "M16 20v-8", "M20 20v-4"],
  sharpen: ["M12 3l9 18H3z", "M12 9v6"],

  // Extras
  extras: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M5 17h4", "M7 15v4"],
  preset: ["M6 3h12v18l-6-4-6 4z"],
  night: ["M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"],
  save: ["M5 3h11l3 3v15H5z", "M8 3v5h7V3", "M8 21v-7h8v7"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 14h10l1-14", "M9 7V4h6v3"],
  tools: ["M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-2.6-2.6", "M3 21l7.6-7.6", "M14.7 6.3L17 4l3 3-2.3 2.3"],
  loop: ["M17 2l4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "M7 22l-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  frameBack: ["F:M11 6l-8 6 8 6z", "M20 6v12", "M16 6v12"],
  frameFwd: ["F:M13 6l8 6-8 6z", "M4 6v12", "M8 6v12"],
  playPause: ["F:M4 5l9 7-9 7z", "M16 5v14", "M20 5v14"],
  camera: ["M3 8h4l2-3h6l2 3h4v12H3z", "M12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7"],
  keyboard: ["M2 6h20v12H2z", "M6 10h.01", "M10 10h.01", "M14 10h.01", "M18 10h.01", "M7 14h10"],

  // Footer
  reset: ["M3 12a9 9 0 1 0 3-6.7", "M3 3v6h6"],
};

function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  for (const raw of ICONS[name] ?? []) {
    const path = document.createElementNS(NS, "path");
    const flag = raw.slice(0, 2);
    path.setAttribute("d", flag === "F:" || flag === "D:" ? raw.slice(2) : raw);
    if (flag === "F:") path.setAttribute("fill", "currentColor");
    if (flag === "D:") path.setAttribute("stroke-dasharray", "2 3");
    svg.append(path);
  }
  return svg;
}
