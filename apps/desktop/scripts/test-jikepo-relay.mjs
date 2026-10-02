import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RelayAdapter,
  normalizeConfig,
} = require("../src-tauri/resources/jikepo/src/lib/relay-adapter.js");

const configured = normalizeConfig({
  mode: "openai",
  authToken: "test-token",
  transport: async () => { throw new Error("usage route should not be requested"); },
});
assert.equal(configured.usagePath, "", "usage endpoint must be opt-in");

const calls = [];
const adapter = new RelayAdapter({
  mode: "openai",
  authToken: "test-token",
  transport: async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ object: "list", data: [{ id: "gpt-6.1-sol" }] }),
    };
  },
});
const test = await adapter.testConnection();
assert.equal(test.ok, true);
assert.deepEqual(test.models.data.map((item) => item.id), ["gpt-6.1-sol"]);
const usage = await adapter.usage();
assert.deepEqual(usage, {
  balance: null,
  remaining: null,
  used: null,
  active: null,
  unit: "service",
  source: "openai",
});
assert.equal(calls.length, 1, "optional usage must not trigger /usage");
assert.match(calls[0], /\/models$/);

const htmlAdapter = new RelayAdapter({
  mode: "openai",
  authToken: "test-token",
  transport: async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html; charset=utf-8" },
    json: async () => { throw new SyntaxError("Unexpected token '<'"); },
  }),
});
await assert.rejects(
  () => htmlAdapter.testConnection(),
  (error) => {
    assert.match(error.message, /models/);
    assert.match(error.message, /HTML 页面/);
    assert.doesNotMatch(error.message, /Unexpected token/);
    return true;
  },
);

console.log("jikepo relay validation passed");
