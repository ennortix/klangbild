// Rules, skipping silence and continue watching: the pure parts in common.js and the
// background script's storage and tab handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground, loadCommon, makeStorage, plain } from "./helpers.mjs";

const AVFX = loadCommon().AVFX;

// ---------- Rules ----------

test("ruleMatches: hosts with subdomains, paths as prefix or glob, ports", () => {
  const cases = [
    ["example.com", "https://example.com/", true],
    ["example.com", "https://www.example.com/a", true],
    ["*.example.com", "https://a.b.example.com/", true],
    ["example.com", "https://notexample.com/", false],
    ["notexample.com", "https://example.com/", false],
    ["Example.COM", "https://example.com/", true],
    ["https://example.com/a", "https://example.com/abc", true],
    ["example.com/podcasts", "https://example.com/podcasts/42", true],
    ["example.com/podcasts", "https://example.com/videos/podcasts", false],
    ["example.com/podcasts/*", "https://example.com/podcasts/", true],
    ["example.com/watch?v=*", "https://example.com/watch?v=dQw4", true],
    ["example.com/watch?v=Ab", "https://example.com/watch?v=ab", false], // paths keep their case
    ["example.com/*/live", "https://example.com/x/y/live", true],
    ["example.com/a.b", "https://example.com/axb", false], // a dot is a dot, not "any character"
    ["example.com/(x)+", "https://example.com/(x)+", true],
    ["localhost:8080/x", "http://localhost:8080/x1", true],
    ["localhost:8080", "http://localhost:9090/", false],
    ["example.com", "file:///C:/example.com", false],
    ["example.com", "not a url", false],
    ["", "https://example.com/", false],
    ["*", "https://example.com/", false],
    ["ex*.com", "https://example.com/", false],
  ];
  for (const [pattern, url, expected] of cases) assert.equal(AVFX.ruleMatches(pattern, url), expected, `${pattern} on ${url}`);
});

test("findRule: the most specific matching rule wins, whatever the order", () => {
  const rules = [
    { pattern: "example.com", speed: 1.25, preset: "" },
    { pattern: "example.com/podcasts/*", speed: 1.5, preset: "" },
    { pattern: "other.org", speed: 2, preset: "" },
  ];
  assert.equal(AVFX.findRule(rules, "https://example.com/podcasts/1").speed, 1.5);
  assert.equal(AVFX.findRule([...rules].reverse(), "https://example.com/podcasts/1").speed, 1.5);
  assert.equal(AVFX.findRule(rules, "https://example.com/news").speed, 1.25);
  assert.equal(AVFX.findRule(rules, "https://elsewhere.net/"), null);
  assert.equal(AVFX.findRule(null, "https://example.com/"), null);
});

test("applyRule: built-in presets keep speed and sync, own presets replace all, the rule's speed last", () => {
  const base = { volume: 150, speed: 1.5, audioDelay: 120, enabled: true };
  const voice = AVFX.applyRule(base, { preset: "builtin:voice", speed: null });
  assert.equal(voice.voice, true);
  assert.equal(voice.volume, 100, "everything else back to neutral");
  assert.deepEqual([voice.speed, voice.audioDelay], [1.5, 120]);

  const user = [{ name: "Mine", settings: { bass: 6, speed: 0.75 } }];
  const mine = AVFX.applyRule(base, { preset: "user:Mine", speed: null }, user);
  assert.deepEqual([mine.bass, mine.speed, mine.audioDelay, mine.volume], [6, 0.75, 0, 100]);

  assert.equal(AVFX.applyRule(base, { preset: "user:Mine", speed: 2 }, user).speed, 2);
  // a deleted preset leaves the settings alone, the speed still applies
  const gone = AVFX.applyRule(base, { preset: "user:Gone", speed: 1.25 }, user);
  assert.deepEqual([gone.volume, gone.speed], [150, 1.25]);
  assert.equal(AVFX.applyRule(null, { preset: "builtin:nope", speed: null }).volume, 100);
  assert.equal(AVFX.applyRule({ enabled: false }, { preset: "builtin:night", speed: null }).enabled, false, "bypass stays");
});

test("sanitizeRules: drops rules without a pattern or an action, clamps the speed", () => {
  const rules = AVFX.sanitizeRules([
    { pattern: "  a.com  ", preset: "builtin:voice", speed: null },
    { pattern: "b.com", preset: "", speed: 99 },
    { pattern: "c.com", preset: "", speed: null }, // does nothing
    { pattern: "", preset: "builtin:voice" },
    { pattern: "d.com", preset: "evil", speed: "2" },
    null,
    "e.com",
  ]);
  assert.deepEqual(plain(rules), [
    { pattern: "a.com", preset: "builtin:voice", speed: null },
    { pattern: "b.com", preset: "", speed: 16 },
  ]);
  assert.deepEqual(plain(AVFX.sanitizeRules({ pattern: "a.com" })), []);
  const many = Array.from({ length: 300 }, (_, i) => ({ pattern: `s${i}.com`, speed: 2 }));
  assert.equal(AVFX.sanitizeRules(many).length, AVFX.MAX_RULES);
});

