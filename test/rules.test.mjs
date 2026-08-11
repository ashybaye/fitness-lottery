// Tests the core shared-board logic (open transaction + reset + Firestore security
// rules) against the Firestore emulator. Run with the emulator active:
//
//   npx firebase emulators:exec --only firestore "node --test test/rules.test.mjs"
//
// This exercises the same open-transaction and reset logic used in app.js
// (duplicated here against the emulator's modular SDK instance) plus the security
// rules in firestore.rules, to verify:
//   - only 1 card can be opened per day, a 2nd is rejected
//   - opening an already-opened card is rejected (no way to "undo" a single card)
//   - resetting the board closes every card and clears today's count, freeing up
//     a new open
//   - directly tampering with immutable fields (e.g. challenge text) is rejected

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  collection,
  getDocs,
  setDoc,
  runTransaction,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

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

test("security rules reject tampering with immutable challenge text", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1", { text: "Original text" });

  await assertFails(
    updateDoc(doc(db, "cards", "card-1"), { text: "Hacked text" })
  );
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
