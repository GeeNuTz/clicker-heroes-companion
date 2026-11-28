#!/usr/bin/env node
/**
 * Launch the companion when Clicker Heroes starts, instead of at login.
 *
 * The overlay cannot start itself before the game exists, so this small watcher
 * polls for the game process and starts the companion once per game session.
 * Enabling or disabling it is the "Launch when Clicker Heroes starts" box in the
 * companion's Settings tab (settings.json → launchWithGame).
 */
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SETTINGS = path.join(ROOT, "settings.json");
const APP = process.env.CH_APP_PATH || path.join(ROOT, "dist", "Clicker Heroes Companion.AppImage");
const POLL_MS = Number(process.env.CH_WATCH_MS || 4000);

function settings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    return {};
  }
}

function pids(pattern) {
  try {
    const out = execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

const gameRunning = () =>
  pids("Clicker Heroes\\.exe|ClickerHeroes|clicker heroes").some((pid) => {
    try {
      return !/companion|ch-overlay|watch-game|node/.test(fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " "));
    } catch {
      return false;
    }
  });

const companionRunning = () => pids("Clicker Heroes Companion|clicker-heroes-companion").length > 0;

let started = false;

function tick() {
  const s = settings();
  if (s.launchWithGame === false) return;
  const game = gameRunning();
  if (!game && !companionRunning()) started = false; // next game session can start it again
  if (!game || companionRunning() || started) return;

  started = true;
  try {
    execFile(APP, ["--ozone-platform=x11", "--class=clicker-heroes-companion"], { detached: true, stdio: "ignore" }).unref();
    console.log(new Date().toISOString(), "game started → companion launched");
  } catch (err) {
    started = false;
    console.error("launch failed:", err.message);
  }
}

console.log("watching for Clicker Heroes; app:", APP);
tick();
setInterval(tick, POLL_MS);
