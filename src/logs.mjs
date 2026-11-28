/**
 * Parsers for the two CSVs the game exports from the Ascensions and
 * Transcensions windows.
 *
 * The old parsers matched one exact shape (`n, time, zone, hs[, asc]`, nothing
 * else). Real exports vary: extra columns, tab separators, a header block, a
 * BOM, thousands separators, or "1.23K"/"4.5M" suffixes. Anything that did not
 * match was dropped silently, which is why a pasted log produced "no rows".
 *
 * These parsers keep only what the app uses and accept the variants:
 *   - any header or footer line is skipped
 *   - separators: comma, semicolon, tab or runs of spaces
 *   - numbers may carry K / M / B (also lowercase) or thousands commas
 */

const SUFFIX = { K: 1e3, M: 1e6, B: 1e9 };

/** "1.23K" / "4,500" / "12" → number, or NaN. */
export function toNumber(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return NaN;
  const m = s.match(/^([0-9][0-9.,]*)\s*([KMB])?$/i);
  if (!m) return NaN;
  let digits = m[1];
  // "1,234" is a thousands separator, "1,5" would be European decimal — the
  // game writes plain decimals, so treat commas as separators.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits)) digits = digits.replace(/,/g, "");
  else digits = digits.replace(/,/g, ".");
  const n = Number(digits);
  if (!Number.isFinite(n)) return NaN;
  const mult = m[2] ? SUFFIX[m[2].toUpperCase()] : 1;
  return n * mult;
}

function cells(line) {
  return String(line)
    .trim()
    .split(/[,;\t]+|\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

function looksLikeDuration(s) {
  return /^\d{1,3}:\d{2}(:\d{2})?$/.test(String(s).trim());
}

/**
 * Turn one exported block into rows.
 *
 * @param {string} text  pasted CSV
 * @param {{withAscensions?: boolean}} opts
 * @returns {Array<{n:number,duration:string,hze:number,hs:number,ascensions?:number}>}
 */
export function parseLog(text, { withAscensions = false } = {}) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const raw = line.replace(/^\uFEFF/, "").trim();
    if (!raw) continue;
    const cols = cells(raw);
    if (cols.length < 3) continue;

    const n = toNumber(cols[0]);
    if (!Number.isInteger(n) || n <= 0) continue; // header or footer

    const timeIdx = cols.findIndex((c) => looksLikeDuration(c));
    if (timeIdx === -1) continue;

    // Zone is the first integer after the duration; hero souls the first
    // number after that. Extra columns are ignored.
    let hze;
    let hs;
    for (let i = timeIdx + 1; i < cols.length; i++) {
      const v = toNumber(cols[i]);
      if (!Number.isFinite(v)) continue;
      if (hze === undefined) { hze = v; continue; }
      if (hs === undefined) { hs = v; break; }
    }
    if (!Number.isFinite(hze) || !Number.isFinite(hs)) continue;

    const row = { n, duration: cols[timeIdx], hze: Math.round(hze), hs };
    if (withAscensions) {
      // The transcension export carries the ascension count in a later column.
      for (let i = timeIdx + 3; i < cols.length; i++) {
        const v = toNumber(cols[i]);
        if (Number.isFinite(v)) { row.ascensions = Math.round(v); break; }
      }
    }
    rows.push(row);
  }
  return rows;
}

export function parseAscensionCsv(csv) {
  return parseLog(csv);
}

export function parseTranscensionCsv(csv) {
  return parseLog(csv, { withAscensions: true });
}

/** Which log a clipboard blob belongs to, judged by any of its first lines. */
export function classifyClipboard(text) {
  const head = String(text || "").split(/\r?\n/).slice(0, 5).join("\n");
  if (/transcension/i.test(head)) return "transcensionLog";
  if (/ascension/i.test(head)) return "ascensionLog";
  return null;
}
