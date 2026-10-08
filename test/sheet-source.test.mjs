// Unit tests for reading cards out of a published Google Sheet. The network is stubbed,
// so this needs neither the emulator nor internet access:
//
//   node --test test/sheet-source.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SheetError,
  fetchChallenges,
  hashChallenges,
  parseChallenges,
} from "../sheet-source.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureCsv = fs.readFileSync(path.join(repoRoot, "challenges.csv"), "utf8");

function stubFetch({ ok = true, status = 200, body = "", error = null } = {}) {
  return async () => {
    if (error) throw error;
    return { ok, status, text: async () => body };
  };
}

test("parses the bundled challenges.csv into 30 ordered cards", () => {
  const cards = parseChallenges(fixtureCsv);

  assert.equal(cards.length, 30);
  assert.deepEqual(cards[0], {
    id: "card-1",
    text: "🏋️ 40-Min Full-Body Strength Workout",
    order: 1,
  });
  assert.deepEqual(
    cards.map((c) => c.id),
    Array.from({ length: 30 }, (_, i) => `card-${i + 1}`)
  );
  assert.deepEqual(
    cards.map((c) => c.order),
    Array.from({ length: 30 }, (_, i) => i + 1)
  );
});

test("round-trips quoted text containing commas", () => {
  const cards = parseChallenges(fixtureCsv);

  assert.equal(
    cards.find((c) => c.id === "card-2").text,
    "💪 30 Pushups, 30 Squats, 30 Reverse Lunges, 2-Min Plank, 30 Jumping Jacks"
  );
});

test("round-trips text containing escaped double quotes", () => {
  const cards = parseChallenges('id,text\nfave,"60-minute ""choose your favorite"" workout"');

  assert.equal(cards[0].text, '60-minute "choose your favorite" workout');
});

test("accepts headers in any order and any casing, with surrounding whitespace", () => {
  const cards = parseChallenges("  Text , ID \nWalk a mile, walk-1 ");

  assert.deepEqual(cards, [{ id: "walk-1", text: "Walk a mile", order: 1 }]);
});

test("ignores extra columns", () => {
  const cards = parseChallenges("id,text,notes\nwalk-1,Walk a mile,added by Sam");

  assert.deepEqual(cards, [{ id: "walk-1", text: "Walk a mile", order: 1 }]);
});

test("skips fully blank rows without affecting order", () => {
  const cards = parseChallenges("id,text\na,First\n\n,\nb,Second\n");

  assert.deepEqual(
    cards.map((c) => [c.id, c.order]),
    [
      ["a", 1],
      ["b", 2],
    ]
  );
});

test("rejects a sheet missing the id column", () => {
  assert.throws(() => parseChallenges("text\nWalk a mile"), {
    name: "SheetError",
    message: /missing a "id" column/,
  });
});

test("rejects a duplicate id and names both rows", () => {
  assert.throws(() => parseChallenges("id,text\na,First\na,Second"), {
    name: "SheetError",
    message: /Row 3: duplicate id "a" \(already used on row 2\)/,
  });
});

test("rejects a row with an id but no text", () => {
  assert.throws(() => parseChallenges("id,text\na,"), {
    name: "SheetError",
    message: /Row 2: the "text" value is empty/,
  });
});

test("rejects a row with text but no id", () => {
  assert.throws(() => parseChallenges("id,text\n,Walk a mile"), {
    name: "SheetError",
    message: /Row 2: the "id" value is empty/,
  });
});

test("rejects ids that Firestore cannot use as document ids", () => {
  for (const [id, expected] of [
    ["a/b", /forward slash/],
    ["..", /reserved id/],
    ["__meta__", /double underscores/],
  ]) {
    assert.throws(() => parseChallenges(`id,text\n${id},Walk a mile`), {
      name: "SheetError",
      message: expected,
    });
  }
});

test("rejects a sheet with a header but no cards", () => {
  assert.throws(() => parseChallenges("id,text\n"), {
    name: "SheetError",
    message: /no cards/,
  });
});

test("fetches and parses a published sheet", async () => {
  const cards = await fetchChallenges(
    "https://example.com/pub?output=csv",
    stubFetch({ body: "id,text\nwalk-1,Walk a mile" })
  );

  assert.deepEqual(cards, [{ id: "walk-1", text: "Walk a mile", order: 1 }]);
});

test("reports an unconfigured sheet URL", async () => {
  await assert.rejects(
    () => fetchChallenges("PASTE_YOUR_PUBLISHED_CSV_URL_HERE", stubFetch()),
    { name: "SheetError", message: /SHEET_CSV_URL in sheet-config.js/ }
  );
});

test("reports a non-OK HTTP response", async () => {
  await assert.rejects(
    () => fetchChallenges("https://example.com/pub", stubFetch({ ok: false, status: 404 })),
    { name: "SheetError", message: /HTTP 404/ }
  );
});

test("wraps a network failure in a SheetError and keeps the cause", async () => {
  const boom = new Error("offline");

  await assert.rejects(
    () => fetchChallenges("https://example.com/pub", stubFetch({ error: boom })),
    (err) => {
      assert.ok(err instanceof SheetError);
      assert.match(err.message, /Could not reach the sheet: offline/);
      assert.equal(err.cause, boom);
      return true;
    }
  );
});

test("hash is stable for identical content and sensitive to any change", () => {
  const cards = parseChallenges(fixtureCsv);

  assert.equal(hashChallenges(cards), hashChallenges(parseChallenges(fixtureCsv)));

  const editedText = cards.map((c, i) => (i === 0 ? { ...c, text: `${c.text}!` } : c));
  assert.notEqual(hashChallenges(cards), hashChallenges(editedText));

  const reordered = [cards[1], cards[0], ...cards.slice(2)].map((c, i) => ({
    ...c,
    order: i + 1,
  }));
  assert.notEqual(hashChallenges(cards), hashChallenges(reordered));
});
