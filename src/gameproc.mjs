/**
 * Detect and stop the running Clicker Heroes process.
 *
 * A save install is only safe while the game is closed: the game overwrites
 * playerSaveData.txt on its own autosave, which would silently undo the import.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const NAME_RE = /clicker\s*heroes/i;

function linuxPids() {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ");
      // Never match ourselves or the overlay's own Electron/Node processes.
      if (/electron|ch-overlay|clip-collect|node\s+src\/server/.test(cmd)) continue;
      // Match the process's own name only. The Steam runtime wrappers carry
      // "Clicker Heroes.exe" in their command line too, and killing those
      // breaks the Steam session instead of closing the game.
      const comm = fs.readFileSync(`/proc/${entry}/comm`, "utf8").trim();
      if (/^clicker\s*heroes/i.test(comm)) out.push(Number(entry));
    } catch {
      /* process vanished */
    }
  }
  return out;
}

function windowsPids() {
  try {
    const raw = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
    return raw
      .split(/\r?\n/)
      .map((line) => line.split('","'))
      .filter((cols) => cols.length && NAME_RE.test(cols[0] ?? ""))
      .map((cols) => Number((cols[1] ?? "").replace(/"/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function darwinPids() {
  try {
    const raw = execFileSync("pgrep", ["-fi", "clicker heroes"], { encoding: "utf8" });
    return raw.split(/\s+/).filter(Boolean).map(Number).filter((n) => n > 0);
  } catch {
    return [];
  }
}

export function gamePids() {
  if (process.platform === "win32") return windowsPids();
  if (process.platform === "darwin") return darwinPids();
  return linuxPids();
}

export function isGameRunning() {
  return gamePids().length > 0;
}

/**
 * Ask the game to quit (SIGTERM), then wait for it to disappear.
 * Returns { closed, pids, waitedMs }. Never SIGKILLs: the game must be able to
 * flush its own save before we touch the file.
 */
export async function closeGame({ timeoutMs = 20000, stepMs = 500 } = {}) {
  const pids = gamePids();
  if (!pids.length) return { closed: true, pids, waitedMs: 0 };

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone or not permitted */
    }
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
    if (!isGameRunning()) return { closed: true, pids, waitedMs: Date.now() - started };
  }
  return { closed: false, pids: gamePids(), waitedMs: Date.now() - started };
}
