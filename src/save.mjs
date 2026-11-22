// Locate and decode the Clicker Heroes save file (Steam / Proton).
//
// The file is not encrypted: <32-char marker><base64(compressed JSON)>.
//   marker 7e8bb5a89f2842ac4af01b3b7e228592 -> PC save, raw deflate
//   marker 7a990d405d2c6fb93aa8fbb0ec1a3b23 -> mobile save, zlib
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const PC_MARKER = "7e8bb5a89f2842ac4af01b3b7e228592";
const MOBILE_MARKER = "7a990d405d2c6fb93aa8fbb0ec1a3b23";

// Steam's Proton prefix keeps the game's LocalLow folder here.
const PREFIX_REL = [
  "steamapps/compatdata/363970/pfx/drive_c/users/steamuser/AppData/LocalLow",
  "Steam/steamapps/compatdata/363970/pfx/drive_c/users/steamuser/AppData/LocalLow",
  "steam/steamapps/compatdata/363970/pfx/drive_c/users/steamuser/AppData/LocalLow",
];
const SAVE_REL = "Playsaurus/Clicker Heroes/playerSaveData.txt";
const EXPORT_REL = "Playsaurus/Clicker Heroes/export";

function steamRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const roots = [];

  if (process.platform === "win32") {
    // Steam keeps the prefix under steamapps/compatdata on Linux only; on
    // Windows the game writes straight into LOCALAPPDATA.
    roots.push(path.join(process.env.LOCALAPPDATA || "", "Playsaurus", "Clicker Heroes"));
    for (const drive of ["C:", "D:", "E:"]) {
      roots.push(path.join(drive + "\\", "Program Files (x86)", "Steam"));
      roots.push(path.join(drive + "\\", "SteamLibrary"));
    }
  } else if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Application Support", "Steam"));
  } else {
    roots.push(path.join(home, ".local/share/Steam"));
    roots.push(path.join(home, ".steam/steam"));
    roots.push(path.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"));
  }
  if (process.env.STEAM_ROOT) roots.unshift(process.env.STEAM_ROOT);
  return roots.filter(Boolean);
}

/** All plausible live-save paths, most likely first. */
export function saveCandidates() {
  const out = [];
  // Explicit override wins everywhere: CH_SAVE_FILE=/path/to/playerSaveData.txt
  if (process.env.CH_SAVE_FILE) out.push(process.env.CH_SAVE_FILE);

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    if (local) out.push(path.join(local, "Playsaurus", "Clicker Heroes", "playerSaveData.txt"));
  }
  if (process.platform === "darwin") {
    const home = process.env.HOME || "";
    out.push(path.join(home, "Library", "Application Support", "Playsaurus", "Clicker Heroes", "playerSaveData.txt"));
  }

  if (process.platform === "linux") {
    // Android builds (Waydroid / Anbox) keep the APK save inside the container.
    // Conventional paths; if a build differs, set a custom save path in Settings.
    const home = process.env.HOME || "";
    for (const pkg of ["com.playsaurus.clickerheroes", "com.playsaurus.clickerheroes2"]) {
      out.push(path.join(home, ".local/share/waydroid/data/data", pkg, "files", "playerSaveData.txt"));
      out.push(path.join(home, ".local/share/waydroid/data/media/0/Android/data", pkg, "files", "playerSaveData.txt"));
    }
  }

  for (const root of steamRoots()) {
    for (const rel of PREFIX_REL) {
      out.push(path.join(root, rel, SAVE_REL));
    }
  }
  return out;
}

/** Newest exported save (used only when the live file is missing). */
export function newestExport() {
  if (process.platform === "linux") {
    // Android builds (Waydroid / Anbox) keep the APK save inside the container.
    // Conventional paths; if a build differs, set a custom save path in Settings.
    const home = process.env.HOME || "";
    for (const pkg of ["com.playsaurus.clickerheroes", "com.playsaurus.clickerheroes2"]) {
      out.push(path.join(home, ".local/share/waydroid/data/data", pkg, "files", "playerSaveData.txt"));
      out.push(path.join(home, ".local/share/waydroid/data/media/0/Android/data", pkg, "files", "playerSaveData.txt"));
    }
  }

  for (const root of steamRoots()) {
    for (const rel of PREFIX_REL) {
      const dir = path.join(root, rel, EXPORT_REL);
      try {
        const files = fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".txt"))
          .map((f) => path.join(dir, f));
        if (files.length) {
          files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
          return files[0];
        }
      } catch {
        /* not there */
      }
    }
  }
  return null;
}

export function findSave() {
  for (const p of saveCandidates()) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* keep looking */
    }
  }
  return newestExport();
}

/** Decode the save text into a plain object. Throws on garbage/partial writes. */
export function decodeSave(text) {
  if (typeof text !== "string") throw new Error("save: not text");
  const raw = text.replace(/^\uFEFF/, "").trim();
  if (raw.length < 40) throw new Error("save: too short");

  const marker = raw.slice(0, 32);
  const body = raw.slice(32).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(marker)) throw new Error("save: bad marker");

  let buf = Buffer.from(body, "base64");
  if (!buf.length) throw new Error("save: empty payload");

  let json;
  if (marker === PC_MARKER || marker.startsWith("7e8bb")) {
    json = zlib.inflateRawSync(buf);
  } else if (marker === MOBILE_MARKER || marker.startsWith("7a990")) {
    json = zlib.inflateSync(buf);
  } else {
    // Unknown marker: the payload is still deflate-ish; try both, keep the one that parses.
    json = tryDecode(buf);
  }
  const obj = JSON.parse(json.toString("utf8"));
  if (!obj || typeof obj !== "object") throw new Error("save: not an object");
  if (obj.version === undefined && obj.heroCollection === undefined) {
    throw new Error("save: missing version/heroCollection");
  }
  obj.__saveOrigin = marker.startsWith("7a990") ? "mobile" : "pc";
  return obj;
}

/**
 * Encode a save object back into game format.
 * PC uses the marker + raw deflate; mobile uses its marker + zlib.
 */
export function encodeSave(obj, platform = "pc") {
  if (!obj || typeof obj !== "object") throw new Error("encode: not an object");
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const isMobile = platform === "mobile";
  const body = isMobile ? zlib.deflateSync(payload) : zlib.deflateRawSync(payload);
  const marker = isMobile ? MOBILE_MARKER : PC_MARKER;
  return marker + body.toString("base64");
}

/** Round-trip check: decode(encode(x)) must equal x (minus our own annotations). */
export function convertSave(text, platform = "pc") {
  const obj = decodeSave(text);
  delete obj.__saveOrigin;
  return { text: encodeSave(obj, platform), object: obj };
}

function tryDecode(buf) {
  try {
    return zlib.inflateRawSync(buf);
  } catch {
    return zlib.inflateSync(buf);
  }
}

/**
 * Read + decode, tolerating the game writing the file right now.
 * Retries a few times with a small backoff before giving up.
 */
export async function readSave(file = null, { attempts = 4, delayMs = 120 } = {}) {
  const target = file || findSave();
  if (!target) {
    const tried = saveCandidates().join("\n  ");
    throw new Error(
      `save: not found. Tried:\n  ${tried}\nSet CH_SAVE_FILE=/path/to/playerSaveData.txt to override.`,
    );
  }

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = fs.readFileSync(target, "utf8");
      const save = decodeSave(text);
      const st = fs.statSync(target);
      return { save, path: target, mtimeMs: st.mtimeMs, bytes: st.size };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  const e = new Error(`save: unreadable after ${attempts} attempts (${lastErr?.message})`);
  e.cause = lastErr;
  e.path = target;
  throw e;
}
