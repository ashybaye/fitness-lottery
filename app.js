// 30-Day Fitness Challenge Deck — shared board logic.
//
// Data model in Firestore:
//   cards/{cardId}      -> { id, order, text, status: 'closed'|'opened', openedDate: 'YYYY-MM-DD'|null }
//   meta/dailyCount     -> { date: 'YYYY-MM-DD', count: 0..2 }  (global opens used today)
//
// The daily global limit (max 2 opens/day across all users) is enforced inside a
// Firestore transaction that reads+writes both the target card and the meta/dailyCount
// doc atomically, so two users opening cards at the same moment can't both sneak past
// the limit.

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const CHALLENGES = [
  "🧘 40-minute mobility workout",
  "💪 10 × 3 push-ups + 20-minute walk",
  "🚶 1-hour walk with a friend",
  "🧘 40-minute yoga session",
  "🏋️ 30-minute full-body calisthenics",
  "🚶 45-minute brisk walk",
  "💪 10 × 3 squats + 10 × 3 lunges",
  "🧘 30-minute flexibility + mobility routine",
  "🏃 30-minute walk/jog intervals",
  "💪 10 × 3 push-ups + 10 × 3 squats + 10 × 3 sit-ups",
  "🧘 45-minute yoga flow",
  "🚶 60-minute outdoor walk",
  "🏋️ 40-minute calisthenics workout",
  "🧘 30-minute hips + hamstrings mobility",
  "🏃 30-minute cardio workout of your choice",
  "💪 10 × 3 push-ups + 10 × 3 lunges per leg",
  "🚶 45-minute walk with a friend",
  "🧘 40-minute full-body yoga",
  "🏋️ 30-minute bodyweight circuit",
  "🚶 60-minute nature walk/hike",
  "💪 100 total squats — break them into sets",
  "🧘 40-minute flexibility workout",
  "🏃 30-minute cardio + 10-minute stretch",
  "💪 10 × 3 push-ups + 10 × 3 squats + 10 × 3 lunges",
  "🧘 45-minute yoga + mobility",
  "🚶 60-minute walk — no phone except for safety/photos",
  "🏋️ 40-minute full-body calisthenics",
  "💃 45-minute fun movement — dance, swim, bike, etc.",
  "🧘 30-minute deep stretching + 20-minute walk",
  '🏆 60-minute "choose your favorite" workout',
];

const DAILY_LIMIT = 2;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const cardsCol = collection(db, "cards");
const metaDocRef = doc(db, "meta", "dailyCount");

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status-line");

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("visible"), 2200);
}

async function seedIfEmpty() {
  const snap = await getDocs(cardsCol);
  if (!snap.empty) return;

  const batch = writeBatch(db);
  CHALLENGES.forEach((text, i) => {
    const id = `card-${i + 1}`;
    batch.set(doc(db, "cards", id), {
      id,
      order: i + 1,
      text,
      status: "closed",
      openedDate: null,
    });
  });
  await batch.commit();
}

async function openCard(cardId) {
  try {
    await runTransaction(db, async (tx) => {
      const cardRef = doc(db, "cards", cardId);
      const [cardSnap, metaSnap] = await Promise.all([
        tx.get(cardRef),
        tx.get(metaDocRef),
      ]);

      if (!cardSnap.exists()) throw new Error("Card not found.");
      const card = cardSnap.data();
      if (card.status !== "closed") {
        throw new Error("That card has already been opened.");
      }

      const today = todayStr();
      const meta = metaSnap.exists() ? metaSnap.data() : { date: today, count: 0 };
      const currentCount = meta.date === today ? meta.count : 0;

      if (currentCount >= DAILY_LIMIT) {
        throw new Error("The daily limit of 2 cards has been reached. Come back tomorrow!");
      }

      tx.set(metaDocRef, { date: today, count: currentCount + 1 });
      tx.update(cardRef, { status: "opened", openedDate: today });
    });
  } catch (err) {
    showToast(err.message || "Could not open card.");
  }
}

