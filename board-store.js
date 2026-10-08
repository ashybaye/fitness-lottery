// All Firestore reads and writes for the board.
//
// This is the only module that talks to Firestore. It owns card *state* — which cards are
// open and the global daily counter — and applies the content diffs that card-sync.js
// computes from the sheet.
//
// Data model:
//   cards/{sheetId}   -> { id, order, text, status: 'closed'|'opened', openedDate: 'YYYY-MM-DD'|null }
//   meta/dailyCount   -> { date: 'YYYY-MM-DD', count: 0..1 }  (global opens used today)
//   meta/sheetSync    -> { lastSyncedAt: epoch ms, sourceHash: string }

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { assertDiffFitsBatch } from "./card-sync.js";

export const DAILY_LIMIT = 1;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const cardsCol = collection(db, "cards");
const dailyCountRef = doc(db, "meta", "dailyCount");
const sheetSyncRef = doc(db, "meta", "sheetSync");

export function todayStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function subscribeCards(onCards, onError) {
  return onSnapshot(
    cardsCol,
    (snap) => onCards(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    onError
  );
}

export function subscribeDailyCount(onMeta, onError) {
  return onSnapshot(
    dailyCountRef,
    (snap) => onMeta(snap.exists() ? snap.data() : { date: todayStr(), count: 0 }),
    onError
  );
}

export async function readSyncMeta() {
  const snap = await getDoc(sheetSyncRef);
  return snap.exists() ? snap.data() : null;
}

export async function readStoredCards() {
  const snap = await getDocs(cardsCol);
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/**
 * Applies a sheet diff and the sync bookkeeping in one atomic batch, so the board never
 * renders a half-synced deck. Card state (status / openedDate) is never written here.
 *
 * Two visitors syncing at once compute the same diff, so the writes are idempotent.
 *
 * @param {{ creates: object[], updates: object[], deletes: string[] }} diff
 * @param {{ sourceHash: string, now?: number }} options
 */
export async function applyCardDiff(diff, { sourceHash, now = Date.now() }) {
  assertDiffFitsBatch(diff);

  const batch = writeBatch(db);
  diff.creates.forEach((card) => batch.set(doc(db, "cards", card.id), card));
  diff.updates.forEach(({ id, changes }) => batch.update(doc(db, "cards", id), changes));
  diff.deletes.forEach((id) => batch.delete(doc(db, "cards", id)));
  batch.set(sheetSyncRef, { lastSyncedAt: now, sourceHash });

  await batch.commit();
}

/**
 * Opens a card, enforcing the global daily limit inside a transaction so two people
 * tapping at the same moment can't both get through.
 *
 * Throws with a user-facing message when the open isn't allowed.
 */
export async function openCard(cardId) {
  await runTransaction(db, async (tx) => {
    const cardRef = doc(db, "cards", cardId);
    const [cardSnap, metaSnap] = await Promise.all([tx.get(cardRef), tx.get(dailyCountRef)]);

    if (!cardSnap.exists()) throw new Error("Card not found.");
    if (cardSnap.data().status !== "closed") {
      throw new Error("That card has already been opened.");
    }

    const today = todayStr();
    const meta = metaSnap.exists() ? metaSnap.data() : { date: today, count: 0 };
    const currentCount = meta.date === today ? meta.count : 0;

    if (currentCount >= DAILY_LIMIT) {
      throw new Error("Today's card has already been picked. Come back tomorrow!");
    }

    tx.set(dailyCountRef, { date: today, count: currentCount + 1 });
    tx.update(cardRef, { status: "opened", openedDate: today });
  });
}

/** Closes every opened card and clears today's count, for the whole shared board. */
export async function resetBoard() {
  const snap = await getDocs(cardsCol);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    if (d.data().status === "opened") {
      batch.update(d.ref, { status: "closed", openedDate: null });
    }
  });
  batch.set(dailyCountRef, { date: todayStr(), count: 0 });
  await batch.commit();
}
