import { test } from "node:test";
import assert from "node:assert/strict";
import { DE, jsonFile, loadCommon, loadOptions, makeStorage } from "./helpers.mjs";

async function importInto(stored, backup) {
  const storage = makeStorage(stored);
  const { ctx, nodes } = loadOptions(storage);
  await ctx.importBackup(jsonFile(backup));
  return { data: storage.data, status: nodes.backupStatus.textContent };
}

const siteKeys = (data) => Object.keys(data).filter((k) => k.startsWith("site:"));

test("import: broken JSON, null, arrays and foreign files are rejected", async () => {
  for (const content of ["{", "null", "[]", '"klangbild"', JSON.stringify({ app: "other" })]) {
    const { data, status } = await importInto({ "site:x.com": { volume: 50 } }, content);
    assert.equal(status, DE.importFailed.message, content);
    assert.deepEqual(Object.keys(data), ["site:x.com"], content);
  }
});

test("import: sites that aren't an object create no entries", async () => {
  for (const sites of [[{ volume: 50 }], "abc", 5, null, true]) {
    const { data } = await importInto({}, { app: "klangbild", sites });
    assert.deepEqual(siteKeys(data), [], JSON.stringify(sites));
  }
});

test("import: site entries whose values aren't objects are skipped", async () => {
  const { data, status } = await importInto({}, { app: "klangbild", sites: { "a.com": { volume: 50 }, "b.com": "x", "c.com": [] } });
  assert.deepEqual(siteKeys(data), ["site:a.com"]);
  assert.equal(status, DE.importDone.message.replace("$1", "1").replace("$2", "0"));
});

test("import: site values are sanitized", async () => {
  const { data } = await importInto({}, { app: "klangbild", sites: { "a.com": { volume: 9999, evil: 1, temperature: 1000 } } });
  assert.equal(data["site:a.com"].volume, 800, "hard limit (the sidebar reaches it)");
  assert.equal(data["site:a.com"].temperature, 100);
  assert.equal("evil" in data["site:a.com"], false);
});

test("import: the same preset name twice ends up once, the later one wins", async () => {
  const { data } = await importInto(
    { presets: [{ name: "A", settings: {} }] },
    { app: "klangbild", presets: [{ name: "B", settings: { volume: 10 } }, { name: " B ", settings: { volume: 20 } }] }
  );
  assert.deepEqual(data.presets.map((p) => p.name), ["A", "B"]);
  assert.equal(data.presets[1].settings.volume, 20);
});

test("import: names that collide after shortening to 40 characters", async () => {
  const long = "x".repeat(40);
  const { data } = await importInto({}, { app: "klangbild", presets: [{ name: long + "1" }, { name: long + "2" }] });
  assert.deepEqual(data.presets.map((p) => p.name), [long]);
});

test("import: an imported preset replaces a stored one of the same name", async () => {
  const { data } = await importInto(
    { presets: [{ name: "A", settings: { volume: 10 } }, { name: "B", settings: {} }] },
    { app: "klangbild", presets: [{ name: "A", settings: { volume: 30 } }] }
  );
  assert.deepEqual(data.presets.map((p) => p.name), ["B", "A"]);
  assert.equal(data.presets[1].settings.volume, 30);
});

test("import: presets without a usable name are skipped", async () => {
  const { data } = await importInto({}, { app: "klangbild", presets: [{ name: "   " }, { name: 5 }, null, "x", { settings: {} }] });
  assert.equal(data.presets, undefined);
});

test("import: presets and defaults never store `enabled`", async () => {
  const { data } = await importInto({}, { app: "klangbild", presets: [{ name: "P", settings: { enabled: false } }], defaults: { enabled: false } });
  assert.equal("enabled" in data.presets[0].settings, false);
  assert.equal("enabled" in data.defaults, false);
});

test("import: defaults that aren't an object are ignored", async () => {
  for (const defaults of [true, 1, "x", [], null]) {
    const { data } = await importInto({}, { app: "klangbild", defaults });
    assert.equal(data.defaults, undefined, JSON.stringify(defaults));
  }
});

test("import: disabled hosts are merged without duplicates or junk", async () => {
  const { data } = await importInto({ disabledSites: ["a.com"] }, { app: "klangbild", disabled: ["a.com", "b.com", "b.com", 5, "", null] });
  assert.deepEqual(data.disabledSites, ["a.com", "b.com"]);
});

test("export → import keeps everything", async () => {
  const { AVFX } = loadCommon();
  const storage = makeStorage({
    "site:a.com": AVFX.sanitize({ volume: 150, colorVision: "tritan" }),
    presets: [{ name: "P", settings: { gamma: 1.5 } }],
    defaults: { reverb: 30 },
    disabledSites: ["z.com"],
  });
  const { ctx } = loadOptions(storage);
  let json;
  ctx.URL = { createObjectURL: (blob) => ((json = blob.text), "blob:x"), revokeObjectURL() {} };
  ctx.setTimeout = () => {}; // the 60 s revoke timer would keep the test run alive
  ctx.Blob = class {
    constructor(parts) {
      this.text = parts.join("");
    }
  };
  await ctx.exportBackup();

  const { data } = await importInto({}, json);
  assert.equal(data["site:a.com"].volume, 150);
  assert.equal(data["site:a.com"].colorVision, "tritan");
  assert.equal(data.presets[0].settings.gamma, 1.5);
  assert.equal(data.defaults.reverb, 30);
  assert.deepEqual(data.disabledSites, ["z.com"]);
});
