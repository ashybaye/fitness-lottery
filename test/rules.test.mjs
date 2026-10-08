// Tests the core shared-board logic (open transaction + reset + sheet sync + Firestore
// security rules) against the Firestore emulator. Run with the emulator active:
//
//   npx firebase emulators:exec --only firestore "node --test test/rules.test.mjs"
//
// This exercises the same open-transaction and reset logic used in board-store.js
// (duplicated here against the emulator's modular SDK instance) plus the security
// rules in firestore.rules, to verify:
//   - only 1 card can be opened per day, a 2nd is rejected
//   - opening an already-opened card is rejected (no way to "undo" a single card)
//   - resetting the board closes every card and clears today's count, freeing up
//     a new open
//   - a sheet sync can change challenge text and order but never card state
//   - opening a card can never smuggle in different challenge text
//   - cards for removed sheet rows can be deleted, and new rows created
//   - the meta/sheetSync bookkeeping doc is shape-checked

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  runTransaction,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { diffCards } from "../card-sync.js";

const DAILY_LIMIT = 1;
const TODAY = "2099-01-01";

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-fitness-lottery",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedCard(db, id, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "cards", id), {
      id,
      order: 1,
      text: "Test challenge",
      status: "closed",
      openedDate: null,
      ...overrides,
    });
  });
}

async function openCard(db, cardId, today = TODAY) {
  const metaRef = doc(db, "meta", "dailyCount");
  await runTransaction(db, async (tx) => {
    const cardRef = doc(db, "cards", cardId);
    const [cardSnap, metaSnap] = await Promise.all([tx.get(cardRef), tx.get(metaRef)]);
    const card = cardSnap.data();
    if (card.status !== "closed") throw new Error("already opened");

    const meta = metaSnap.exists() ? metaSnap.data() : { date: today, count: 0 };
    const currentCount = meta.date === today ? meta.count : 0;
    if (currentCount >= DAILY_LIMIT) throw new Error("daily limit reached");

    tx.set(metaRef, { date: today, count: currentCount + 1 });
    tx.update(cardRef, { status: "opened", openedDate: today });
  });
}

async function resetBoard(db, today = TODAY) {
  const cardsCol = collection(db, "cards");
  const metaRef = doc(db, "meta", "dailyCount");
  const snap = await getDocs(cardsCol);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    if (d.data().status === "opened") {
      batch.update(d.ref, { status: "closed", openedDate: null });
    }
  });
  batch.set(metaRef, { date: today, count: 0 });
  await batch.commit();
}

// Mirrors applyCardDiff in board-store.js.
async function applySheetSync(db, sheetCards, { now = 1, sourceHash = "abc123" } = {}) {
  const snap = await getDocs(collection(db, "cards"));
  const stored = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const diff = diffCards(sheetCards, stored);

  const batch = writeBatch(db);
  diff.creates.forEach((card) => batch.set(doc(db, "cards", card.id), card));
  diff.updates.forEach(({ id, changes }) => batch.update(doc(db, "cards", id), changes));
  diff.deletes.forEach((id) => batch.delete(doc(db, "cards", id)));
  batch.set(doc(db, "meta", "sheetSync"), { lastSyncedAt: now, sourceHash });
  await batch.commit();
}

test("allows opening the single daily card and rejects a second one", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");
  await seedCard(db, "card-2");

  await assertSucceeds(openCard(db, "card-1"));
  await assert.rejects(() => openCard(db, "card-2"), /daily limit reached/);
});

test("cannot open a card that is already opened", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");
  await openCard(db, "card-1");
  await assert.rejects(() => openCard(db, "card-1"), /already opened/);
});

test("resetting the board closes every card and frees a new open", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");
  await seedCard(db, "card-2");

  await openCard(db, "card-1");
  await assert.rejects(() => openCard(db, "card-2"), /daily limit reached/);

  await assertSucceeds(resetBoard(db));

  const cardsSnap = await getDocs(collection(db, "cards"));
  cardsSnap.docs.forEach((d) => {
    assert.equal(d.data().status, "closed");
    assert.equal(d.data().openedDate, null);
  });

  await assertSucceeds(openCard(db, "card-2"));
});

