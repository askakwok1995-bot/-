import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const buildScriptPath = path.resolve(process.cwd(), "scripts/build-pages.js");

test("build-pages 会复制 demo 工作台依赖模块", () => {
  const source = fs.readFileSync(buildScriptPath, "utf8");

  assert.match(source, /"demo-workspace\.js"/);
  assert.match(source, /"workspace-ui\.js"/);
});