test("initData: a matching rule is applied on top of the site's settings", async () => {
  const { ctx } = loadBackground(
    makeStorage({
      "site:a.com": { volume: 50, speed: 1.1 },
      rules: [{ pattern: "a.com/talks", preset: "", speed: 1.75 }],
    })
  );
  const r = await ctx.initData("https://a.com/talks/1", 7);
  assert.deepEqual([r.settings.volume, r.settings.speed, r.rule], [50, 1.75, "a.com/talks"]);
  const other = await ctx.initData("https://a.com/home", 7);
  assert.deepEqual([other.settings.speed, other.rule], [1.1, null]);
});

test("rules on single-page sites: entering, switching and leaving a rule sends the tab new settings", async () => {
  const { ctx, sent, updated } = loadBackground(
    makeStorage({
      rules: [
        { pattern: "a.com/watch", preset: "", speed: 1.5 },
        { pattern: "a.com/shorts", preset: "builtin:voice", speed: null },
      ],
    })
  );
  await ctx.initData("https://a.com/", 3); // the page loaded outside any rule
  await updated(3, { url: "https://a.com/feed" });
  assert.equal(sent.length, 0, "no rule before or after");
  await updated(3, { url: "https://a.com/watch?v=1" });
  assert.equal(sent.at(-1).msg.settings.speed, 1.5);
  await updated(3, { url: "https://a.com/watch?v=2" });
  assert.equal(sent.length, 1, "same rule: the user's changes stay");
  await updated(3, { url: "https://a.com/shorts/x" });
  assert.deepEqual([sent.at(-1).msg.settings.voice, sent.at(-1).msg.settings.speed], [true, 1]);
  await updated(3, { url: "https://a.com/feed" });
  assert.deepEqual([sent.length, sent.at(-1).msg.settings.voice], [3, false], "leaving: back to the site's settings");
  await updated(3, { title: "x" });
  assert.equal(sent.length, 3);
});

test("rules on single-page sites: disabled sites get nothing", async () => {
  const { sent, updated } = loadBackground(
    makeStorage({ disabledSites: ["a.com"], rules: [{ pattern: "a.com", preset: "", speed: 2 }] })
  );
  await updated(1, { url: "https://a.com/x" });
  assert.equal(sent.length, 0);
});

// ---------- Skipping silence ----------

// Feeds a sequence of [dB, seconds] in steps of 25 ms, returns the states.
function run(sequence, dt = 0.025) {
  let st = { level: null, quiet: 0, silent: false };
  const out = [];
  for (const [db, seconds] of sequence) {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      st = AVFX.silenceStep(st, db, dt);
      out.push(st);
    }
  }
  return out;
}
const last = (states) => states.at(-1);

test("silenceStep: nothing heard yet is not a pause (start, buffering)", () => {
  assert.equal(last(run([[-Infinity, 2]])).silent, false);
  assert.equal(last(run([[NaN, 2]])).silent, false);
});

test("silenceStep: a pause counts after 0.25 s and ends with the next sound", () => {
  const states = run([[-20, 1], [-70, 0.2]]);
  assert.equal(last(states).silent, false, "0.2 s is too short");
  const pause = run([[-20, 1], [-70, 0.25]]);
  assert.equal(last(pause).silent, true);
  assert.equal(last(run([[-20, 1], [-70, 1], [-22, 0.025]])).silent, false, "speech ends it at once");
  assert.equal(last(run([[-20, 1], [-Infinity, 0.5]])).silent, true, "digital silence too");
});

test("silenceStep: relative to the recording – room noise is a pause, quiet speech isn't", () => {
  assert.equal(last(run([[-22, 2], [-45, 1]])).silent, true, "lecture: noise floor 23 dB under the voice");
  assert.equal(last(run([[-10, 2], [-34, 2]])).silent, false, "quiet speaker after loud music");
  assert.equal(last(run([[-20, 2], [-32, 2]])).silent, false, "a softer passage");
});

