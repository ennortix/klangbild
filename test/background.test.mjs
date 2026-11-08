import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground, makeStorage, plain } from "./helpers.mjs";

const { ctx } = loadBackground();
const base = ctx.AVFX.sanitize({});
const run = (command, patch = {}) => ctx.settingsCommand(command, { ...base, ...patch })?.[0];

test("volume shortcuts snap to steps of 10 and stay in 0..400", () => {
  assert.equal(run("volume-up", { volume: 400 }).volume, 400);
  assert.equal(run("volume-down", { volume: 0 }).volume, 0);
  assert.equal(run("volume-up", { volume: 395 }).volume, 400);
  assert.equal(run("volume-down", { volume: 5 }).volume, 0);
  assert.equal(run("volume-up", { volume: 100 }).volume, 110);
  assert.equal(run("volume-down", { volume: 95 }).volume, 90);
});

test("speed shortcuts: bounds, reset and no float drift", () => {
  assert.equal(run("speed-up", { speed: 4 }).speed, 4);
  // Values the sidebar put beyond the everyday range are not pulled back.
  assert.equal(run("speed-up", { speed: 8 }).speed, 8);
  assert.equal(run("speed-down", { speed: 8 }).speed, 7.75);
  assert.equal(run("speed-reset", { speed: 8 }).speed, 1);
  assert.equal(run("volume-up", { volume: 600 }).volume, 600);
  assert.equal(run("volume-down", { volume: 600 }).volume, 590);
  assert.equal(run("speed-down", { speed: 0.25 }).speed, 0.25);
  assert.equal(run("speed-up", { speed: 3.9 }).speed, 4);
  assert.equal(run("speed-reset", { speed: 3.95 }).speed, 1);
  assert.equal(run("speed-reset", { speed: 0.25 }).speed, 1);
  let speed = 0.25;
  for (let i = 0; i < 20; i++) speed = run("speed-up", { speed }).speed;
  assert.equal(speed, 4);
  for (let i = 0; i < 20; i++) speed = run("speed-down", { speed }).speed;
  assert.equal(speed, 0.25);
});

test("delay shortcuts stay inside the delay limits", () => {
  assert.equal(run("delay-up", { audioDelay: ctx.AVFX.MAX_DELAY_MS }).audioDelay, ctx.AVFX.MAX_DELAY_MS);
  assert.equal(run("delay-down", { audioDelay: ctx.AVFX.MIN_DELAY_MS }).audioDelay, ctx.AVFX.MIN_DELAY_MS);
});

test("unknown commands do nothing", () => {
  assert.equal(ctx.settingsCommand("nope", base), null);
});

test("badge: extended speeds are shortened to 4 characters", () => {
  const { ctx } = loadBackground();
  const texts = [0.1, 0.15, 4.25, 9.95, 10.25, 12.75, 15.5, 16].map((s) => ctx.badgeSpeed(s));
  assert.deepEqual(texts, ["0,1", "0,15", "4,25", "9,95", "10,3", "12,8", "15,5", "16"]);
});

test("badge: speed and off state fit into 4 characters", () => {
  const { ctx, badges } = loadBackground();
  for (const speed of [0.25, 1, 1.75, 3.95, 4]) ctx.setBadge(1, { speed, enabled: true });
  ctx.setBadge(1, { speed: 2, enabled: false });
  assert.deepEqual(badges, ["0,25", "", "1,75", "3,95", "4", "aus"]);
  for (const text of badges) assert.ok(text.length <= 4, text);
});

test("initData: a disabled host wins over its settings and the defaults", async () => {
  const { ctx } = loadBackground(
    makeStorage({ disabledSites: ["a.com"], "site:a.com": { volume: 50 }, defaults: { volume: 70 } })
  );
  assert.deepEqual(plain(await ctx.initData("https://a.com/x")), { settings: null, disabled: true });
  assert.equal((await ctx.initData("https://b.com/")).settings.volume, 70, "others get the defaults");
  assert.equal((await ctx.initData("https://sub.a.com/")).disabled, false, "subdomains are separate");
});

