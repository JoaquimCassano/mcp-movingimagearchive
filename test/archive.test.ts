import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRsc, toSlug, walk } from "../src/archive.ts";
import { shotRange } from "../src/download.ts";

test("parseRsc handles JSON rows, non-JSON rows and byte-length text rows; walk resolves text refs", () => {
  const text = "Café ✦\nline two"; // multi-byte + newline: length must be counted in bytes
  const payload = `0:["$","div",null,{"synopsis":"$1"}]\n1:T${Buffer.byteLength(text).toString(16)},${text}2:I[123,[],"X"]\n3:{"clips":[]}\n`;
  const rows = parseRsc(payload);
  assert.equal(rows.get("1"), text);
  assert.deepEqual(rows.get("3"), { clips: [] });
  assert.ok(!rows.has("2"));
  assert.equal([...walk(rows)].find((o) => "synopsis" in o)?.synopsis, text);
});

test("toSlug accepts slugs and page URLs", () => {
  assert.equal(toSlug("https://www.movingimagearchive.com/sources/abc-123?clip=x", "sources"), "abc-123");
  assert.equal(toSlug("cats", "collection"), "cats");
  assert.equal(toSlug("https://www.movingimagearchive.com/collection/cats", "collection"), "cats");
});

test("toSlug rejects anything that could escape a URL path or file name", () => {
  for (const bad of ["../etc", "a/b", "a\\b", "", "x y", "%2e%2e"]) assert.throws(() => toSlug(bad, "sources"));
});

test("shotRange spans first start to last end, in either order", () => {
  const shots = [1, 2, 3].map((n) => ({ shotNumber: n, startSeconds: (n - 1) * 10, endSeconds: n * 10 - 1 }));
  assert.deepEqual(shotRange(shots, 2, 3), { start: 10, end: 29 });
  assert.deepEqual(shotRange(shots, 3, 2), { start: 10, end: 29 });
  assert.deepEqual(shotRange(shots, 1, 1), { start: 0, end: 9 });
  assert.throws(() => shotRange(shots, 0, 4));
});
