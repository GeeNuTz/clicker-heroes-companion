// Overlay client: subscribes to /events and repaints. No framework, no build.

const $ = (id) => document.getElementById(id);

function short(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "∞";
  const a = Math.abs(x);
  if (a < 1000) return String(Math.round(x));
  if (a < 1e6) return (x / 1e3).toFixed(1) + "k";
  if (a < 1e9) return (x / 1e6).toFixed(2) + "M";
  if (a < 1e12) return (x / 1e9).toFixed(2) + "B";
  const exp = Math.floor(Math.log10(a));
  return (x / Math.pow(10, exp)).toFixed(2) + "e" + exp;
}

function secs(s) {
  if (!Number.isFinite(s)) return "∞";
  if (s < 1) return Math.round(s * 1000) + "ms";
  if (s < 90) return s.toFixed(1) + "s";
  return (s / 60).toFixed(1) + "m";
}

function render(payload) {
  const { state, advice } = payload;
  const c = state.combat;

  $("patch").textContent = state.meta.patch || "?";
  $("zone").textContent = state.zone.current;
  $("hze").innerHTML =
    `best ${state.zone.hze}<br>asc ${state.stats.ascensions} · trans ${state.zone.transcensions}`;
  $("dps").textContent = short(c.effectiveIdleDps);
  $("boss").textContent = c.bossSeconds > 30
    ? `boss ${c.bossZone}: ${secs(c.bossSeconds)} ⚠`
    : `boss ${c.bossZone}: ${secs(c.bossSeconds)}`;
  $("gold").textContent = short(state.resources.gold);
  if ($("maxzone")) $("maxzone").textContent = state.combat.bossWall || "—";
  $("goldsub").textContent = `rubies ${state.resources.rubies}`;
  $("souls").textContent = short(state.resources.heroSouls);
  $("soulsub").textContent = `AS ${state.resources.ancientSouls} · +${short(state.resources.soulsBonusPercent)}%`;

  const top = advice.actions[0];
  if (top) {
    $("next-title").textContent = top.title;
    $("next-detail").textContent = top.detail || "";
  }

  $("warnings").innerHTML = advice.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");

  const tl = advice.timeline || [];
  $("plan").innerHTML = tl
    .map((t, i) => {
      const bob = i === 0 ? "p0" : i === 1 ? "p1" : "";
      return (
        `<li class="${bob}">` +
        `<div class="when">${esc(t.when || "")}</div>` +
        `<div class="t">${esc(t.action || "")}</div>` +
        (t.detail ? `<div class="d">${esc(t.detail)}</div>` : "") +
        (t.why ? `<div class="why">${esc(t.why)}</div>` : "") +
        (t.eta ? `<div class="d">${esc(t.eta)}</div>` : "") +
        `</li>`
      );
    })
    .join("");

  applyLook(payload.suggest?.settings);
  const sug = payload.suggest?.ancients || [];
  const sugMap = new Map(sug.map((s) => [s.name, s]));
  const sortedA = state.ancients
    .slice()
    .sort((a, b) => {
      const ra = sugMap.get(a.name)?.rank ?? 999;
      const rb = sugMap.get(b.name)?.rank ?? 999;
      return ra - rb || b.bonus - a.bonus;
    });
  $("ancients").innerHTML = sortedA
    .map((a, i) => {
      const s = sugMap.get(a.name) || { current: a.level, suggested: a.level, diff: 0 };
      const d = s.diff;
      const color = d > 0 ? "color:var(--accent)" : d < 0 ? "color:var(--bad)" : "";
      const rank = s.rank ?? "–";
      const nameCell = s.skip ? `<td class="dim">${esc(a.name)}</td>` : `<td>${esc(a.name)}</td>`;
      if (s.skip) {
        return `<tr><td class="rank"></td>${nameCell}<td class="r">${s.current}</td>` +
          `<td class="r dim">—</td><td class="r dim">skip</td></tr>`;
      }
      return `<tr><td class="rank ${s.rank === 1 ? "top" : ""}">${rank}</td>${nameCell}` +
        `<td class="r">${s.current}</td><td class="r">${s.suggested}</td>` +
        `<td class="r" style="${color}">${d > 0 ? "+" + d : d}</td></tr>`;
    })
    .join("");

  const hint = $("ancients-hint");
  if (hint) {
    hint.textContent = payload.suggest?.frozen
      ? "Transcendence is ready — souls and ancient levels reset. Buy nothing until after it."
      : "Rank = best effect per soul. Cur / Sug / Diff, cost in souls.";
  }
  const outs = (payload.suggest?.outsiders || []).slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.name.localeCompare(b.name));
  const asFree = Number(state.resources.ancientSouls || 0);
  const buys = outs.filter((o) => o.diff > 0);
  const priority = outs.filter((o) => o.rank).sort((a, b) => a.rank - b.rank).slice(0, 3);
  const note = $("outsider-note");
  if (note) {
    if (buys.length) {
      note.innerHTML =
        `<div class="note-head">${asFree} unspent Ancient Soul${asFree === 1 ? "" : "s"}</div>` +
        `<div class="note-sub">${asFree > 0 ? "Buy in this order:" : "Planned from your total Ancient Souls — you cannot afford any of it until the next transcendence:"}</div>` +
        buys.map((o, i) => `<div class="note-buy">${i + 1}. <b>${esc(o.name)}</b> ${o.current} → ${o.suggested} <span class="dim">(+${o.diff})</span></div>`).join("");
    } else {
      note.innerHTML =
        `<div class="note-head">No unspent Ancient Souls (${asFree})</div>` +
        `<div class="note-sub">Nothing is purchasable until your next transcendence. When you get AS, spend it in this order:</div>` +
        priority.map((o) => `<div class="note-buy">${o.rank}. <b>${esc(o.name)}</b> <span class="dim">(level ${o.current})</span></div>`).join("");
    }
  }
  // gilds: status, not advice — which hero holds them and how much damage they carry
  const gilded = (state.heroes || []).filter((h) => h.gilds > 0).sort((a, b) => b.gilds - a.gilds);
  const totalG = state.gilds?.total ?? 0;
  const gnote = $("gild-note");
  if (gnote) {
    gnote.textContent =
      `${totalG} gilds on ${gilded.length} hero${gilded.length === 1 ? "" : "es"}` +
      (state.gilds?.nextGildZone ? ` · next gild at zone ${state.gilds.nextGildZone}` : "") +
      (gilded.length > 1 ? " · spread out: consolidate onto your main hero." : " · consolidated, good.");
  }
  const argaiv = state.gilds?.argaivLevel ?? 0;
  const perGild = state.gilds?.perGildPercent ?? 50;
  if (gnote && argaiv > 0) {
    gnote.textContent += ` · each gild is +${perGild}% (50% base + 2% per Argaiv level, Argaiv ${argaiv}); with no Argaiv it is +50%.`;
  }
  $("gilds").innerHTML = gilded.length
    ? gilded.map((h) => {
        const gildedDps = gilded.reduce((acc, x) => acc + (x.dpsNum || 0), 0);
        const share = gildedDps > 0 ? ((h.dpsNum || 0) / gildedDps) * 100 : 0;
        return `<tr><td>${esc(h.name)}</td><td class="r">${h.gilds}</td>` +
          `<td class="r">+${(h.gilds * perGild).toFixed(0)}%</td><td class="r">${h.level}</td>` +
          `<td class="r">${share ? share.toFixed(1) + "%" : "—"}</td></tr>`;
      }).join("")
    : `<tr><td colspan="5" class="dim">no gilds</td></tr>`;

  // relics: only the stats that match ancients you actually own
  const relics = state.relicsDetail || [];
  const owned = new Set((state.ancients || []).filter((a) => a.level > 0).map((a) => shortName(a.name)));
  const relevant = relics.map((r) => ({
    ...r,
    kept: (r.bonuses || []).filter((b) => b.ancientName && owned.has(shortName(b.ancientName))),
  }));
  const usable = relevant.filter((r) => r.kept.length);
  const rnote = $("relic-note");
  if (rnote) {
    rnote.textContent = relics.length
      ? `${relics.length} relic${relics.length === 1 ? "" : "s"} · ${usable.length} with bonuses your ancients use`
      : "no relics yet";
  }
  $("relics").innerHTML = usable.length
    ? usable.map((r) =>
        `<tr><td>${esc(r.name)}<div class="sub2">${r.kept.map((b) => `${esc(b.ancientName)}: ${esc(b.description)}`).join("<br>")}</div></td>` +
        `<td class="r">${r.level}</td><td class="r rar r${r.rarity}">${RARITY[r.rarity] ?? r.rarity}</td></tr>`).join("")
    : `<tr><td colspan="3" class="dim">${relics.length ? "none of your relics boost an ancient you own" : "no relics"}</td></tr>`;

  $("outsiders").innerHTML = outs
    .map((o, i) => {
      const color = o.diff > 0 ? "color:var(--accent)" : "";
      const orank = o.rank ?? "–";
      return `<tr><td class="rank ${i === 0 && o.diff > 0 ? "top" : ""}">${orank}</td><td>${esc(o.name)}</td>` +
        `<td class="r">${o.current}</td><td class="r">${o.suggested}</td>` +
        `<td class="r" style="${color}">${o.diff > 0 ? "+" + o.diff : (o.diff || "")}</td></tr>`;
    })
    .join("");

  // Show every hero (the tab scrolls): the advised hero was being cut off by a
  // 16-row cap because the list is ordered by DPS, not by progression.
  const sortBy = $("hero-sort")?.value || "game";
  const costNum = (h) => Number(h.nextLevelCost) || 0;
  const comparators = {
    game: (a, b) => a.id - b.id,
    dps: (a, b) => b.dpsNum - a.dpsNum,
    "cost-asc": (a, b) => costNum(a) - costNum(b),
    "cost-desc": (a, b) => costNum(b) - costNum(a),
    level: (a, b) => (b.level - a.level) || (a.id - b.id),
    gilds: (a, b) => (b.gilds - a.gilds) || (a.id - b.id),
  };
  $("heroes").innerHTML = state.heroes
    .slice()
    .sort(comparators[sortBy] || comparators.game)
    .map(
      (h) =>
        `<tr><td class="${h.gilds ? "gilded" : ""}">${esc(h.name)}${h.gilds ? ` <span class="gmark">+${h.gilds}</span>` : ""}</td>` +
        `<td class="r">${h.gilds ? `+${(h.gilds * (state.gilds?.perGildPercent ?? 50))}%` : "—"}</td>` +
        `<td class="r">${h.level}</td><td class="r">${short(h.nextLevelCost)}</td>` +
        `<td class="r">${short(h.dps)}</td></tr>`,
    )
    .join("");

  const ma = payload.advice?.mercs;
  const mblock = $("merc-advice");
  if (mblock) {
    mblock.innerHTML = ma
      ? `<div class="note-head">${esc(ma.action)}</div><div class="note-sub">${esc(ma.detail)}</div>` +
        (ma.why ? `<div class="note-sub"><i>${esc(ma.why)}</i></div>` : "")
      : "";
  }

  $("mercs").innerHTML = state.mercs
    .map(
      (m) =>
        `<tr><td>${esc(m.name)}</td><td class="r rar r${m.rarity}">${RARITY[m.rarity] ?? m.rarity}</td><td class="r">${m.level}</td>` +
        `<td class="r">${m.dead ? "failed" : m.onQuest ? dur(m.questRemaining) : "—"}</td>` +
        `<td class="r">${m.dead ? '<span class="dead">dead</span>' : dur(m.timeToDie)}</td></tr>`,
    )
    .join("");

  const ver = payload.suggest?.version || payload.version || "?";
  if ($("appver")) $("appver").textContent = "v" + ver;
  if ($("brandver")) $("brandver").textContent = "v" + ver;

  // Update check: silent unless a newer release exists (works once public).
  if ($("update") && !window.__updateChecked) {
    window.__updateChecked = true;
    fetch("https://api.github.com/repos/GeeNuTz/clicker-heroes-companion/releases/latest", { headers: { accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((rel) => {
        if (!rel?.tag_name) return;
        const latest = String(rel.tag_name).replace(/^v/, "");
        const cmp = (a, b) => {
          const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
          for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
          return 0;
        };
        if (cmp(latest, String(ver)) > 0) {
          $("update").innerHTML = ` · <a href="${rel.html_url}" target="_blank" style="color:var(--accent)">update v${latest}</a>`;
        }
      })
      .catch(() => {});
  }

  const asc = payload.ascensions || [];
  const sum = $("asc-summary");
  if (sum) {
    sum.textContent = asc.length
      ? `Ascension log: ${asc.length} rows · last #${asc[asc.length - 1].n} HZE ${asc[asc.length - 1].hze} (+${asc[asc.length - 1].hs.toLocaleString()}) · best HZE ${Math.max(...asc.map((a) => a.hze))}`
      : "No ascension log yet — game: Ascensions → Export, paste the CSV in Settings.";
  }

  const age = payload.saveAgeSeconds;
  $("stamp").textContent = age == null
    ? new Date(payload.at).toLocaleTimeString()
    : `save ${age < 90 ? Math.round(age) + "s" : Math.round(age / 60) + "m"} old`;
  if (payload.stale) {
    $("warnings").innerHTML += `<div class="warn">⚠ save has not changed in ${Math.round(age / 60)}m — the game may be paused, or you are looking at an older snapshot</div>`;
  }
  $("src").textContent = payload.savePath?.split("/").slice(-1)[0] || "";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// tabs
document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
  });
});

