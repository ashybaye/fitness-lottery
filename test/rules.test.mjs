// Tests the core shared-board logic (open/close transactions + Firestore security
// rules) against the Firestore emulator. Run with the emulator active:
//
//   npx firebase emulators:exec --only firestore "node --test test/rules.test.mjs"
//
// This exercises the same open/close transaction logic used in app.js (duplicated
// here against the emulator's modular SDK instance) plus the security rules in
// firestore.rules, to verify:
//   - up to 2 cards can be opened per day, a 3rd is rejected
//   - closing a same-day-opened card frees up a slot for another open
//   - directly tampering with immutable fields (e.g. challenge text) is rejected
//   - opening an already-opened card is rejected

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
  setDoc,
  runTransaction,
  updateDoc,
} from "firebase/firestore";

const DAILY_LIMIT = 2;
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

async function closeCard(db, cardId, today = TODAY) {
  const metaRef = doc(db, "meta", "dailyCount");
  await runTransaction(db, async (tx) => {
    const cardRef = doc(db, "cards", cardId);
    const [cardSnap, metaSnap] = await Promise.all([tx.get(cardRef), tx.get(metaRef)]);
    const card = cardSnap.data();
    if (card.status !== "opened" || card.openedDate !== today) {
      throw new Error("cannot close");
    }
    const meta = metaSnap.exists() ? metaSnap.data() : { date: today, count: 0 };
    const currentCount = meta.date === today ? meta.count : 0;

    tx.set(metaRef, { date: today, count: Math.max(0, currentCount - 1) });
    tx.update(cardRef, { status: "closed", openedDate: null });
  });
}

test("allows opening up to the daily limit and rejects the next one", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");
  await seedCard(db, "card-2");
  await seedCard(db, "card-3");

  await assertSucceeds(openCard(db, "card-1"));
  await assertSucceeds(openCard(db, "card-2"));
  await assert.rejects(() => openCard(db, "card-3"), /daily limit reached/);
});

test("closing a same-day card frees a slot for another open", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");
  await seedCard(db, "card-2");
  await seedCard(db, "card-3");

  await openCard(db, "card-1");
  await openCard(db, "card-2");
  await assert.rejects(() => openCard(db, "card-3"));

  await assertSucceeds(closeCard(db, "card-1"));
  await assertSucceeds(openCard(db, "card-3"));
});

test("cannot open a card that is already opened", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await seedCard(db, "card-1");
  await openCard(db, "card-1");
  await assert.rejects(() => openCard(db, "card-1"), /already opened/);
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

  // Directly setting status to 'opened' without going through the transaction
  // shape (still uses updateDoc which keeps other fields, but let's simulate a
  // bogus direct opened->opened no-op style write that isn't a real transition).
  await assertSucceeds(
    updateDoc(doc(db, "cards", "card-1"), { status: "opened", openedDate: TODAY })
  );
  // Once opened, going straight to some invalid state should fail.
  await assertFails(
    updateDoc(doc(db, "cards", "card-1"), { status: "closed", openedDate: TODAY })
  );
});
