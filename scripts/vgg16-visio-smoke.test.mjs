import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("VGG16 Visio smoke sends the Unicode Figure Plan to the Worker as UTF-8", async () => {
  const script = await readFile(new URL("./vgg16-visio-smoke.ps1", import.meta.url), "utf8");

  assert.match(script, /\$OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(script, /\[Console\]::InputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(script, /\[Console\]::OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
});
