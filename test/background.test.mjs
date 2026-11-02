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
  assert.deepEqual(plain(await ctx.initData("https://a.com/")), { settings: null, disabled: false, rule: null, resume: true });
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