document.getElementById("btn-reload").addEventListener("click", () => location.reload());
document.getElementById("btn-close").addEventListener("click", () => {
  if (window.chOverlay?.quit) window.chOverlay.quit();
  else window.close();
});

document.getElementById("hero-sort")?.addEventListener("change", () => {
  if (window.__lastPayload) render(window.__lastPayload);
});
document.getElementById("btn-min").addEventListener("click", () => {
  if (window.chOverlay?.minimize) window.chOverlay.minimize();
  else document.body.classList.toggle("mini"); // browser fallback
});

const THEMES = ["dark", "light", "aetheris", "comfy", "sapphire"];
function dur(seconds) {
  const s = Math.abs(Math.round(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
const shortName = (n) => String(n || "").split(",")[0].trim();
const RARITY = { 0: "Common", 1: "Common", 2: "Uncommon", 3: "Rare", 4: "Epic", 5: "Legendary", 6: "Mythic" };

function applyLook(cfg) {
  if (!cfg) return;
  for (const t of THEMES) document.body.classList.toggle(`theme-${t}`, (cfg.theme || "dark") === t);
  document.body.classList.toggle("light", cfg.theme === "light");
  document.body.dataset.font = cfg.fontFamily || "sans";
  document.body.classList.toggle("compact", cfg.density === "compact");
  const z = Number(cfg.fontScale) || 1;
  if (window.chOverlay?.setZoom) window.chOverlay.setZoom(z);
  else document.body.style.zoom = z;
}

// self-test: ?selftest=minimize exercises preload -> IPC -> win.minimize()
if (new URLSearchParams(location.search).get("selftest") === "minimize") {
  setTimeout(() => window.chOverlay?.minimize(), 2500);
}

// self-check: title tells us whether the Electron bridge loaded
document.title = window.chOverlay ? "Clicker Heroes Companion [ipc]" : "Clicker Heroes Companion [no-ipc]";

// SSE with reconnect + stall watchdog: a frozen panel is worse than a reload.
let watchdogTimer = null;
function armWatchdog() {
  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    console.warn("no update for 40s — reloading");
    location.reload();
  }, 40000);
}

function connectStream() {
  try {
    const es = new EventSource("/events");
    es.onmessage = () => armWatchdog();
    es.onerror = () => {
      es.close();
      setTimeout(connectStream, 2000);
    };
  } catch {
    setTimeout(connectStream, 3000);
  }
}

// settings panel
async function loadSettingsPanel() {
  try {
    const r = await fetch("/api/settings");
    const j = await r.json();
    if (!j.ok) { $("set-status").textContent = j.error || "settings unreadable"; return; }
    const s = j.settings;
    $("set-build").value = s.build || "idle";
    if ($("set-theme")) $("set-theme").value = s.theme || "dark";
    if ($("set-savepath")) $("set-savepath").value = s.savePath || "";
    if ($("set-lasttrans")) $("set-lasttrans").value = s.lastTranscensionSouls || 0;
    if ($("set-asclog")) $("set-asclog").value = s.ascensionLog || "";
    if ($("set-fontfamily")) $("set-fontfamily").value = s.fontFamily || "sans";
    if ($("set-density")) $("set-density").value = s.density || "comfortable";
    if ($("set-font")) { $("set-font").value = s.fontScale || 1; $("font-val").textContent = (s.fontScale || 1).toFixed(2) + "x"; }
    $("set-json").value = JSON.stringify({ weights: s.weights, outsiderWeights: s.outsiderWeights }, null, 2);
  } catch (e) {
    $("set-status").textContent = "settings request failed";
  }
}
document.getElementById("set-font").addEventListener("input", (e) => {
  const z = Number(e.target.value);
  $("font-val").textContent = z.toFixed(2) + "x";
  if (window.chOverlay?.setZoom) window.chOverlay.setZoom(z);
  else document.body.style.zoom = z;
});

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  try {
    const body = JSON.parse($("set-json").value);
    body.build = $("set-build").value;
    body.theme = $("set-theme").value;
    body.fontFamily = $("set-fontfamily").value;
    body.savePath = ($("set-savepath").value || "").trim();
    body.lastTranscensionSouls = Number($("set-lasttrans").value || 0);
    body.ascensionLog = ($("set-asclog").value || "").trim();
    body.density = $("set-density").value;
    body.fontScale = Number($("set-font").value);
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    $("set-status").textContent = j.ok ? "saved" : "error: " + j.error;
  } catch (e) {
    $("set-status").textContent = "invalid JSON";
  }
});
document.getElementById("btn-check-update")?.addEventListener("click", async () => {
  $("set-status").textContent = "checking for updates…";
  if (!window.chOverlay?.checkUpdate) {
    $("set-status").textContent = "updates need the desktop app";
    return;
  }
  const r = await window.chOverlay.checkUpdate();
  if (r.ok && r.version) {
    $("set-status").textContent = `update ${r.version} available — downloading`;
    return;
  }
  if (r.ok) {
    $("set-status").textContent = "already up to date";
    return;
  }
  // Dev checkout: the packaged updater is not present, so point at Releases.
  try {
    const rel = await (await fetch("https://api.github.com/repos/GeeNuTz/clicker-heroes-companion/releases/latest")).json();
    $("set-status").innerHTML = rel?.tag_name
      ? `latest release ${rel.tag_name} — <a href="${rel.html_url}" target="_blank" style="color:var(--accent)">download</a> (dev copies update with bin/ch-update)`
      : "update check failed: " + r.error;
  } catch {
    $("set-status").textContent = "update check failed: " + r.error;
  }
});

