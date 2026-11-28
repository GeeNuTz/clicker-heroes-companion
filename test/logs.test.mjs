import test from "node:test";
import assert from "node:assert/strict";
import { parseLog, parseAscensionCsv, parseTranscensionCsv, classifyClipboard, toNumber } from "../src/logs.mjs";

test("numbers with suffixes and thousands separators", () => {
  assert.equal(toNumber("1.23K"), 1230);
  assert.equal(toNumber("4.5M"), 4_500_000);
  assert.equal(toNumber("2B"), 2e9);
  assert.equal(toNumber("1,234"), 1234);
  assert.ok(Number.isNaN(toNumber("abc")));
});

test("the shape our old parser accepted still parses", () => {
  const rows = parseAscensionCsv("1, 00:12:34, 130, 5\n2, 00:20:00, 240, 12.5");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { n: 1, duration: "00:12:34", hze: 130, hs: 5 });
});

test("a real export with a header block and extra columns parses", () => {
  const csv = [
    "Ascensions #, Time, Zone, Hero Souls, TP",
    "1; 01:02:03; 130; 1.23K; 2",
    "2; 00:45:00; 260; 4.5M; 3",
  ].join("\n");
  const rows = parseLog(csv);
  assert.equal(rows.length, 2, "header must be skipped, both rows kept");
  assert.equal(rows[0].hs, 1230);
  assert.equal(rows[1].hze, 260);
});

test("tab separated rows and a BOM parse", () => {
  const rows = parseAscensionCsv("\uFEFF1\t00:10:00\t150\t900");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hze, 150);
});

test("transcension rows keep the ascension count", () => {
  const rows = parseTranscensionCsv("1, 02:00:00, 320, 1.5M, 7");
  assert.equal(rows[0].ascensions, 7);
});

test("clipboard blobs are classified by their header, not the first line only", () => {
  assert.equal(classifyClipboard("Transcensions #\n1, ..."), "transcensionLog");
  assert.equal(classifyClipboard("Ascensions #\n1, ..."), "ascensionLog");
  assert.equal(classifyClipboard("hello"), null);
});

test("garbage does not produce rows", () => {
  assert.deepEqual(parseLog("Clicker Heroes\nsave loaded"), []);
});
