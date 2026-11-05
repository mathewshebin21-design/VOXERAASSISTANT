import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createStudioChecks } from "./studio-checks.mjs";

for (const [name, result] of [
  ["true", true],
  ["false", false],
  ["diagnostic string", "Publish stayed disabled"],
  ["empty string", ""],
  ["undefined", undefined],
  ["null", null],
  ["zero", 0],
]) {
  test(`${name} is classified correctly and failures retain evidence`, async () => {
    const logs = [];
    const failures = [];
    const { step, finish } = createStudioChecks({
      log: (line) => logs.push(line),
      keepFailure: async (...args) => failures.push(args),
    });
    await step("assertion", async () => result);
    const passed = result === true;
    assert.equal(finish(), passed ? 0 : 1);
    assert.equal(failures.length, passed ? 0 : 1);
    assert.match(logs[0], passed ? /^PASS/ : /^FAIL/);
    assert.match(logs.at(-1), passed ? /1\/1 studio checks passed/ : /0\/1 studio checks passed/);
    if (result === "Publish stayed disabled") assert.equal(failures[0][1], result);
  });
}

test("an exception fails once and preserves the original error", async () => {
  const logs = [];
  const failures = [];
  const error = new Error("timed out waiting for Publish");
  const { step, finish } = createStudioChecks({
    log: (line) => logs.push(line),
    keepFailure: async (...args) => failures.push(args),
  });
  await step("publish", async () => { throw error; });
  assert.equal(finish(), 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0][1], error);
  assert.match(logs.at(-1), /0\/1 studio checks passed/);
});

test("a page error still fails an otherwise successful run", async () => {
  const { step, check, finish } = createStudioChecks({ log: () => {}, keepFailure: async () => {} });
  await step("assertion", async () => true);
  check("no page errors", false, "page error");
  assert.equal(finish(), 1);
});

for (const [expression, expected] of [["true", 0], ["false", 1], ['"horizontal overflow 12px"', 1]]) {
  test(`CLI exits ${expected} for ${expression}`, () => {
    const moduleUrl = new URL("./studio-checks.mjs", import.meta.url).href;
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { createStudioChecks } from ${JSON.stringify(moduleUrl)};
      const { step, finish } = createStudioChecks({ keepFailure: async () => {} });
      await step("assertion", async () => ${expression});
      process.exit(finish());
    `], { encoding: "utf8" });
    assert.equal(run.status, expected, run.stdout + run.stderr);
  });
}
