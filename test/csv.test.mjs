// Unit tests for the RFC 4180 CSV parser. No emulator or network needed:
//
//   node --test test/csv.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "../csv.js";

test("parses a simple two-column sheet", () => {
  assert.deepEqual(parseCsv("id,text\na,Walk\nb,Run"), [
    ["id", "text"],
    ["a", "Walk"],
    ["b", "Run"],
  ]);
});

test("keeps commas inside quoted fields", () => {
  assert.deepEqual(parseCsv('a,"dance, swim, bike"'), [["a", "dance, swim, bike"]]);
});

test("unescapes doubled quotes inside a quoted field", () => {
  assert.deepEqual(parseCsv('a,"60-minute ""favorite"" workout"'), [
    ["a", '60-minute "favorite" workout'],
  ]);
});

test("keeps newlines inside quoted fields", () => {
  assert.deepEqual(parseCsv('a,"line one\nline two"\nb,plain'), [
    ["a", "line one\nline two"],
    ["b", "plain"],
  ]);
});

test("treats CRLF as a single row terminator", () => {
  assert.deepEqual(parseCsv("id,text\r\na,Walk\r\n"), [
    ["id", "text"],
    ["a", "Walk"],
  ]);
});

test("drops blank rows and separator-only rows", () => {
  assert.deepEqual(parseCsv("id,text\n\na,Walk\n,\n   ,  \nb,Run\n"), [
    ["id", "text"],
    ["a", "Walk"],
    ["b", "Run"],
  ]);
});

test("handles a final row with no trailing newline", () => {
  assert.deepEqual(parseCsv("a,Walk"), [["a", "Walk"]]);
});

test("preserves empty fields within a row", () => {
  assert.deepEqual(parseCsv("a,,c"), [["a", "", "c"]]);
});

test("strips a UTF-8 BOM", () => {
  assert.deepEqual(parseCsv("\uFEFFid,text\na,Walk"), [
    ["id", "text"],
    ["a", "Walk"],
  ]);
});

test("returns an empty array for empty input", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n\n"), []);
});

test("rejects an unterminated quoted field", () => {
  assert.throws(() => parseCsv('a,"never closed'), /unterminated quoted field/);
});

test("rejects non-string input", () => {
  assert.throws(() => parseCsv(null), TypeError);
});
