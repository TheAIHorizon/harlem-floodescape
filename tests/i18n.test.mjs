import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const en = flatten(JSON.parse(readFileSync(join(root, "app/i18n/en.json"), "utf8")));
const es = flatten(JSON.parse(readFileSync(join(root, "app/i18n/es.json"), "utf8")));

test("en and es have identical key sets", () => {
  const enKeys = Object.keys(en).sort();
  const esKeys = Object.keys(es).sort();
  const missingInEs = enKeys.filter((k) => !esKeys.includes(k));
  const missingInEn = esKeys.filter((k) => !enKeys.includes(k));
  assert.deepEqual(missingInEs, [], `keys missing in es.json: ${missingInEs}`);
  assert.deepEqual(missingInEn, [], `keys missing in en.json: ${missingInEn}`);
});

test("no empty strings in either locale", () => {
  for (const [locale, dict] of [["en", en], ["es", es]]) {
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, "string", `${locale}:${k} is not a string`);
      assert.ok(v.trim().length > 0, `${locale}:${k} is empty`);
    }
  }
});

test("locales are actually different languages (spot check)", () => {
  assert.notEqual(en["nav.report"], es["nav.report"]);
  assert.notEqual(en["status.DANGER.title"], es["status.DANGER.title"]);
});
