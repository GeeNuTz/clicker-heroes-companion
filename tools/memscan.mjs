// Proof-of-concept memory scanner for Clicker Heroes (Proton/Unity).
// Usage: node tools/memscan.mjs <pid> <int|double> <value> [limit]
import fs from "node:fs";

const [pid, type, raw, limitArg] = process.argv.slice(2);
if (!pid || !type || raw === undefined) {
  console.error("usage: memscan.mjs <pid> <int|double> <value> [limit]");
  process.exit(2);
}
const limit = Number(limitArg || 40);
const maps = fs.readFileSync(`/proc/${pid}/maps`, "utf8").split("\n");
const mem = fs.openSync(`/proc/${pid}/mem`, "r");

const buf = Buffer.alloc(8);
if (type === "double") buf.writeDoubleLE(Number(raw), 0);
else buf.writeInt32LE(Number(raw) | 0, 0);
const needle = type === "double" ? buf.subarray(0, 8) : buf.subarray(0, 4);

const hits = [];
let scanned = 0;
for (const line of maps) {
  const m = line.match(/^([0-9a-f]+)-([0-9a-f]+)\s(rw-p|r--p)\s/);
  if (!m) continue;
  const start = parseInt(m[1], 16);
  const end = parseInt(m[2], 16);
  const size = end - start;
  if (size <= 0 || size > 512 * 1024 * 1024) continue;
  let data;
  try {
    data = Buffer.alloc(size);
    const read = fs.readSync(mem, data, 0, size, start);
    data = data.subarray(0, read);
  } catch { continue; }
  scanned += data.length;
  let idx = data.indexOf(needle);
  while (idx !== -1 && hits.length < limit) {
    hits.push(start + idx);
    idx = data.indexOf(needle, idx + 1);
  }
  if (hits.length >= limit) break;
}
console.log(JSON.stringify({ pid: Number(pid), type, value: Number(raw), scannedBytes: scanned, count: hits.length, hits: hits.map((a) => "0x" + a.toString(16)) }));
