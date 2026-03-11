import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("index.html includes privacy hints for product, hospital, and import entry points", () => {
  const source = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

  assert.match(source, /产品名称建议优先使用代号维护/u);
  assert.match(source, /涉及医院名称时，建议使用代号输入/u);
  assert.match(source, /导入表格中的“产品\/规格”“医院”列建议使用代号输入/u);
  assert.match(source, /产品代号 P-001/u);
  assert.match(source, /医院代号 H-001/u);
});

test("records import template reminds users to use code names", () => {
  const source = fs.readFileSync(new URL("../records.js", import.meta.url), "utf8");

  assert.match(source, /建议使用代号并与产品配置一致/u);
  assert.match(source, /建议使用代号，避免填写真实全称/u);
  assert.match(source, /产品代号 P-001/u);
  assert.match(source, /医院代号 H-001/u);
});
