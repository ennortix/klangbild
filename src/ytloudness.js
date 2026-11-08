// Runs in YouTube's own page world (content.js can't call the player's methods). Answers
// content.js with the loudness YouTube reports for the video now in the player; YouTube
// plays it at slider × min(1, 10^(-loudnessDb / 20)). The event is dispatched on the
// <video> and handled synchronously, the answer goes back in an attribute on it.
(() => {
  const EVENT = "klangbild-yt-loudness";
  const ATTR = "data-klangbild-loudness";
  document.addEventListener(EVENT, (e) => {
    const el = e.target;
    if (!(el instanceof HTMLMediaElement)) return;
    let db = null;
    try {
      const player = el.closest(".html5-video-player");
      const response = player?.getPlayerResponse?.();
      const id = player?.getVideoData?.()?.video_id;
      const value = response?.playerConfig?.audioConfig?.loudnessDb;
      // only for the video that's actually loaded, not the one before it
      if (id && response?.videoDetails?.videoId === id && Number.isFinite(value)) db = value;
    } catch {}
    if (db === null) el.removeAttribute(ATTR);
    else el.setAttribute(ATTR, String(db));
  }, true);
})();
