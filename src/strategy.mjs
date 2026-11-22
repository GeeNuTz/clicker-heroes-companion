// Progression rules, transcribed from the Clicker Heroes community bot
// (McNiibot, Playsaurus) so the plan matches what the community actually does
// rather than a pure stat optimizer.
//
// Rules encoded here:
//  - Ascend at zone 130 or on the first boss failure, whichever comes later.
//  - First 300 zones: only Siyalatas + Libertas (idle). Level them equally and
//    only while HS > nextLevelCost * currentLevel.
//  - At zone 300: first transcendence.
//  - After that: ascend until HS beats the previous transcension's HS, then
//    three more ascensions, then transcend again (until ~24% TP).
//  - Do not touch gilds in the first two ascensions; then open all at once.
import Decimal from "decimal.js";
import { ancientCostBetween, gameData, shortName } from "./engine.mjs";

const D = (v) => new Decimal(v ?? 0);

export const RULES = {
  firstAscensionZone: 130,
  firstTranscensionZone: 300,
  tpUseCalculator: 24, // % TP where the bot says to switch to the outsider calc
  bossTimerBase: 30,
  bossTimerLossPer500: 2,
};

/** Boss timer shrinks by 2s every 500 zones (McNiibot: zone stat changes). */
export function bossTimer(zone) {
  return Math.max(5, RULES.bossTimerBase - RULES.bossTimerLossPer500 * Math.floor(zone / 500));
}

/** Ancient levels where the effect is maxed out. */
// McNiibot /kappa: rare centurion ("kappa") chance.
export const KAPPA = {
  chance: 0.005, // PC, per centurion (boss zone ending in 0)
  mobileChance: 0.004,
  holidayMultiplier: 0.5,
  minZone: 1000, // centurions up to 1000 cannot be kappa
  centurionEvery: 10,
};

/** Expected zones cleared per kappa at the given chance. */
export function kappaExpectedZones(chance = KAPPA.chance) {
  return Math.round(KAPPA.centurionEvery / chance);
}

export const ANCIENT_MAX_LEVEL = {
  Chronos: 1101,
  Vaagur: 1440,
  Kumawakamaru: 1498,
  Atman: 2880,
  Dogcog: 3743,
  Revolc: 3743,
  Fortuna: 14972,
  Bubos: 18715,
  Dora: 18715,
};

/** Autoclicker shop: 1000 + 500n each, total for n = 250n(n+3). */
export function nextAutoclickerCost(owned) {
  return 1000 + 500 * owned;
}
export function autoclickerBundleCost(n) {
  return 250 * n * (n + 3);
}

export function tpPercent(ancientSoulsTotal) {
  return 25 - 23 * Math.exp(-0.0003 * (ancientSoulsTotal || 0));
}

/** 'ascend' | 'push' plus the reason, following the 130 / boss-fail rule. */
export function ascensionRule(state) {
  const zone = state.zone.current;
  const timer = bossTimer(zone);
  const failed = state.combat.bossSeconds > timer;
  const dps = Number(state.combat.effectiveIdleDps ?? 0);

  // A fresh run starts at zone 1 with no DPS: the "failed boss" check is
  // meaningless there, and hzePersist still holds the previous run's best zone.
  if (zone < RULES.firstAscensionZone) {
    return {
      action: "push",
      reason: dps > 0
        ? `You are at zone ${zone} — push to ${RULES.firstAscensionZone} before considering an ascension.`
        : `Fresh run at zone ${zone} with no damage yet — buy and level heroes first.`,
    };
  }
  if (dps <= 0) {
    return { action: "push", reason: "No damage yet — buy a hero before reading the boss timer." };
  }
  if (state.zone.hzePersist < RULES.firstAscensionZone) {
    return {
      action: "push",
      reason: `Reach zone ${RULES.firstAscensionZone} before your first ascension (you are at ${zone}).`,
    };
  }
  if (failed) {
    return {
      action: "ascend",
      reason: `Boss ${state.combat.bossZone} cannot die inside the ${timer}s timer — that is the "fail a boss" trigger, and you are past zone ${RULES.firstAscensionZone}.`,
    };
  }
  return {
    action: "push",
    reason: `Past zone ${RULES.firstAscensionZone}; ascend on the first boss you fail, not before.`,
  };
}

/** Transcendence checkpoint. */
export function transcendenceRule(state) {
  const hze = state.zone.hzePersist;
  const tp = tpPercent(state.resources.ancientSoulsTotal);

  if (hze < RULES.firstTranscensionZone) {
    return {
      ready: false,
      reason: `First transcendence happens at zone ${RULES.firstTranscensionZone}; best so far ${hze}.`,
    };
  }
  if (tp >= RULES.tpUseCalculator) {
    return { ready: null, reason: `TP is ${tp.toFixed(1)}% — past the bot's ~${RULES.tpUseCalculator}% cutoff, use the outsider calculator from here.` };
  }
  return {
    ready: true,
    reason:
      `TP ${tp.toFixed(1)}%. Keep ascending until ONE ascension pays out more hero souls than your last ` +
      `transcension ended with — that payout is the marker. Then do 3 more ascensions (4 total including ` +
      `the marker one) and transcend. This will be transcendence #${(state.zone.transcensions ?? 0) + 1}.`,
  };
}

/**
 * Ancient shopping list. Before zone 300 it is only Siya/Lib, level by level,
 * each purchase allowed only while HS > nextCost * currentLevel.
 */
export function ancientRule(state, souls) {
  const gd = gameData();
  const chor = state.outsiders.find((o) => o.name === "Chor'gorloth");
  const costMult = chor ? new Decimal(1).minus(D(chor.bonus).times(0.01)) : D(1);

  const defOf = (name) =>
    Object.values(gd.ancients).find((d) => shortName(d.name) === name && !d.nonTranscendent);

  const levelOf = (name) => D(state.ancients.find((a) => a.name === name)?.level ?? 0);
  const siyaDef = defOf("Siyalatas");
  const libDef = defOf("Libertas");

  let hs = D(souls);
  const lv = { Siyalatas: levelOf("Siyalatas"), Libertas: levelOf("Libertas") };
  const buys = [];
  const start = { ...lv };

  const tryBuy = (name, def, guardName) => {
    const lvl = lv[name];
    const cap = ANCIENT_MAX_LEVEL[name];
    if (cap && lvl.gte(cap)) return false; // effect is maxed out
    const cost = ancientCostBetween(def, lvl, lvl.plus(1), costMult);
    const guardLevel = lv[guardName];
    // The bot's threshold: HS must exceed (next cost * level).
    if (hs.lte(cost.times(guardLevel))) return false;
    hs = hs.minus(cost);
    lv[name] = lvl.plus(1);
    buys.push({ name, level: lv[name].toNumber(), cost: cost.toNumber() });
    return true;
  };

  for (let i = 0; i < 400; i++) {
    const boughtSiya = tryBuy("Siyalatas", siyaDef, "Siyalatas");
    const boughtLib = tryBuy("Libertas", libDef, "Libertas");
    if (!boughtSiya && !boughtLib) break;
  }

  const merged = [];
  for (const name of ["Siyalatas", "Libertas"]) {
    const rows = buys.filter((b) => b.name === name);
    if (!rows.length) continue;
    merged.push({
      name,
      from: start[name].toNumber(),
      level: lv[name].toNumber(),
      delta: rows.length,
      cost: rows.reduce((s, r) => s.plus(r.cost), D(0)),
    });
  }
  return { buys: merged, spent: D(souls).minus(hs), leftover: hs };
}
