// Local HTTP + SSE server for the overlay.
// Binds to 127.0.0.1 only; the game is never touched, only its save file is read.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAscensionCsv, parseTranscensionCsv, classifyClipboard } from "./logs.mjs";
import { execFileSync } from "node:child_process";
import { convertSave, decodeSave, encodeSave, findSave, readSave } from "./save.mjs";
import { closeGame, gamePids, isGameRunning } from "./gameproc.mjs";
const APP_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
import { buildState } from "./engine.mjs";
import { advise } from "./advice.mjs";
import { ancientSuggestions, outsiderSuggestions, loadSettings } from "./suggest.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(HERE, "ui");
const PORT = Number(process.env.CH_OVERLAY_PORT || 8787);
const HOST = "127.0.0.1";
// Event-driven watching keeps latency at the game's own write cadence; the
// interval is only a safety net for filesystems that miss watch events.
const POLL_MS = Number(process.env.CH_OVERLAY_POLL_MS || 2000);

let lastMtime = 0;
let lastPayload = null;
let lastError = null;
const clients = new Set();

// A pasted save can be used read-only without touching the game file. It stays
// active until the next reload clears it.
let overrideSave = null;
let overrideLabel = null;

/** Last N versions from CHANGELOG.md — the single source for the in-app list. */
function readChangelog(n = 5) {
  // Inside a packaged app the file lives in app.asar; URL objects do not always
  // go through Electron's asar layer, so try plain paths too.
  const candidates = [
    fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)),
    join(process.resourcesPath || "", "app.asar", "CHANGELOG.md"),
    join(process.cwd(), "CHANGELOG.md"),
  ];
  let md = "";
  for (const c of candidates) {
    try { md = readFileSync(c, "utf8"); if (md) break; } catch { /* next */ }
  }
  if (!md) return [];
  const out = [];
  const parts = md.split(/^## /m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split("\n");
    const m = head.match(/^([0-9][\w.]*)\s*(?:—|-)\s*(.+)$/);
    if (!m) continue;
    const bullets = rest.filter((l) => /^- /.test(l.trim())).map((l) => l.trim().replace(/^- /, ""));
    out.push({ version: m[1], date: m[2].trim(), bullets });
    if (out.length >= n) break;
  }
  return out;
}

async function snapshot() {
  let save, p, mtimeMs;
  if (overrideSave) {
    save = overrideSave;
    p = "pasted save (read-only)";
    mtimeMs = overrideMtime;
  } else {
    ({ save, path: p, mtimeMs } = await readSave(loadSettings().savePath || null));
  }
  const state = buildState(save, { now: Date.now() });
  const advice = advise(state, {
    settings: loadSettings(),
    ascensions: parseAscensionCsv(loadSettings().ascensionLog),
    transcensions: parseTranscensionCsv(loadSettings().transcensionLog),
  });
  const settings = loadSettings();
  const version = APP_VERSION;
  const ascensions = parseAscensionCsv(settings.ascensionLog);
  const transcensions = parseTranscensionCsv(settings.transcensionLog);
  const always = {
    version,
    settings: { theme: settings.theme || "dark", fontScale: settings.fontScale || 1, build: settings.build, fontFamily: settings.fontFamily || "sans", density: settings.density || "comfortable" },
    afterTranscend: advice.transcendReady === true,
    ancients: ancientSuggestions(state, settings),
    outsiders: outsiderSuggestions(state, settings),
  };
  const ageSeconds = Math.max(0, (Date.now() - mtimeMs) / 1000);
  return {
    ok: true,
    at: Date.now(),
    savePath: p,
    mtimeMs,
    saveAgeSeconds: ageSeconds,
    stale: ageSeconds > 120,
    version,
    // The panel reads payload.changelog; it was computed nowhere, so the tab
    // always said "changelog unavailable".
    changelog: readChangelog(),
    state,
    advice,
    // The panel reads these two directly; they used to be parsed and then
    // dropped, which is why a pasted log still showed "No ascension log yet".
    ascensions,
    transcensions,
    suggest: always,
  };
}

