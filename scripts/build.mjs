// Builds one unpacked extension per browser: dist/<browser>/ = src/ + that
// browser's manifest. Usage: node scripts/build.mjs [firefox|chrome ...]
import { cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";

const TARGETS = ["firefox", "chrome"];
const root = new URL("..", import.meta.url);
const targets = process.argv.slice(2).length ? process.argv.slice(2) : TARGETS;

for (const target of targets) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown target "${target}" (use ${TARGETS.join(" or ")})`);

  const out = new URL(`dist/${target}/`, root);
  rmSync(out, { recursive: true, force: true });
  cpSync(new URL("src/", root), out, { recursive: true });

  const manifest = JSON.parse(readFileSync(new URL(`manifests/${target}.json`, root), "utf8"));
  // One version number for both browsers, taken from package.json.
  manifest.version = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
  writeFileSync(new URL("manifest.json", out), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`built dist/${target}/`);
}