test("initData: own site settings win over the defaults", async () => {
  const { ctx } = loadBackground(makeStorage({ "site:a.com": { volume: 50 }, defaults: { volume: 70 } }));
  assert.equal((await ctx.initData("https://a.com/")).settings.volume, 50);
});

test("initData: nothing stored", async () => {
  const { ctx } = loadBackground();
  assert.deepEqual(plain(await ctx.initData("https://a.com/")), { settings: null, disabled: false, rule: null, resume: true, ytVolume: false, ytSmooth: true, fade: 1, voiceWatch: false });
});

test("initData: URLs without a host still get the defaults", async () => {
  const { ctx } = loadBackground(makeStorage({ defaults: { volume: 70 } }));
  for (const url of ["file:///C:/x.html", "about:blank", "not a url"]) {
    const r = await ctx.initData(url);
    assert.equal(r.disabled, false, url);
    assert.equal(r.settings.volume, 70, url);
  }
});

test("initData: corrupted disabledSites doesn't throw", async () => {
  const { ctx } = loadBackground(makeStorage({ disabledSites: "a.com" }));
  await assert.doesNotReject(() => ctx.initData("https://a.com/"));
});

// ---------- Crossfader ----------

const fades = (sent) => sent.filter((s) => s.msg.type === "media-fade").map((s) => [s.tabId, s.msg.gain]);

test("crossfader: the slider sets both tabs, a tab that leaves gets full volume back", async () => {
  const { ctx, sent, session } = loadBackground();
  let info = await ctx.setCrossfade({ a: 1, b: 2, position: -40 });
  assert.deepEqual(plain(info.gains), { a: 1, b: 0.6 });
  assert.deepEqual(fades(sent), [[1, 1], [2, 0.6]]);
  assert.equal(session.data.crossfade.position, -40, "kept in storage.session");
  sent.length = 0;
  info = await ctx.setCrossfade({ a: 1, b: 3, position: 50 });
  assert.deepEqual(plain(info.gains), { a: 0.5, b: 1 });
  assert.deepEqual(fades(sent), [[2, 1], [1, 0.5], [3, 1]]);
  assert.equal((await ctx.initData("https://a.com/", 1)).fade, 0.5, "a reloaded page starts faded");
  assert.equal((await ctx.initData("https://a.com/", 9)).fade, 1);
});

test("crossfader: automatic lowers B while A is audible", async () => {
  const { ctx, sent, updated, tabs } = loadBackground();
  tabs[1] = { audible: false };
  await ctx.setCrossfade({ a: 1, b: 2, position: 0, auto: true, duck: 20 });
  sent.length = 0;
  await updated(1, { audible: true }, { id: 1, audible: true });
  await ctx.crossfadeQueued(() => {});
  assert.deepEqual(fades(sent), [[1, 1], [2, 0.2]]);
  assert.equal((await ctx.crossfadeState().then(ctx.crossfadeInfo)).ducking, true);
  sent.length = 0;
  await updated(1, { audible: false }, { id: 1, audible: false });
  await ctx.crossfadeQueued(() => {});
  assert.deepEqual(fades(sent), [[1, 1], [2, 1]]);
  sent.length = 0;
  await updated(2, { audible: true }, { id: 2, audible: true });
  await ctx.crossfadeQueued(() => {});
  assert.deepEqual(fades(sent), [], "B's own sound changes nothing");
});

test("crossfader: a muted A doesn't lower B, a closed tab leaves the crossfader", async () => {
  const { ctx, sent, updated, removed, tabs } = loadBackground();
  tabs[1] = { audible: true, mutedInfo: { muted: true } };
  const info = await ctx.setCrossfade({ a: 1, b: 2, auto: true });
  assert.equal(info.ducking, false);
  await removed(2);
  await ctx.crossfadeQueued(() => {});
  assert.equal((await ctx.crossfadeState()).config.b, null);
  assert.ok(sent.length > 0);
});