document.getElementById("btn-install-update")?.addEventListener("click", async () => {
  if (!window.chOverlay?.installUpdate) return;
  const r = await window.chOverlay.installUpdate();
  if (!r.ok) $("set-status").textContent = "install failed: " + r.error;
});

document.getElementById("btn-reset-settings").addEventListener("click", async () => {
  const defaults = {
    build: "idle", theme: "dark", fontScale: 1.15, mercFocus: "ruby",
    weights: { Siyalatas: 1, Libertas: 0.9, Mammon: 0.8, Mimzee: 0.35, Dora: 0.4, Fortuna: 0.15,
      Atman: 2, Kumawakamaru: 2.5, Argaiv: 0.8, Morgulis: 1, Nogardnit: 0.3, Solomon: 1.5,
      Dogcog: 0.5, Chronos: 0.25, Bubos: 0.3, Revolc: 0.1,
      Fragsworth: 0.9, Bhaal: 0.7, Pluto: 0.5, Juggernaut: 0.6, Vaagur: 0.3, Chawedo: 0.2,
      Hecatoncheir: 0.2, Berserker: 0.2, Sniperino: 0.2, Kleptos: 0.2, Energon: 0.2 },
    outsiderWeights: { Xyliqil: 0.25, "Chor'gorloth": 0.6, Phandoryss: 1, Borb: 0.5, Ponyboy: 1.4,
      Rhageist: 0.5, "K'Ariqua": 0.4, Orphalas: 0.3, "S-Akhan": 0.4, "Sen-Akhan": 0.4 },
  };
  await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(defaults) });
  $("set-status").textContent = "settings reset";
  await loadSettingsPanel();
});

