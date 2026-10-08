// Unit tests for the sheet → Firestore reconciliation. Pure logic, no Firebase:
//
//   node --test test/card-sync.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BATCH_WRITES,
  assertDiffFitsBatch,
  countDiffWrites,
  diffCards,
  isDiffEmpty,
  isSyncDue,
} from "../card-sync.js";

function sheetCard(id, text, order) {
  return { id, text, order };
}

function storedCard(id, text, order, overrides = {}) {
  return { id, text, order, status: "closed", openedDate: null, ...overrides };
}

test("creates every card when Firestore is empty", () => {
  const diff = diffCards([sheetCard("a", "Walk", 1), sheetCard("b", "Run", 2)], []);

  assert.deepEqual(diff.creates, [
    { id: "a", order: 1, text: "Walk", status: "closed", openedDate: null },
    { id: "b", order: 2, text: "Run", status: "closed", openedDate: null },
  ]);
  assert.deepEqual(diff.updates, []);
  assert.deepEqual(diff.deletes, []);
});

test("is a no-op when the sheet and Firestore already agree", () => {
  const diff = diffCards(
    [sheetCard("a", "Walk", 1), sheetCard("b", "Run", 2)],
    [storedCard("a", "Walk", 1), storedCard("b", "Run", 2, { status: "opened", openedDate: "2099-01-01" })]
  );

  assert.ok(isDiffEmpty(diff));
  assert.equal(countDiffWrites(diff), 0);
});

test("updates only the fields that changed, never card state", () => {
  const diff = diffCards(
    [sheetCard("a", "Walk two miles", 1)],
    [storedCard("a", "Walk a mile", 1, { status: "opened", openedDate: "2099-01-01" })]
  );

  assert.deepEqual(diff.updates, [{ id: "a", changes: { text: "Walk two miles" } }]);
  assert.deepEqual(diff.creates, []);
  assert.deepEqual(diff.deletes, []);
});

test("reordering rows updates order while opened state stays with the id", () => {
  const diff = diffCards(
    [sheetCard("b", "Run", 1), sheetCard("a", "Walk", 2)],
    [
      storedCard("a", "Walk", 1, { status: "opened", openedDate: "2099-01-01" }),
      storedCard("b", "Run", 2),
    ]
  );

  assert.deepEqual(diff.updates, [
    { id: "b", changes: { order: 1 } },
    { id: "a", changes: { order: 2 } },
  ]);
  // No create or delete means card "a" keeps its opened state.
  assert.deepEqual(diff.creates, []);
  assert.deepEqual(diff.deletes, []);
});

test("inserting a row creates the new card and renumbers the rest", () => {
  const diff = diffCards(
    [sheetCard("a", "Walk", 1), sheetCard("c", "Swim", 2), sheetCard("b", "Run", 3)],
    [storedCard("a", "Walk", 1), storedCard("b", "Run", 2)]
  );

  assert.deepEqual(diff.creates, [
    { id: "c", order: 2, text: "Swim", status: "closed", openedDate: null },
  ]);
  assert.deepEqual(diff.updates, [{ id: "b", changes: { order: 3 } }]);
  assert.deepEqual(diff.deletes, []);
});

test("deletes a card whose row was removed, even if it was opened", () => {
  const diff = diffCards(
    [sheetCard("a", "Walk", 1)],
    [
      storedCard("a", "Walk", 1),
      storedCard("b", "Run", 2, { status: "opened", openedDate: "2099-01-01" }),
    ]
  );

  assert.deepEqual(diff.deletes, ["b"]);
  assert.deepEqual(diff.creates, []);
  assert.deepEqual(diff.updates, []);
});

test("renaming an id is a delete plus a create", () => {
  const diff = diffCards([sheetCard("a2", "Walk", 1)], [storedCard("a", "Walk", 1)]);

  assert.deepEqual(diff.deletes, ["a"]);
  assert.deepEqual(diff.creates, [
    { id: "a2", order: 1, text: "Walk", status: "closed", openedDate: null },
  ]);
});

test("an empty sheet list clears the board", () => {
  const diff = diffCards([], [storedCard("a", "Walk", 1), storedCard("b", "Run", 2)]);

  assert.deepEqual(diff.deletes, ["a", "b"]);
});

test("accepts a diff that exactly fills the batch limit", () => {
  const creates = Array.from({ length: MAX_BATCH_WRITES - 1 }, (_, i) =>
    sheetCard(`card-${i}`, "Walk", i + 1)
  );

  assert.doesNotThrow(() => assertDiffFitsBatch(diffCards(creates, [])));
});

test("rejects a diff one write past the batch limit", () => {
  const creates = Array.from({ length: MAX_BATCH_WRITES }, (_, i) =>
    sheetCard(`card-${i}`, "Walk", i + 1)
  );

  assert.throws(() => assertDiffFitsBatch(diffCards(creates, [])), /batch limit/);
});

test("syncs when there is no previous sync record", () => {
  assert.equal(isSyncDue(null, { now: 1000, cooldownMs: 500 }), true);
  assert.equal(isSyncDue({}, { now: 1000, cooldownMs: 500 }), true);
  assert.equal(isSyncDue({ lastSyncedAt: "nope" }, { now: 1000, cooldownMs: 500 }), true);
});

test("skips a sync inside the cooldown window and resumes at its edge", () => {
  assert.equal(isSyncDue({ lastSyncedAt: 1000 }, { now: 1400, cooldownMs: 500 }), false);
  assert.equal(isSyncDue({ lastSyncedAt: 1000 }, { now: 1500, cooldownMs: 500 }), true);
});

test("syncs when the stored timestamp is in the future", () => {
  assert.equal(isSyncDue({ lastSyncedAt: 9999 }, { now: 1000, cooldownMs: 500 }), true);
});