test("crossfader: quick switch swaps tab A and B, the slider stays", async () => {
  const { ctx, sent, tabs } = loadBackground();
  let info = await ctx.switchCrossfade();
  assert.deepEqual([info.config.a, info.config.b], [null, null], "no tabs: nothing happens");
  await ctx.setCrossfade({ a: 1, b: 2, position: -30 });
  sent.length = 0;
  info = await ctx.switchCrossfade();
  assert.deepEqual([info.config.a, info.config.b, info.config.position], [2, 1, -30]);
  assert.deepEqual(fades(sent), [[2, 1], [1, 0.7]], "their volumes trade places");
  assert.deepEqual(sent.map((s) => s.msg.time), [0.3, 0.3], "a short fade");
  info = await ctx.switchCrossfade();
  assert.deepEqual([info.config.a, info.config.b], [1, 2]);
  // Automatic: the new A decides whether B is lowered.
  tabs[2] = { audible: true };
  await ctx.setCrossfade({ a: 1, b: 2, position: 0, auto: true, duck: 20 });
  info = await ctx.switchCrossfade();
  assert.equal(info.ducking, true);
  assert.deepEqual(plain(info.gains), { a: 1, b: 0.2 });
  // Only one tab chosen: it moves to the other side.
  await ctx.setCrossfade({ a: 1, b: null });
  info = await ctx.switchCrossfade();
  assert.deepEqual([info.config.a, info.config.b], [null, 1]);
});

test("crossfader: a change from an outdated mixer keeps the current tabs, a closed tab isn't taken", async () => {
  const { ctx, tabs } = loadBackground();
  await ctx.setCrossfade({ a: 1, b: 2 });
  await ctx.switchCrossfade(); // by shortcut, the mixer still shows A = 1
  let info = await ctx.setCrossfade({ position: 40 });
  assert.deepEqual([info.config.a, info.config.b, info.config.position], [2, 1, 40]);
  tabs[3] = null; // closed while the mixer's choice was on its way
  info = await ctx.setCrossfade({ b: 3 });
  assert.deepEqual([info.config.a, info.config.b], [2, null]);
});

test("crossfader: trigger voice lowers B only while A reports a voice", async () => {
  const { ctx, sent, tabs } = loadBackground();
  tabs[1] = { audible: true };
  await ctx.setCrossfade({ a: 1, b: 2, auto: true, duck: 20, trigger: "voice" });
  assert.deepEqual(
    sent.filter((s) => s.msg.type === "voice-watch").map((s) => [s.tabId, s.msg.on]),
    [[1, true]],
    "A listens for voices"
  );
  assert.equal((await ctx.initData("https://a.com/", 1)).voiceWatch, true);
  assert.equal((await ctx.initData("https://a.com/", 2)).voiceWatch, false);
  // no report yet: audible counts
  assert.equal((await ctx.crossfadeState().then(ctx.crossfadeInfo)).ducking, true);
  const report = async (frameId, voice, analysed = true) => {
    ctx.voiceState({ voice, analysed }, { tab: { id: 1 }, frameId });
    await ctx.crossfadeQueued(() => {});
  };
  sent.length = 0;
  await report(0, false); // music in A
  assert.deepEqual(fades(sent), [[1, 1], [2, 1]]);
  sent.length = 0;
  await report(0, true); // someone speaks
  assert.deepEqual(fades(sent), [[1, 1], [2, 0.2]]);
  await report(3, false); // another frame without voice doesn't cancel it
  assert.equal((await ctx.crossfadeState().then(ctx.crossfadeInfo)).ducking, true);
  await report(0, false, false); // nothing analysable (e.g. DRM): audible counts again
  assert.equal((await ctx.crossfadeState().then(ctx.crossfadeInfo)).ducking, false, "frame 3 still says no voice");
  // reports from B are ignored
  ctx.voiceState({ voice: true, analysed: true }, { tab: { id: 2 }, frameId: 0 });
  await ctx.crossfadeQueued(() => {});
  assert.equal((await ctx.crossfadeState().then(ctx.crossfadeInfo)).ducking, false);
  // back to "any sound": the watch stops
  sent.length = 0;
  await ctx.setCrossfade({ a: 1, b: 2, auto: true, duck: 20, trigger: "sound" });
  assert.deepEqual(sent.filter((s) => s.msg.type === "voice-watch").map((s) => [s.tabId, s.msg.on]), [[1, false]]);
  assert.equal((await ctx.crossfadeState().then(ctx.crossfadeInfo)).ducking, true);
});