test("silenceStep: follows a quieter speaker down, long noisy pauses are skipped for a while", () => {
  // The level sinks to the quieter voice, so its pauses (relative to it) are found.
  assert.equal(last(run([[-12, 2], [-30, 6], [-52, 0.5]])).silent, true);
  const states = run([[-22, 2], [-48, 12]]);
  const skipped = states.slice(80).filter((s) => s.silent).length * 0.025;
  assert.ok(skipped > 4 && skipped < 12, `noisy pause skipped for ${skipped.toFixed(2)} s`);
});

// ---------- Continue watching ----------

test("resumeKey: the same video from other links, other videos stay apart", () => {
  const k = (u) => AVFX.resumeKey(u);
  assert.equal(k("https://v.com/watch?v=1&t=90#c"), k("https://v.com/watch?v=1"));
  assert.equal(k("https://v.com/watch?list=L&v=1"), k("https://v.com/watch?v=1&list=L"), "parameter order");
  assert.notEqual(k("https://v.com/watch?v=1"), k("https://v.com/watch?v=2"));
  assert.equal(k("https://v.com/e?start=30&time_continue=4&timestamp=1"), k("https://v.com/e"));
  assert.equal(k("about:blank"), null);
  assert.equal(k("nope"), null);
});

test("resumeTime: only for the same length, not at the start, end or a page's own start", () => {
  const saved = { t: 600, d: 1800 };
  assert.equal(AVFX.resumeTime(saved, 1800, 0), 598, "a little before, to get back into it");
  assert.equal(AVFX.resumeTime(saved, 1801.5, 0), 598, "MSE durations wobble");
  assert.equal(AVFX.resumeTime(saved, 1810, 0), null, "another video at the same address");
  assert.equal(AVFX.resumeTime(saved, 1800, 42), null, "the page started elsewhere (link with a time)");
  assert.equal(AVFX.resumeTime({ t: 20, d: 1800 }, 1800, 0), null, "barely started");
  assert.equal(AVFX.resumeTime({ t: 1790, d: 1800 }, 1800, 0), null, "practically finished");
  assert.equal(AVFX.resumeTime({ t: 60, d: 100 }, 100, 0), null, "short clips aren't remembered");
  assert.equal(AVFX.resumeTime(null, 1800, 0), null);
  assert.equal(AVFX.resumeTime({ t: 600, d: 1800 }, Infinity, 0), null, "live");
  assert.equal(AVFX.resumeTime({ t: "600", d: 1800 }, 1800, 0), null);
});

const tab = (extra = {}) => ({ tab: { id: 1, url: "https://v.com/", incognito: false, ...extra } });

test("continue watching: saved under a hash, read back, finished videos forgotten", async () => {
  const storage = makeStorage();
  const { ctx } = loadBackground(storage);
  const url = "https://v.com/watch?v=abc&t=5";
  await ctx.resumeMessage({ type: "resume-save", url, time: 612.345, duration: 1800 }, tab());
  const stored = storage.data.resumePositions;
  const [id] = Object.keys(stored);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(stored).includes("v.com"), "no readable address");
  const got = await ctx.resumeMessage({ type: "resume-get", url: "https://v.com/watch?v=abc" }, tab());
  assert.deepEqual([got.t, got.d], [612.3, 1800]);
  await ctx.resumeMessage({ type: "resume-save", url, time: 1795, duration: 1800, done: true }, tab());
  assert.deepEqual(plain(storage.data.resumePositions), {});
});

test("continue watching: nothing from private windows or when switched off", async () => {
  const storage = makeStorage();
  const { ctx } = loadBackground(storage);
  const msg = { type: "resume-save", url: "https://v.com/x", time: 300, duration: 900 };
  assert.equal(await ctx.resumeMessage(msg, tab({ incognito: true })), null);
  assert.equal(storage.data.resumePositions, undefined);
  storage.data.prefs = { resume: false };
  assert.equal(await ctx.resumeMessage(msg, tab()), null);
  assert.equal(await ctx.resumeMessage({ type: "resume-get", url: msg.url }, tab()), null);
  assert.equal(storage.data.resumePositions, undefined);
});

test("continue watching: parallel saves all arrive, the oldest go beyond the limit", async () => {
  const storage = makeStorage();
  const { ctx } = loadBackground(storage);
  const max = ctx.AVFX.RESUME.maxEntries;
  ctx.AVFX.RESUME.maxEntries = 5;
  try {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ctx.resumeMessage({ type: "resume-save", url: `https://v.com/${i}`, time: 100 + i, duration: 900 }, tab())
      )
    );
    const kept = Object.values(storage.data.resumePositions).map((p) => p.t).sort();
    assert.equal(kept.length, 5);
    assert.ok(kept.includes(107), "the newest is kept");
  } finally {
    ctx.AVFX.RESUME.maxEntries = max;
  }
});
