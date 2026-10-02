import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SeatTransactions } = require("../src-tauri/resources/jikepo/src/lib/seat-transactions.js");

const parent = fs.mkdtempSync(path.join("/private/tmp", "jike-codex-seat-tx-"));
const root = path.join(parent, ".cursor");
fs.mkdirSync(root);
try {
  const tx = new SeatTransactions();
  tx.select(root, { layout: "default" });
  const preview = tx.preview("cursor");
  assert.ok(preview.id);
  assert.ok(preview.files.length > 0);
  const before = tx.verifyPlan(preview.id);
  assert.equal(before.planId, preview.id);
  assert.equal(before.checks.length, preview.files.length);
  assert.equal(before.ok, false);

  const deployed = tx.deploy(preview.id);
  assert.equal(deployed.ok, true);
  assert.ok(deployed.id);
  const afterPreview = tx.preview("cursor");
  const after = tx.verifyPlan(afterPreview.id);
  assert.equal(after.ok, true);
  assert.equal(after.checks.every((check) => check.ok), true);

  const history = tx.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "applied");
  const restored = tx.restore(history[0].id);
  assert.equal(restored.ok, true);
  assert.ok(restored.restored > 0);

  console.log("jikepo transaction regression: ok");
} finally {
  fs.rmSync(parent, { recursive: true, force: true });
}
