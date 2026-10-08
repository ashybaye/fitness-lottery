// Minimal RFC 4180 CSV parser.
//
// Google Sheets' "Publish to web → CSV" output is well-formed RFC 4180: fields that
// contain a comma, a double quote, or a newline are wrapped in double quotes, and a
// literal double quote inside a quoted field is escaped by doubling it. This parser
// handles exactly that, so a challenge like
//   🏆 60-minute "choose your favorite" workout
// survives a round trip through the sheet.
//
// Returns an array of rows, each row an array of string fields. Rows that are entirely
// empty (a blank line, or a line of nothing but separators) are dropped, because trailing
// blank rows are common in spreadsheets.

const QUOTE = '"';
const COMMA = ",";

function isBlankRow(row) {
  return row.every((field) => field.trim() === "");
}

export function parseCsv(text) {
  if (typeof text !== "string") {
    throw new TypeError("parseCsv expects a string.");
  }

  // Strip a UTF-8 BOM, which Sheets sometimes prepends.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === QUOTE) {
        if (input[i + 1] === QUOTE) {
          field += QUOTE;
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === QUOTE) {
      inQuotes = true;
    } else if (char === COMMA) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat CRLF as a single terminator.
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (!isBlankRow(row)) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error("Malformed CSV: unterminated quoted field.");
  }

  // Flush whatever is left when the input doesn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!isBlankRow(row)) rows.push(row);
  }

  return rows;
}
