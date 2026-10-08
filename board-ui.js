// Everything that touches the DOM: rendering the board, the zoom modal, the toast, and
// the sheet-sync notice. This module knows nothing about Firestore or Google Sheets —
// it takes plain card objects and calls back when the user acts.

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status-line");
const resetBtn = document.getElementById("reset-btn");
const noticeEl = document.getElementById("sync-notice");
const zoomOverlay = document.getElementById("zoom-overlay");
const zoomNumberEl = document.getElementById("zoom-number");
const zoomTextEl = document.getElementById("zoom-text");
const zoomGoBtn = document.getElementById("zoom-lets-go-btn");

export function showToast(message) {
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

/** A persistent banner for sheet problems — the board still works, it's just stale. */
export function showSyncNotice(message) {
  noticeEl.textContent = message;
  noticeEl.hidden = false;
}

function openZoom(card) {
  zoomNumberEl.textContent = `Card #${card.order}`;
  zoomTextEl.textContent = card.text;
  zoomOverlay.classList.add("visible");
  zoomOverlay.setAttribute("aria-hidden", "false");
}

function closeZoom() {
  zoomOverlay.classList.remove("visible");
  zoomOverlay.setAttribute("aria-hidden", "true");
}

zoomGoBtn.addEventListener("click", () => {
  closeZoom();
  showToast("Let's go! You've got this. 🔥");
});

zoomOverlay.addEventListener("click", (e) => {
  if (e.target === zoomOverlay) closeZoom();
});

export function bindResetButton(handler) {
  resetBtn.addEventListener("click", handler);
}

/** The board can be any size now, so the confirmation names the real card count. */
export function confirmReset(totalCards) {
  return window.confirm(
    `Reset the entire shared board? This closes all ${totalCards} cards for everyone and ` +
      "clears today's opens. This cannot be undone."
  );
}

/**
 * @param {{ id: string, order: number, text: string, status: string }[]} cards
 * @param {{ remainingToday: number, onOpen: (card: object) => Promise<boolean> }} options
 */
export function renderBoard(cards, { remainingToday, onOpen }) {
  boardEl.innerHTML = "";

  [...cards]
    .sort((a, b) => a.order - b.order)
    .forEach((card) => {
      const isOpen = card.status === "opened";

      const cardEl = document.createElement("div");
      cardEl.className = "card" + (isOpen ? " is-open" : "");

      const inner = document.createElement("div");
      inner.className = "card-inner";

      const back = document.createElement("div");
      back.className =
        "card-face card-back" + (remainingToday <= 0 && !isOpen ? " disabled" : "");
      back.innerHTML = `<span class="card-number">${card.order}</span>`;
      if (!isOpen) {
        back.addEventListener("click", async () => {
          if (remainingToday <= 0) {
            showToast("No opens left today. Come back tomorrow!");
            return;
          }
          const opened = await onOpen(card);
          if (opened) openZoom(card);
        });
      }

      const front = document.createElement("div");
      front.className = "card-face card-front";
      const textEl = document.createElement("div");
      textEl.className = "challenge-text";
      textEl.textContent = card.text;
      front.appendChild(textEl);

      if (isOpen) {
        front.addEventListener("click", () => openZoom(card));
      }

      inner.appendChild(back);
      inner.appendChild(front);
      cardEl.appendChild(inner);
      boardEl.appendChild(cardEl);
    });
}

export function renderStatus({ remainingToday, cards }) {
  if (cards.length === 0) {
    statusEl.textContent = "No cards yet — add rows to the challenge sheet.";
    statusEl.classList.remove("limit-reached");
    return;
  }

  if (remainingToday <= 0) {
    statusEl.textContent = "🎉 Today's card is picked. Come back tomorrow!";
    statusEl.classList.add("limit-reached");
    return;
  }

  const closed = cards.filter((card) => card.status === "closed").length;
  statusEl.textContent = `You can open 1 card today — ${closed} of ${cards.length} still closed.`;
  statusEl.classList.remove("limit-reached");
}

export function renderLoadError(message) {
  statusEl.textContent = message;
  statusEl.classList.add("limit-reached");
}