async function closeCard(cardId) {
  try {
    await runTransaction(db, async (tx) => {
      const cardRef = doc(db, "cards", cardId);
      const [cardSnap, metaSnap] = await Promise.all([
        tx.get(cardRef),
        tx.get(metaDocRef),
      ]);

      if (!cardSnap.exists()) throw new Error("Card not found.");
      const card = cardSnap.data();
      const today = todayStr();

      if (card.status !== "opened" || card.openedDate !== today) {
        throw new Error("Only a card opened earlier today can be closed again.");
      }

      const meta = metaSnap.exists() ? metaSnap.data() : { date: today, count: 0 };
      const currentCount = meta.date === today ? meta.count : 0;

      tx.set(metaDocRef, { date: today, count: Math.max(0, currentCount - 1) });
      tx.update(cardRef, { status: "closed", openedDate: null });
    });
  } catch (err) {
    showToast(err.message || "Could not close card.");
  }
}

function renderBoard(cards, remainingToday) {
  boardEl.innerHTML = "";
  cards
    .sort((a, b) => a.order - b.order)
    .forEach((card) => {
      const today = todayStr();
      const openedToday = card.status === "opened" && card.openedDate === today;
      const isOpen = card.status === "opened";

      const cardEl = document.createElement("div");
      cardEl.className = "card" + (isOpen ? " is-open" : "");

      const inner = document.createElement("div");
      inner.className = "card-inner";

      const back = document.createElement("div");
      back.className = "card-face card-back" + (remainingToday <= 0 && !isOpen ? " disabled" : "");
      back.innerHTML = `🃏<span class="card-number">#${card.order}</span>`;
      if (!isOpen) {
        back.addEventListener("click", () => {
          if (remainingToday <= 0) {
            showToast("No opens left today. Come back tomorrow!");
            return;
          }
          openCard(card.id);
        });
      }

      const front = document.createElement("div");
      front.className = "card-face card-front";
      const textEl = document.createElement("div");
      textEl.className = "challenge-text";
      textEl.textContent = card.text;
      front.appendChild(textEl);

      if (openedToday) {
        const closeBtn = document.createElement("button");
        closeBtn.className = "close-btn";
        closeBtn.type = "button";
        closeBtn.textContent = "Close & pick another";
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeCard(card.id);
        });
        front.appendChild(closeBtn);
      }

      inner.appendChild(back);
      inner.appendChild(front);
      cardEl.appendChild(inner);
      boardEl.appendChild(cardEl);
    });
}

function renderStatus(remainingToday) {
  if (remainingToday <= 0) {
    statusEl.textContent = "🎉 Both challenges for today are picked. Come back tomorrow!";
    statusEl.classList.add("limit-reached");
  } else {
    const word = remainingToday === 1 ? "card" : "cards";
    statusEl.textContent = `You can open ${remainingToday} more ${word} today.`;
    statusEl.classList.remove("limit-reached");
  }
}

let latestCards = [];
let latestMeta = null;

function rerender() {
  const today = todayStr();
  const usedToday = latestMeta && latestMeta.date === today ? latestMeta.count : 0;
  const remainingToday = Math.max(0, DAILY_LIMIT - usedToday);
  renderBoard(latestCards, remainingToday);
  renderStatus(remainingToday);
}

async function init() {
  try {
    await seedIfEmpty();
  } catch (err) {
    console.error("Seeding failed:", err);
  }

  onSnapshot(
    cardsCol,
    (cardsSnap) => {
      latestCards = cardsSnap.docs.map((d) => d.data());
      rerender();
    },
    (err) => {
      console.error(err);
      statusEl.textContent =
        "Could not load the board. Check firebase-config.js and your Firestore setup.";
    }
  );

  onSnapshot(
    metaDocRef,
    (metaSnap) => {
      latestMeta = metaSnap.exists() ? metaSnap.data() : { date: todayStr(), count: 0 };
      rerender();
    },
    (err) => console.error(err)
  );
}

init();