// ---- save conversion -------------------------------------------------
const saveStatus = (t) => { const el = $("save-status"); if (el) el.textContent = t; };

document.getElementById("btn-export-save").addEventListener("click", async () => {
  const platform = $("save-platform").value;
  saveStatus("reading save…");
  const r = await fetch(`/api/save/export?platform=${platform}`);
  const j = await r.json();
  if (!j.ok) return saveStatus("error: " + j.error);
  const name = platform === "mobile" ? "playerSaveData-mobile.txt" : "playerSaveData-pc.txt";
  if (window.chOverlay?.exportSave) {
    const out = await window.chOverlay.exportSave({ text: j.text, defaultName: name });
    saveStatus(out.ok ? "exported to " + out.path : out.canceled ? "cancelled" : "export failed");
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([j.text], { type: "text/plain" }));
    a.download = name;
    a.click();
    saveStatus("downloaded " + name);
  }
});

document.getElementById("btn-open-save").addEventListener("click", async () => {
  if (!window.chOverlay?.openSave) return saveStatus("file picker needs the desktop app");
  const out = await window.chOverlay.openSave();
  if (!out.ok) return saveStatus(out.canceled ? "cancelled" : "open failed");
  $("save-text").value = out.text;
  saveStatus("loaded " + out.path);
});