test("a sheet sync can change challenge text without touching card state", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1", { text: "Original text", status: "opened", openedDate: TODAY });

  await assertSucceeds(updateDoc(doc(db, "cards", "card-1"), { text: "Edited in the sheet" }));

  const after = await getDoc(doc(db, "cards", "card-1"));
  assert.equal(after.data().text, "Edited in the sheet");
  assert.equal(after.data().status, "opened");
  assert.equal(after.data().openedDate, TODAY);
});

test("security rules reject changing text and status in the same write", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1", { text: "Original text" });

  await assertFails(
    updateDoc(doc(db, "cards", "card-1"), {
      text: "Hacked text",
      status: "opened",
      openedDate: TODAY,
    })
  );
});

test("security rules reject renaming a card's id", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");

  await assertFails(updateDoc(doc(db, "cards", "card-1"), { id: "card-renamed" }));
});

test("security rules reject a card whose document id doesn't match its id field", async () => {
  const db = testEnv.unauthenticatedContext().firestore();

  await assertFails(
    setDoc(doc(db, "cards", "card-1"), {
      id: "something-else",
      order: 1,
      text: "Walk a mile",
      status: "closed",
      openedDate: null,
    })
  );
});

test("security rules reject creating a card that starts opened", async () => {
  const db = testEnv.unauthenticatedContext().firestore();

  await assertFails(
    setDoc(doc(db, "cards", "card-1"), {
      id: "card-1",
      order: 1,
      text: "Walk a mile",
      status: "opened",
      openedDate: TODAY,
    })
  );
});

test("a card removed from the sheet can be deleted", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1", { status: "opened", openedDate: TODAY });

  await assertSucceeds(deleteDoc(doc(db, "cards", "card-1")));
});

test("syncing a sheet creates, updates, and deletes cards while preserving opens", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "walk", { order: 1, text: "Walk a mile" });
  await seedCard(db, "run", { order: 2, text: "Run a mile", status: "opened", openedDate: TODAY });
  await seedCard(db, "removed", { order: 3, text: "Old challenge" });

  // The sheet now reorders the two survivors, edits one, and adds a new row.
  await assertSucceeds(
    applySheetSync(db, [
      { id: "run", text: "Run a mile", order: 1 },
      { id: "walk", text: "Walk two miles", order: 2 },
      { id: "swim", text: "Swim 20 laps", order: 3 },
    ])
  );

  const snap = await getDocs(collection(db, "cards"));
  const byId = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));

  assert.deepEqual(Object.keys(byId).sort(), ["run", "swim", "walk"]);
  assert.equal(byId.walk.text, "Walk two miles");
  assert.equal(byId.walk.order, 2);
  // The opened card kept its state even though its row moved.
  assert.equal(byId.run.order, 1);
  assert.equal(byId.run.status, "opened");
  assert.equal(byId.run.openedDate, TODAY);
  assert.equal(byId.swim.status, "closed");

  const syncMeta = await getDoc(doc(db, "meta", "sheetSync"));
  assert.equal(syncMeta.data().sourceHash, "abc123");
});

test("security rules shape-check the meta/sheetSync bookkeeping doc", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  const ref = doc(db, "meta", "sheetSync");

  await assertSucceeds(setDoc(ref, { lastSyncedAt: 1700000000000, sourceHash: "abc123" }));
  await assertFails(setDoc(ref, { lastSyncedAt: "soon", sourceHash: "abc123" }));
  await assertFails(setDoc(ref, { lastSyncedAt: 1, sourceHash: 123 }));
  await assertFails(setDoc(ref, { lastSyncedAt: 1, sourceHash: "abc123", extra: true }));
});

test("security rules reject writes to an unknown meta document", async () => {
  const db = testEnv.unauthenticatedContext().firestore();

  await assertFails(setDoc(doc(db, "meta", "somethingElse"), { anything: true }));
});

test("security rules reject an invalid status transition", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");

  await assertSucceeds(
    updateDoc(doc(db, "cards", "card-1"), { status: "opened", openedDate: TODAY })
  );
  // Setting an opened card back to closed while leaving openedDate populated
  // is not a valid transition (reset must clear openedDate to null).
  await assertFails(
    updateDoc(doc(db, "cards", "card-1"), { status: "closed", openedDate: TODAY })
  );
});
