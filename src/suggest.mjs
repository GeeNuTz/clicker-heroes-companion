// Suggestion engine: current vs suggested for ancients and outsiders.
//
// Both use one idea: buy the next level of whatever gives the most effect per
// unit of currency, never past an effect cap, and never without a budget.
// The weights below say how much a +1% of each stat is worth; they are the
// only editorial part and live in settings.json so they can be tuned.
import fs from "node:fs";
import Decimal from "decimal.js";
import { ancientBonus, ancientCostBetween, gameData, shortName } from "./engine.mjs";
import { ANCIENT_MAX_LEVEL, tpPercent } from "./strategy.mjs";
import { allocate as allocateOutsiders } from "./outsiders.mjs";
import { utilityTargets } from "./nua.mjs";

const D = (v) => new Decimal(v ?? 0);

export const DEFAULT_SETTINGS = {
  build: "idle", // idle | active | hybrid
  theme: "dark", // dark | light | aetheris | comfy | sapphire
  fontFamily: "sans", // sans | mono | serif
  density: "comfortable", // comfortable | compact
  savePath: "", // explicit save file (blank = auto-detect Steam/PC)
  lastTranscensionSouls: 0,
  ascensionLog: "",
  transcensionLog: "", // CSV from the game's Transcensions → Export // CSV pasted from the game's Ascensions window (Export) // HS your previous transcension ended with (0 = unknown)
  fontScale: 1.15, // 0.9 - 1.6, applied as page zoom
  weights: {
    // idle core
    Siyalatas: 1.0,
    Libertas: 0.9,
    Mammon: 0.8,
    Mimzee: 0.35,
    Dora: 0.4,
    Fortuna: 0.15,
    Atman: 2.0,
    Kumawakamaru: 2.5,
    Argaiv: 0.8,
    Morgulis: 1.0,
    Nogardnit: 0.3,
    Solomon: 1.5,
    // useful but secondary
    Dogcog: 0.5, // cheaper hero levels -> more DPS per gold
    Chronos: 0.25, // boss timer -> fewer "failures"
    Bubos: 0.3, // less boss HP
    Revolc: 0.1, // double rubies
    // active-only (weight 0 for idle builds)
    Fragsworth: 0.9,
    Bhaal: 0.7,
    Pluto: 0.5,
    Juggernaut: 0.6,
    Vaagur: 0.3,
    Chawedo: 0.2,
    Hecatoncheir: 0.2,
    Berserker: 0.2,
    Sniperino: 0.2,
    Kleptos: 0.2,
    Energon: 0.2,
  },
  outsiderWeights: {
    Xyliqil: 0.25,
    "Chor'gorloth": 0.6,
    Phandoryss: 1.0,
    Borb: 0.5,
    Ponyboy: 1.4,
    Rhageist: 0.5,
    "K'Ariqua": 0.4,
    Orphalas: 0.3,
    "Sen-Akhan": 0.4,
  },
};

