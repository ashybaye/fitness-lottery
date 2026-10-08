// Reads the challenge cards out of a published Google Sheet.
//
// The sheet is published as CSV ("File → Share → Publish to web → CSV"), which means no
// API key, no quota, and CORS headers that let a static GitHub Pages site fetch it
// directly. See sheet-config.js for setup.
//
// Everything here is content-only: this module knows nothing about Firestore, card state,
// or the DOM. It turns a URL into a validated, ordered list of { id, text, order }.

import { parseCsv } from "./csv.js";

export class SheetError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "SheetError";
    if (cause) this.cause = cause;
  }
}

const REQUIRED_COLUMNS = ["id", "text"];

// Firestore document id restrictions: non-empty, no forward slashes, not "." or "..",
// not surrounded by double underscores, and at most 1500 bytes.
function describeInvalidId(id) {
  if (id === "") return "is empty";
  if (id.includes("/")) return "contains a forward slash";
  if (id === "." || id === "..") return `is the reserved id "${id}"`;
  if (/^__.*__$/.test(id)) return "is surrounded by double underscores";
  if (new TextEncoder().encode(id).length > 1500) return "is longer than 1500 bytes";
  return null;
}

function findColumns(headerRow) {
  const normalized = headerRow.map((h) => h.trim().toLowerCase());
  const columns = {};

  for (const name of REQUIRED_COLUMNS) {
    const index = normalized.indexOf(name);
    if (index === -1) {
      throw new SheetError(
        `The sheet is missing a "${name}" column. Its first row must contain ` +
          `${REQUIRED_COLUMNS.map((c) => `"${c}"`).join(" and ")} headers.`
      );
    }
    columns[name] = index;
  }

  return columns;
}

/**
 * Turns published-CSV text into the card list.
 *
 * @param {string} csvText
 * @returns {{ id: string, text: string, order: number }[]}
 */
export function parseChallenges(csvText) {
  let rows;
  try {
    rows = parseCsv(csvText);
  } catch (err) {
    throw new SheetError(`Could not parse the sheet as CSV: ${err.message}`, { cause: err });
  }

  if (rows.length === 0) {
    throw new SheetError("The sheet is empty — it needs a header row and at least one card.");
  }

  const columns = findColumns(rows[0]);
  const cards = [];
  const seen = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const sheetRowNumber = i + 1;
    const id = (row[columns.id] ?? "").trim();
    const text = (row[columns.text] ?? "").trim();

    // A row with neither value is leftover spreadsheet padding, not an error.
    if (id === "" && text === "") continue;

    const problem = describeInvalidId(id);
    if (problem) {
      throw new SheetError(`Row ${sheetRowNumber}: the "id" value ${problem}.`);
    }
    if (text === "") {
      throw new SheetError(`Row ${sheetRowNumber}: the "text" value is empty (id "${id}").`);
    }
    if (seen.has(id)) {
      throw new SheetError(
        `Row ${sheetRowNumber}: duplicate id "${id}" (already used on row ${seen.get(id)}). ` +
          "Each card needs a unique id."
      );
    }

    seen.set(id, sheetRowNumber);
    cards.push({ id, text, order: cards.length + 1 });
  }

  if (cards.length === 0) {
    throw new SheetError("The sheet has a header row but no cards.");
  }

  return cards;
}

/**
 * Fetches and parses the published sheet.
 *
 * @param {string} url Published CSV URL.
 * @param {typeof fetch} [fetchImpl] Injectable for tests.
 * @returns {Promise<{ id: string, text: string, order: number }[]>}
 */
export async function fetchChallenges(url, fetchImpl = globalThis.fetch) {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new SheetError(
      "No published sheet URL is configured. Set SHEET_CSV_URL in sheet-config.js."
    );
  }

  let response;
  try {
    response = await fetchImpl(url, { cache: "no-store" });
  } catch (err) {
    throw new SheetError(`Could not reach the sheet: ${err.message}`, { cause: err });
  }

  if (!response.ok) {
    throw new SheetError(
      `The sheet responded with HTTP ${response.status}. Check that it is still published to the web.`
    );
  }

  return parseChallenges(await response.text());
}

/**
 * Order-sensitive fingerprint of the sheet's content, used to skip redundant writes when
 * a sync runs against an unchanged sheet.
 *
 * FNV-1a: not cryptographic, just a cheap, stable, dependency-free content hash.
 *
 * @param {{ id: string, text: string, order: number }[]} cards
 * @returns {string}
 */
export function hashChallenges(cards) {
  const serialized = cards.map((c) => `${c.order}\u0000${c.id}\u0000${c.text}`).join("\u0001");
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