let ticking = false;
let overrideMtime = Date.now();
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const p = findSave();
    if (!p) throw new Error("save file not found");
    const st = fs.statSync(p);
    if (st.mtimeMs === lastMtime && lastPayload) return; // finally clears the guard
    const payload = await snapshot();
    lastMtime = payload.mtimeMs;
    lastPayload = payload;
    lastError = null;
    broadcast({ type: "state", payload });
  } catch (err) {
    lastError = String(err?.message || err);
    broadcast({ type: "error", error: lastError, at: Date.now() });
  } finally {
    ticking = false;
  }
}

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === "/api/state") {
    try {
      const payload = lastPayload ?? (await snapshot());
      lastPayload = payload;
      lastMtime = payload.mtimeMs;
      json(res, 200, payload);
    } catch (err) {
      json(res, 503, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  if (url.pathname === "/api/reload" && req.method === "POST") {
    lastMtime = 0; // force the next tick to re-read even if mtime matches
    try {
      const payload = await snapshot();
      lastPayload = payload;
      broadcast({ type: "state", payload });
      json(res, 200, { ok: true, saveAgeSeconds: payload.saveAgeSeconds });
    } catch (err) {
      json(res, 500, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  if (url.pathname === "/api/save/export") {
    try {
      const platform = url.searchParams.get("platform") === "mobile" ? "mobile" : "pc";
      const { save } = await readSave(loadSettings().savePath || null);
      delete save.__saveOrigin;
      json(res, 200, { ok: true, platform, text: encodeSave(save, platform) });
    } catch (err) {
      json(res, 200, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  if (url.pathname === "/api/save/convert" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const platform = body.platform === "mobile" ? "mobile" : "pc";
      const { text, object } = convertSave(body.text, platform);
      json(res, 200, { ok: true, platform, text, from: object.__saveOrigin ?? "unknown", zone: object.currentZoneHeight });
    } catch (err) {
      json(res, 200, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  if (url.pathname === "/api/save/use" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const obj = decodeSave(body.text);
      delete obj.__saveOrigin;
      overrideSave = obj;
      overrideMtime = Date.now();
      lastMtime = 0;
      await tick();
      json(res, 200, { ok: true, zone: obj.currentZoneHeight });
    } catch (err) {
      json(res, 200, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  if (url.pathname === "/api/save/clear" && req.method === "POST") {
    overrideSave = null;
    lastMtime = 0;
    await tick();
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/game/status") {
    json(res, 200, { ok: true, running: isGameRunning(), pids: gamePids() });
    return;
  }

  if (url.pathname === "/api/save/install" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      if (body.confirm !== true) throw new Error("install needs confirm:true");

      // The game overwrites the save on its next autosave, so an install is
      // only safe once the process is gone. Refuse unless the caller asked us
      // to close it, and verify it actually exited.
      if (isGameRunning()) {
        if (body.closeGame !== true) {
          throw new Error("game is running — close it first (or pass closeGame:true)");
        }
        const result = await closeGame();
        if (!result.closed) {
          throw new Error(`game did not exit within ${Math.round(result.waitedMs / 1000)}s (pids ${result.pids.join(", ")})`);
        }
        await new Promise((r) => setTimeout(r, 1500)); // let it flush + exit
      }
      const target = findSave();
      if (!target) throw new Error("live save not found");
      const { text } = convertSave(body.text, "pc");
      // Always keep a copy of what we are about to overwrite.
      const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(target, backup);
      fs.writeFileSync(target, text);
      lastMtime = 0;
      tick();
      json(res, 200, { ok: true, backup, target });
    } catch (err) {
      json(res, 200, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  if (url.pathname === "/api/update/check") {
    const fn = globalThis.__chCheckUpdate;
    return json(res, 200, fn ? await fn() : { ok: false, error: "updater not initialised" });
  }

  if (url.pathname === "/api/settings") {
    const file = process.env.CH_SETTINGS_FILE || new URL("../settings.json", import.meta.url);
    if (req.method === "GET") {
      try {
        // Always return the merged view so the panel shows every key, not just
        // whatever happens to be in the on-disk file.
        json(res, 200, { ok: true, settings: loadSettings() });
      } catch (err) {
        json(res, 200, { ok: false, error: String(err?.message || err) });
      }
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          writeFileSync(file, JSON.stringify(parsed, null, 2));
          const payload = lastPayload;
          if (payload) {
            const fresh = loadSettings();
            payload.suggest = {
              ...payload.suggest,
              settings: { theme: fresh.theme || "dark", fontScale: fresh.fontScale || 1, build: fresh.build, fontFamily: fresh.fontFamily || "sans", density: fresh.density || "comfortable" },
              ancients: ancientSuggestions(payload.state, fresh),
              outsiders: outsiderSuggestions(payload.state, fresh),
            };
            broadcast({ type: "state", payload });
          }
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, 400, { ok: false, error: String(err?.message || err) });
        }
      });
      return;
    }
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    if (lastPayload) res.write(`data: ${JSON.stringify({ type: "state", payload: lastPayload })}\n\n`);
    if (lastError) res.write(`data: ${JSON.stringify({ type: "error", error: lastError })}\n\n`);
    req.on("close", () => clients.delete(res));
    return;
  }

  // static UI
  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.join(UI, path.normalize(rel));
  if (!file.startsWith(UI)) {
    res.writeHead(403).end("nope");
    return;
  }
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/**
 * The game's Ascensions / Transcensions windows have an Export button that puts
 * a CSV on the clipboard. Watching the clipboard picks it up with no paste and
 * no memory reading.
 */
function watchGameExports() {
  let last = "";
  setInterval(() => {
    let clip = "";
    try {
      clip = execFileSync("wl-paste", ["-n"], { encoding: "utf8", timeout: 1500 });
    } catch {
      return;
    }
    if (!clip || clip === last) return;
    last = clip;
    const kind = classifyClipboard(clip);
    const file = process.env.CH_SETTINGS_FILE || new URL("../settings.json", import.meta.url);
    try {
      const current = loadSettings();
      let changed = false;
      if (kind === "ascensionLog" && clip.trim() !== current.ascensionLog) {
        current.ascensionLog = clip.trim();
        changed = true;
        console.log("clipboard: ascension log imported");
      } else if (kind === "transcensionLog" && clip.trim() !== current.transcensionLog) {
        current.transcensionLog = clip.trim();
        changed = true;
        console.log("clipboard: transcension log imported");
      }
      if (changed) {
        writeFileSync(file, JSON.stringify(current, null, 2));
        lastMtime = 0;
        tick();
      }
    } catch { /* settings not writable: ignore */ }
  }, 3000);
}

let listenAttempts = 0;
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE" && listenAttempts < 10) {
    listenAttempts += 1;
    // A previous instance may still be exiting; retry briefly instead of dying.
    setTimeout(() => server.listen(PORT, HOST), 800);
    return;
  }
  if (err && err.code === "EADDRINUSE") {
    console.log(`port ${HOST}:${PORT} is held by another process — the panel will stay empty`);
    return;
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`overlay: http://${HOST}:${PORT}`);
  const path = findSave();
  console.log(`save:    ${path || "(not found)"}`);

  tick();

  if (path) {
    // fs.watchFile polls the stat itself every 200 ms and fires on mtime change,
    // which is far cheaper than re-reading + re-parsing the save.
    fs.watchFile(path, { interval: 200 }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) tick();
    });
  }
  setInterval(tick, POLL_MS);
  watchGameExports();
  // Heartbeat keeps the SSE connection alive and lets the UI detect a stall.
  setInterval(() => broadcast({ type: "ping", at: Date.now() }), 10000);
});