/** settings.json next to the repo root, falling back to defaults. */
export function loadSettings() {
  try {
    const file = process.env.CH_SETTINGS_FILE || new URL("../settings.json", import.meta.url);
    const raw = fs.readFileSync(file, "utf8");
    const user = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...user,
      weights: { ...DEFAULT_SETTINGS.weights, ...(user.weights || {}) },
      outsiderWeights: { ...DEFAULT_SETTINGS.outsiderWeights, ...(user.outsiderWeights || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const defsByName = (() => {
  const out = {};
  for (const def of Object.values(gameData().ancients)) {
    if (!def.nonTranscendent) out[shortName(def.name)] = def;
  }
  return out;
})();

/** Outsider bonuses by id, in the shape ancientBonus() expects. */
function outsiders(state) {
  const byId = (id) => D(state.outsiders.find((o) => Number(o.id) === id)?.bonus ?? 0);
  return {
    idleBonus: byId(1),
    ancientCostPercent: byId(2),
    ancientSoulDamageBonus: byId(3),
    solomonPercent: byId(5),
    kumaBonus: byId(6),
    atmanBonus: byId(7),
    bubosBonus: byId(8),
    chronosBonus: byId(9),
    doraBonus: byId(10),
  };
}

/** Effect of `name` at `level` as a multiplier. */
function effect(name, level, state, spent = 0) {
  const def = defsByName[name];
  if (!def) return D(1);
  const raw = ancientBonus(def, D(level), outsiders(state)).toNumber();

  switch (name) {
    case "Kumawakamaru": {
      const perZone = Math.max(2, 10 - raw);
      return new Decimal(10).dividedBy(perZone);
    }
    case "Mimzee":
      return new Decimal(1 + (raw / 100) * 0.05);
    case "Dora":
      return new Decimal(1 + (raw / 100) * 0.1);
    case "Fortuna":
      return new Decimal(1 + (raw / 100) * 0.02);
    case "Atman":
      return new Decimal(1 + (raw / 100) * 1.5);
    case "Solomon":
      return new Decimal(1 + raw / 100);
    case "Morgulis": {
      // Souls spent on Morgulis stop contributing +10% each.
      const remaining = Math.max(0, state.resources.heroSouls - spent);
      const pool = remaining * 10;
      return new Decimal(1 + (raw + pool) / 100);
    }
    default:
      return new Decimal(1 + raw / 100);
  }
}

function weightsFor(settings, state) {
  const w = { ...(settings?.weights || DEFAULT_SETTINGS.weights) };
  if ((settings?.build || "idle") !== "active") {
    for (const k of ["Fragsworth", "Bhaal", "Pluto", "Juggernaut", "Vaagur", "Chawedo",
      "Hecatoncheir", "Berserker", "Sniperino", "Kleptos", "Energon"]) w[k] = 0;
  }
  if ((settings?.build || "idle") === "active") {
    for (const k of ["Siyalatas", "Libertas", "Nogardnit"]) w[k] = 0;
  }
  // Kibble's new-player guide: before the first transcendence only these four
  // are worth buying — everything else is delayed until after it.
  if ((state.zone?.transcensions ?? 0) === 0) {
    const allowed = new Set(["Siyalatas", "Libertas", "Mammon", "Mimzee"]);
    for (const k of Object.keys(w)) if (!allowed.has(k)) w[k] = 0;
  }
  return w;
}

/** Current vs suggested ancient levels for the souls you actually hold. */
export function ancientSuggestions(state, settings = DEFAULT_SETTINGS) {
  const budget = D(state.resources.heroSouls);
  const chor = state.outsiders.find((o) => Number(o.id) === 2);
  const costMult = chor ? new Decimal(1).minus(D(chor.bonus).times(0.01)) : D(1);
  const weights = weightsFor(settings, state);

  const current = new Map(state.ancients.map((a) => [a.name, a.level]));

  // Closed-form targets for the utility ancients (grace's calculator). Buying
  // past these is wasted souls, so the greedy solver stops there.
  const siya = current.get("Siyalatas") ?? 0;
  const frag = current.get("Fragsworth") ?? 0;
  const build = settings?.build || "idle";
  const mainDamage = build === "active" ? frag : siya;
  const targets = utilityTargets({ m: Math.max(1, mainDamage), tp: 0.021, hpScale: 1.145 });
  const levels = new Map(current);
  const spentName = new Map();
  const order = new Map();

  let spent = D(0);
  let guard = 0;
  // Hard time budget: an unbounded greedy over Decimal math took ~20 s and
  // blocked the whole server. A slightly conservative plan beats a frozen app.
  const deadline = Date.now() + 250;
  while (guard++ < 5000) {
    if ((guard & 15) === 0 && Date.now() > deadline) break;
    let best = null;
    for (const [name, def] of Object.entries(defsByName)) {
      const lvl = D(levels.get(name) ?? 0);
      const cap = ANCIENT_MAX_LEVEL[name];
      if (cap && lvl.gte(cap)) continue;
      if (!weights[name]) continue;

      const utilityTarget = targets[name];
      if (utilityTarget !== undefined && lvl.gte(utilityTarget)) continue;
      const cost = ancientCostBetween(def, lvl, lvl.plus(1), costMult);
      if (cost.lte(0)) continue;
      if (spent.plus(cost).gt(budget)) continue;

      // The soul being spent stops contributing to the pool, so evaluate the
      // "after" state with it already gone.
      const gain = effect(name, lvl.plus(1).toNumber(), state, spent.plus(cost).toNumber())
        .dividedBy(effect(name, lvl.toNumber(), state, spent.toNumber()))
        .minus(1)
        .toNumber();
      if (!(gain > 0)) continue;

      const eff = (gain * weights[name]) / cost.toNumber();
      if (!best || eff > best.eff) best = { name, eff, cost, lvl };
    }
    if (!best) break;

    levels.set(best.name, best.lvl.plus(1).toNumber());
    spentName.set(best.name, (spentName.get(best.name) ?? 0) + 1);
    if (!order.has(best.name)) order.set(best.name, order.size + 1);
    spent = spent.plus(best.cost);
  }

  return Object.keys(defsByName).map((name) => {
    const cur = current.get(name) ?? 0;
    const sug = levels.get(name) ?? cur;
    return {
      name,
      current: cur,
      suggested: sug,
      diff: sug - cur,
      cost: (spentName.get(name) ?? 0) > 0 ? str0(spentName.get(name)) : "0",
      rank: order.get(name) ?? null,
      skip: !weights[name],
      maxed: !!(ANCIENT_MAX_LEVEL[name] && cur >= ANCIENT_MAX_LEVEL[name]),
      target: targets[name] ?? null,
      over: targets[name] !== undefined ? Math.max(0, cur - targets[name]) : 0,
    };
  });
}

/** Outsider targets from the drei calculator port. */
export function outsiderSuggestions(state, settings = DEFAULT_SETTINGS) {
  const defs = Object.values(gameData().outsiders);
  const current = new Map(state.outsiders.map((o) => [Number(o.id), o]));
  const totalAS = state.outsiders.reduce((acc, o) => acc + (o.spent ?? 0), 0) +
    Number(state.resources.ancientSouls || 0);
  const tp = tpPercent(Number(state.resources.ancientSoulsTotal || 0)) / 100;

  const targets = allocateOutsiders({
    ancientSouls: totalAS,
    transcendentPower: tp,
    zone: state.zone.hzePersist || state.zone.current,
  });

  const targetFor = (def) => {
    const id = Number(def.id);
    if (def.name === "Borb") return id === 6 ? targets.Borb : 0;
    return targets[def.name] ?? 0;
  };

  const rows = defs.map((def) => {
    const id = Number(def.id);
    const cur = current.get(id)?.level ?? 0;
    const target = targetFor(def);
    const sug = Math.max(cur, target); // outsiders cannot be respecced
    return {
      id,
      name: def.name === "Borb"
        ? (id === 6 ? "Borb (Kumawakamaru)" : "Borb (max primal souls)")
        : def.name,
      current: cur,
      suggested: sug,
      diff: sug - cur,
      target,
      over: Math.max(0, cur - target),
      maxLevel: def.maxLevel,
    };
  });

  const order = rows.filter((r) => r.diff > 0).sort((a, b) => b.diff - a.diff);
  const rankOf = new Map(order.map((r, i) => [r.id, i + 1]));
  return rows.map((r) => ({ ...r, rank: rankOf.get(r.id) ?? null }));
}

function str0(n) {
  return String(n ?? 0);
}
