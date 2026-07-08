import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// mock localStorage
function makeMockStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    _raw: m,
  };
}

globalThis.localStorage = makeMockStorage();
const { loadKey, saveKey, wipeAll, removeKey } = await import("../app/js/storage.js");

beforeEach(() => {
  globalThis.localStorage = makeMockStorage();
});

test("save and load round-trips JSON", () => {
  assert.equal(saveKey("plan", { a: 1, b: [2, 3] }), true);
  assert.deepEqual(loadKey("plan", null), { a: 1, b: [2, 3] });
});

test("missing key returns fallback", () => {
  assert.equal(loadKey("nope", "fb"), "fb");
});

test("corrupted JSON returns fallback, does not throw", () => {
  globalThis.localStorage.setItem("hfe.v1.bad", "{not json!!");
  assert.equal(loadKey("bad", "safe"), "safe");
});

test("quota error returns false, does not throw", () => {
  globalThis.localStorage.setItem = () => {
    throw new DOMException("quota");
  };
  assert.equal(saveKey("x", 1), false);
});

test("wipeAll removes only hfe.v1.* keys", () => {
  saveKey("mine", 1);
  globalThis.localStorage.setItem("other.app", "keep");
  assert.equal(wipeAll(), true);
  assert.equal(loadKey("mine", "gone"), "gone");
  assert.equal(globalThis.localStorage.getItem("other.app"), "keep");
});

test("removeKey deletes a single key", () => {
  saveKey("a", 1);
  removeKey("a");
  assert.equal(loadKey("a", null), null);
});