document.getElementById("btn-use-save").addEventListener("click", async () => {
  const text = $("save-text").value.trim();
  if (!text) return saveStatus("paste a save first");
  const r = await fetch("/api/save/use", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  saveStatus(j.ok ? `loaded pasted save (zone ${j.zone}) — read-only` : "error: " + j.error);
});

document.getElementById("btn-live-save").addEventListener("click", async () => {
  const r = await fetch("/api/save/clear", { method: "POST" });
  const j = await r.json();
  saveStatus(j.ok ? "back to the live save" : "error");
});

document.getElementById("btn-convert-save").addEventListener("click", async () => {
  const text = $("save-text").value.trim();
  if (!text) return saveStatus("paste a save or open a file first");
  const target = $("save-target").value;
  const r = await fetch("/api/save/convert", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, platform: target }),
  });
  const j = await r.json();
  if (!j.ok) return saveStatus("error: " + j.error);
  saveStatus(`converted from ${j.from} to ${target} (zone ${j.zone})`);
  if (window.chOverlay?.exportSave) {
    const out = await window.chOverlay.exportSave({ text: j.text, defaultName: `playerSaveData-${target}.txt` });
    if (out.ok) saveStatus("saved to " + out.path);
  }
});

document.getElementById("btn-install-save").addEventListener("click", async () => {
  const text = $("save-text").value.trim();
  if (!text) return saveStatus("paste a save or open a file first");

  const st = await (await fetch("/api/game/status")).json();
  let closeGame = false;
  if (st.running) {
    if (!confirm(
      "Clicker Heroes is running.\n\n" +
      "It will be CLOSED now so it cannot overwrite the imported save on its next autosave.\n\n" +
      "Close the game and install?",
    )) return saveStatus("cancelled — close the game yourself and retry");
    closeGame = true;
  }
  if (!confirm("Overwrite the live save? A timestamped backup is written first.")) return;

  saveStatus(closeGame ? "closing game…" : "installing…");
  const r = await fetch("/api/save/install", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, confirm: true, closeGame }),
  });
  const j = await r.json();
  saveStatus(j.ok ? `installed. backup: ${j.backup}` : "error: " + j.error);
});

document.getElementById("btn-reload-save").addEventListener("click", async () => {
  $("set-status").textContent = "reloading save…";
  try {
    const r = await fetch("/api/reload", { method: "POST" });
    const j = await r.json();
    $("set-status").textContent = j.ok ? `save reloaded (${Math.round(j.saveAgeSeconds)}s old)` : "error: " + j.error;
  } catch (e) {
    $("set-status").textContent = "reload failed";
  }
});
loadSettingsPanel();

// data
async function first() {
  try {
    const r = await fetch("/api/state");
    const p = await r.json();
  window.__lastPayload = p;
    if (p.ok) render(p);
    else $("next-title").textContent = "save error: " + (p.error || "unknown");
  } catch (e) {
    $("next-title").textContent = "overlay server unreachable";
  }
}
first();

const es = new EventSource("/events");
es.onopen = () => {
  $("dot").classList.replace("off", "on");
  armWatchdog();
};
es.onerror = () => {
  $("dot").classList.replace("on", "off");
};
es.onmessage = (ev) => {
  armWatchdog();
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") render(msg.payload);
    else if (msg.type === "error") $("next-title").textContent = "save error: " + msg.error;
    // "ping" keeps the watchdog fed without redrawing
  } catch {}
};
