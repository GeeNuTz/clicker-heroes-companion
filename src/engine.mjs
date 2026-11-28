// Clicker Heroes 1 save -> live state.
//
// Formulas ported from the open-source ClickerHeroesTracker web client
// (github.com/dfederm/ClickerHeroesTracker, WebClient/src/models/*.ts),
// which mirrors the game's own math. Numbers use decimal.js because the
// late game runs past 1e300.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_DATA_PATH = path.join(HERE, "data", "gamedata.json");

const BP_TABLE = JSON.parse(
  fs.readFileSync(new URL("./data/bp-table.json", import.meta.url), "utf8"),
).rows;

/** Current and next TP breakpoint for a given Ancient Soul count. */
export function breakpoints(ancientSouls) {
  let cur = BP_TABLE[0];
  let next = null;
  for (let i = 0; i < BP_TABLE.length; i++) {
    if (ancientSouls >= BP_TABLE[i].as) {
      cur = BP_TABLE[i];
      next = BP_TABLE[i + 1] ?? null;
    } else break;
  }
  return { current: cur, next, toNext: next ? next.as - ancientSouls : 0 };
}

/**
 * Monsters per zone — from drei's CH-instakill calculator.
 * Base 10, +0.1 per 500 zones, reduced by Kuma (and Borb scaling that reduction).
 * This is why "fewer monsters per zone" = faster: speed is mpz-bound, not DPS-bound.
 */
export function monstersPerZone(zone, kumaLevel = 0, borbLevel = 0) {
  const kumaEffect = 8 * (1 - Math.exp(-0.025 * kumaLevel));
  const reduction = kumaEffect * (1 + borbLevel / 8);
  return Math.max(1, Math.floor(zone / 500) / 10 + 10 - reduction);
}

/** Boss HP growth scale for the current AS tier (1.145 at 0 AS). */
export function hpScale(ancientSouls) {
  return breakpoints(ancientSouls).current.hpScale ?? 1.145;
}

let _gamedata = null;
export function gameData() {
  if (!_gamedata) _gamedata = JSON.parse(fs.readFileSync(GAME_DATA_PATH, "utf8"));
  return _gamedata;
}

const D = (v) => new Decimal(v ?? 0);
const num = (v) => (v == null ? 0 : Number(v));

// ---------------------------------------------------------------- ancients

const LIB_SIYA_TABLE = [
  { threshold: 10, minus: 0, times: 25, plus: 0 },
  { threshold: 20, minus: 9, times: 24, plus: 225 },
  { threshold: 30, minus: 19, times: 23, plus: 465 },
  { threshold: 40, minus: 29, times: 22, plus: 695 },
  { threshold: 50, minus: 39, times: 21, plus: 915 },
  { threshold: 60, minus: 49, times: 20, plus: 1125 },
  { threshold: 70, minus: 59, times: 19, plus: 1325 },
  { threshold: 80, minus: 69, times: 18, plus: 1515 },
  { threshold: 90, minus: 79, times: 17, plus: 1695 },
  { threshold: 100, minus: 89, times: 16, plus: 1865 },
  { threshold: null, minus: 99, times: 15, plus: 2025 },
];

/** "linear", "linear5", "linear0_25", "linear01" -> per-level amount. */
function linearAmount(formula, level) {
  let suffix = formula.slice("linear".length);
  if (suffix[0] === "0" && suffix[1] !== "_") suffix = "0." + suffix;
  suffix = suffix.replace("_", ".");
  return D(level).times(Number(suffix || 1));
}

/** "percent5" -> (1 - 0.95^level) * 100 ... a diminishing "take N% off" curve. */
function percentAmount(formula, level) {
  const pct = Number(formula.slice("percent".length));
  const keep = 1 - pct / 100;
  return new Decimal(1).minus(new Decimal(keep).pow(D(level))).times(100);
}

function diminishingReturns(def, level) {
  const [p1, p2] = String(def.levelAmountParams || "0,0").split(",").map(Number);
  return D(p1 * (1 - Math.exp(p2 * num(level))));
}

/**
 * Ancient effect value in the unit its effectDescription uses (percent, flat...).
 * `outsiders` is the bonus bag from outsiderBonuses().
 */
export function ancientBonus(def, level, outsiders) {
  const f = def.levelAmountFormula;
  if (f.startsWith("linear")) return linearAmount(f, level);
  if (f.startsWith("percent")) return percentAmount(f, level);

  switch (f) {
    case "libAndSiy": {
      const x = D(outsiders.idleBonus).times(0.01).plus(1);
      for (const v of LIB_SIYA_TABLE) {
        if (v.threshold === null || D(level).lt(v.threshold)) {
          return D(level)
            .minus(v.minus)
            .times(v.times)
            .plus(v.plus)
            .times(x);
        }
      }
      break;
    }
    case "diminishingReturns":
      return diminishingReturns(def, level);
    case "atmanValue":
      return diminishingReturns(def, level).times(D(outsiders.atmanBonus).times(0.01).plus(1));
    case "bubosValue":
      return diminishingReturns(def, level).times(D(outsiders.bubosBonus).times(0.01).plus(1));
    case "chronosValue":
      return diminishingReturns(def, level).times(D(outsiders.chronosBonus).times(0.01).plus(1));
    case "doraValue":
      return diminishingReturns(def, level).times(D(outsiders.doraBonus).times(0.01).plus(1));
    case "kumaValue":
      return diminishingReturns(def, level).times(D(outsiders.kumaBonus).times(0.01).plus(1));
    case "nogardnitValue":
      return D(level).times(10).times(D(outsiders.idleBonus).times(0.01).plus(1));
    case "solomonRewards":
      // Solomon: +5% primal souls per level.
      return D(level).times(5);
    default:
      return D(0);
  }
}

/** Cumulative souls needed to reach `level` (cost of levels 1..level). */
export function ancientCostAtLevel(def, level) {
  const n = D(level);
  switch (def.levelCostFormula) {
    case "one":
      return n;
    case "linear":
      return n.times(n.plus(1)).dividedBy(2);
    case "polynomial1_5": {
      if (n.gt(100)) {
        // Closed-form approximation used by the tracker above level 100.
        return new Decimal(2)
          .div(5)
          .times(n.pow(new Decimal(5).div(2)))
          .plus(new Decimal(1).div(2).times(n.pow(new Decimal(3).div(2))))
          .plus(new Decimal(1).div(8).times(n.pow(new Decimal(1).div(2))))
          .plus(new Decimal(1).div(1920).times(n.pow(new Decimal(-3).div(2))))
          .ceil();
      }
      let sum = new Decimal(0);
      for (let i = 1; i <= num(n); i++) sum = sum.plus(Decimal.pow(i, 1.5));
      return sum.ceil();
    }
    case "exponential":
      return Decimal.pow(2, n.plus(1)).minus(1);
    case "quadratic": {
      // Cost of level n is n^2 (Khrysos / Iris / Thusia / Juggernaut).
      return n.times(n.plus(1)).times(n.times(2).plus(1)).dividedBy(6);
    }
    default:
      return D(0);
  }
}

export function ancientCostBetween(def, from, to, costMultiplier = 1) {
  const delta = ancientCostAtLevel(def, to).minus(ancientCostAtLevel(def, from));
  return delta.times(costMultiplier).ceil();
}

// --------------------------------------------------------------- outsiders

export function outsiderBonus(def, level) {
  const f = def.levelAmountFormula;
  if (f.startsWith("linear")) return linearAmount(f, level);
  if (f.startsWith("percent")) return percentAmount(f, level);
  switch (f) {
    case "ponyboyValue":
      return D(level).pow(2).times(1000);
    case "exponential":
      return new Decimal(1.5).pow(D(level)).minus(1).times(100);
    default:
      return D(0);
  }
}

/** id -> bonus value map used by ancient formulas. */
function outsiderBonuses(outsidersById) {
  const g = gameData().outsiders;
  const lvl = (id) => D(outsidersById[id]?.level ?? 0);
  const b = (id) => outsiderBonus(g[String(id)], lvl(id));
  return {
    idleBonus: b(1), // Xyliqil
    ancientCostPercent: b(2), // Chor'gorloth
    ancientSoulDamageBonus: b(3), // Phandoryss
    solomonPercent: b(5), // Ponyboy
    kumaBonus: b(6), // Borb
    atmanBonus: b(7), // Rhageist
    bubosBonus: b(8), // K'Ariqua
    chronosBonus: b(9), // Orphalas
    doraBonus: b(10), // Sen-Akhan
  };
}

// ------------------------------------------------------------------ heroes

const BASE_ATTACK_MULTIPLIERS = {
  27: "5e-4", 28: "5e-6", 29: "5e-8", 30: "5e-10", 31: "5e-12", 32: "5e-14",
  33: "5e-16", 34: "5e-18", 35: "5e-20", 36: "5e-22", 37: "5e-24", 38: "5e-26",
  39: "5e-28", 40: "5e-30", 41: "5e-69", 42: "5e-148", 43: "5e-315", 44: "5e-660",
  45: "5e-1363", 46: "5e-2312", 47: "5e951", 48: "5e951", 49: "5e16237",
  50: "5e26699", 51: "5e40600", 52: "5e44339", 53: "5e50612", 54: "5e57546",
};

function heroBaseAttack(def) {
  if (def.id === 1) return D(0);
  const base = D(def.baseCost)
    .dividedBy(10)
    .times(Math.pow(1 - 0.0188 * Math.min(def.id, 14), def.id))
    .ceil();
  const mult = BASE_ATTACK_MULTIPLIERS[def.id] ? new Decimal(BASE_ATTACK_MULTIPLIERS[def.id]) : D(1);
  return base.times(mult);
}

function heroLevelMultiplier(def, level) {
  let value = D(1);
  const thousands = Math.min(Math.floor(level / 1000), 8);
  let blocks = Math.floor(level / 25) - thousands - 7;
  if (def.id >= 27 && def.id <= 45 && level >= 525) {
    const big = Math.min(Math.floor((level - 500) / 25), 9);
    value = value.times(new Decimal(5).pow(big));
    blocks -= big;
  }
  if (level >= 200) {
    const per1000 = def.id > 1 && def.id < 46 ? 10 : def.id === 1 ? 1 : 4.5;
    const per25 = def.id === 1 ? 1 : def.id < 46 ? 4 : 4.5;
    value = value.times(new Decimal(per1000).pow(thousands));
    value = value.times(new Decimal(per25).pow(blocks));
  }
  return value;
}

/** Cumulative gold cost of hero levels (from -> to), Dogcog applied. */
function heroCost(def, from, to, dogcogPercent) {
  const r = 1.07;
  const discount = 1 - num(dogcogPercent) / 100;
  const base = def.costFormula === "heroCostFormula46" ? D(def.baseCost) : D(def.baseCost);
  if (def.id === 1) {
    let sum = new Decimal(0);
    const upTo = Math.min(to, 15);
    for (let l = from; l < upTo; l++) sum = sum.plus(D((5 + l) * Math.pow(r, l) * discount));
    if (to > 15) sum = sum.plus(D(20 * ((Math.pow(r, to) - Math.pow(r, 15)) / (r - 1)) * discount));
    return sum.floor();
  }
  const span = new Decimal(r).pow(to).minus(new Decimal(r).pow(from));
  return base.times(span.dividedBy(r - 1)).times(discount).floor();
}

// ----------------------------------------------------------------- monster

const EARLY_BASE = 1.55;
const LATE_BASE = 1.145;
const SCALE_CHANGE = 140;
const CACHE = {};
CACHE[SCALE_CHANGE] = new Decimal(EARLY_BASE).pow(SCALE_CHANGE - 1).times(10);
CACHE[500] = new Decimal(LATE_BASE).pow(500 - SCALE_CHANGE).times(CACHE[SCALE_CHANGE]);

/** Legacy (<500 HZE non-transcendent) monster life curve. */
function oldMonsterLife(level) {
  let v;
  if (level < 140) v = new Decimal(1.6).pow(level - 1);
  else if (level < 500) v = new Decimal(1.15).pow(level - 140).times(new Decimal(1.6).pow(139).times(10));
  else v = new Decimal(1.15).pow(level - 500).times(new Decimal(1.15).pow(360).times(new Decimal(1.6).pow(139).times(10)));
  return v.times(10).plus(5).ceil();
}

export function monsterLife(level, { boss, bossLifePercent = 0, transcendent = false, hzePersist = 0, scale = null } = {}) {
  if (!transcendent && hzePersist > 500) return oldMonsterLife(level);

  let base;
  if (level <= SCALE_CHANGE) base = new Decimal(EARLY_BASE).pow(level - 1);
  else if (level <= 500) base = new Decimal(scale ?? LATE_BASE).pow(level - SCALE_CHANGE).times(CACHE[SCALE_CHANGE]);
  else {
    const bucket = Math.floor(level / 500);
    const lo = bucket * 500;
    const rate = (scale ?? LATE_BASE) + bucket * 0.001;
    const anchor = monsterLifeByFiveHundreds(lo);
    base = new Decimal(rate).pow(level - lo).times(anchor);
  }
  base = base.plus((SCALE_CHANGE - 1) * 10);
  if (boss) {
    const zoneMult = 1 + Math.floor(level / 500) * 0.04;
    const mult = Math.max(zoneMult * 10 - num(bossLifePercent), 5);
    base = base.times(mult);
  }
  return base.ceil();
}

function monsterLifeByFiveHundreds(level) {
  // Walk down to the nearest cached anchor (500 or 140) then climb in 500 steps.
  let anchorLevel = 500;
  let anchor = CACHE[500];
  let lvl = anchorLevel;
  while (lvl < level) {
    const next = Math.min(lvl + 500, level);
    const bucket = Math.floor(lvl / 500);
    const rate = LATE_BASE + bucket * 0.001;
    anchor = new Decimal(rate).pow(next - lvl).times(anchor);
    lvl = next;
  }
  return anchor;
}

// ------------------------------------------------------------------- state

/**
 * Build the full live state from a decoded save object.
 * Everything returned is plain JSON-friendly (Decimals converted via str()).
 */
export function buildState(save, opts = {}) {
  const gd = gameData();
  const now = opts.now ?? Date.now();

  const heroSouls = D(save.heroSouls);
  const outsidersById = save.outsiders?.outsiders ?? {};
  const ob = outsiderBonuses(outsidersById);

  // --- ancients
  const savedAncients = save.ancients?.ancients ?? {};
  const artificial = save.ancients?.artificiallyRaisedAncients ?? {};
  const ancients = [];
  for (const [idStr, def] of Object.entries(gd.ancients)) {
    if (def.nonTranscendent) continue;
    const owned = savedAncients[idStr];
    const level = D(num(owned?.level) + num(artificial[idStr]));
    const bonus = ancientBonus(def, level, ob);
    const nextCost = ancientCostBetween(def, level, level.plus(1), D(1).minus(D(ob.ancientCostPercent).times(0.01)));
    ancients.push({
      id: Number(idStr),
      name: shortName(def.name),
      fullName: def.name,
      level: level.toNumber(),
      bonus: bonus.toNumber(),
      effect: String(def.effectDescription || "").replace("%1", fmt(bonus)),
      nextCost: nextCost.toNumber(),
      costFormula: def.levelCostFormula,
      amountFormula: def.levelAmountFormula,
    });
  }
  const byName = Object.fromEntries(ancients.map((a) => [a.name, a]));
  const aLvl = (name) => D(byName[name]?.level ?? 0);
  const aBonus = (name) => D(byName[name]?.bonus ?? 0);

  // --- champs multipliers (stored in the save, already include upgrades)
  const allDpsMultiplier = D(save.allDpsMultiplier ?? 1);
  const soulWorldBonus = heroSouls.times(10).plus(aBonus("Morgulis")); // percent
  const phan = D(ob.ancientSoulDamageBonus).times(0.01).plus(1);

  // --- heroes
  const savedHeroes = save.heroCollection?.heroes ?? {};
  const heroes = [];
  let totalDps = D(0);
  let totalClick = D(0);
  const epicReceivedUpTo = num(save.epicHeroReceivedUpTo);
  for (const [idStr, def] of Object.entries(gd.heroes)) {
    const h = savedHeroes[idStr] ?? {};
    const level = num(h.level);
    const epicLevel = num(h.epicLevel);
    const upgradeMult = D(h.upgradeDamageMultiplier ?? 1);
    const lvlMult = heroLevelMultiplier(def, level);
    const damageMultiplier = upgradeMult.times(lvlMult);
    const base = heroBaseAttack(def);
    const epicBonus = aBonus("Argaiv").times(0.01).plus(0.5).times(epicLevel).plus(1);

    let dps = D(0);
    if (def.attackFormula === "heroAttackFormula1") {
      dps = base
        .times(level)
        .times(damageMultiplier)
        .times(allDpsMultiplier)
        .times(soulWorldBonus.times(0.01).plus(1))
        .times(phan)
        .times(epicBonus);
    }
    let click = D(0);
    if (def.clickDamageFormula === "heroClickDamageFormula1") {
      click = D(def.baseClickDamage)
        .times(level)
        .times(damageMultiplier)
        .times(allDpsMultiplier)
        .times(soulWorldBonus.times(0.01).plus(1))
        .times(phan);
    }
    totalDps = totalDps.plus(dps);
    totalClick = totalClick.plus(click);
    // Keep gilded heroes visible even at level 0 (ascension resets levels,
    // not gilds), otherwise the Heroes tab looks empty after ascending.
    if (level > 0 || epicLevel > 0) {
      heroes.push({
        id: def.id,
        name: def.name,
        level,
        epicLevel,
        dps: str(dps),
        dpsNum: dps.toNumber(),
        click: str(click),
        nextLevelCost: str(heroCost(def, level, level + 1, aBonus("Dogcog")).times(D(save.goldMultiplier ?? 1).pow(0))),
        next25Cost: str(heroCost(def, level, level + 25, aBonus("Dogcog"))),
        gilds: epicLevel,
        isGilded: epicLevel > 0,
      });
    }
  }
  heroes.sort((a, b) => b.dpsNum - a.dpsNum);

  // Power Five — a fixed set, not a ranking. Treebeast, Ivan, Brittany, The
  // Masked Samurai and The Great Forest Seer are the five heroes that stay
  // efficient to level in the early and mid game, which is why players return
  // to them after unlocking a new hero. The wiki's table gives the level each
  // one is still worth taking to (2075 / 2075 / 2075 / 2425 / 2775).
  const POWER_FIVE = [
    { id: 2, target: 2075 },
    { id: 3, target: 2075 },
    { id: 4, target: 2075 },
    { id: 7, target: 2425 },
    { id: 9, target: 2775 },
  ];
  const totalHeroDps = heroes.reduce((sum, h) => sum + h.dpsNum, 0);
  heroes.forEach((h) => {
    h.share = totalHeroDps > 0 ? (h.dpsNum / totalHeroDps) * 100 : 0;
    const idx = POWER_FIVE.findIndex((p) => p.id === h.id);
    h.powerRank = idx === -1 ? 0 : idx + 1;
  });

  const powerFive = POWER_FIVE.map((p, i) => {
    const h = heroes.find((x) => x.id === p.id);
    if (!h) return null;
    return {
      rank: i + 1,
      name: h.name,
      level: h.level,
      target: p.target,
      belowTarget: h.level < p.target,
      share: h.share,
      dps: h.dps,
      nextLevelCost: h.nextLevelCost,
      next25Cost: h.next25Cost,
      gilds: h.gilds,
    };
  }).filter(Boolean);

  // Who is actually doing the damage right now — different question from the
  // Power Five, and worth showing separately.
  const topDps = heroes
    .filter((h) => h.dpsNum > 0)
    .slice(0, 5)
    .map((h, i) => ({ rank: i + 1, name: h.name, level: h.level, share: h.share }));

  // Gilds survive an ascension even though hero levels reset to 0, so they must
  // be counted from the whole collection, not from the levelled heroes above.
  const allHeroesRaw = Object.values(save.heroCollection?.heroes ?? {});
  const gildsTotal = allHeroesRaw.reduce((sum, h) => sum + num(h?.epicLevel ?? 0), 0);

  // --- zone / boss
  const zone = num(save.currentZoneHeight ?? 1);
  const hze = num(save.highestFinishedZone);
  const hzePersist = num(save.highestFinishedZonePersist);
  const idleMult = D(aBonus("Siyalatas")).times(0.01).plus(1);
  const effectiveDps = totalDps.times(idleMult).times(D(aBonus("Nogardnit")).gt(0) ? D(1) : D(1));
  const nextBossZone = Math.ceil(zone / 5) * 5;
  const scale = hpScale(num(save.ancientSoulsTotal));
  const bossHp = monsterLife(nextBossZone, {
    boss: true,
    bossLifePercent: aBonus("Bubos"),
    transcendent: !!save.transcendent,
    hzePersist,
    scale,
  });
  const bossSeconds = effectiveDps.gt(0) ? bossHp.dividedBy(effectiveDps).toNumber() : Infinity;
  const monsterHp = monsterLife(zone, { boss: false, transcendent: !!save.transcendent, hzePersist, scale });
  const monsterSeconds = effectiveDps.gt(0) ? monsterHp.dividedBy(effectiveDps).toNumber() : Infinity;

  // --- mercs
  const mercs = Object.values(save.mercenaries?.mercenaries ?? {}).map((m) => ({
    name: m.name,
    rarity: m.rarity,
    level: m.level,
    timeToDie: m.timeToDie,
    // questResult != 0 marks a merc whose quest ended badly (dead).
    dead: (m.questResult ?? 0) !== 0,
    questResult: m.questResult ?? 0,
    // The game shows a quest countdown, not a death countdown. Remaining time is
    // lastQuestStartTime (epoch ms) + duration (seconds) - now.
    questRemaining: m.lastQuestStartTime
      ? Math.max(0, (m.lastQuestStartTime + (m.lastQuestDuration ?? 0) * 1000 - Date.now()) / 1000)
      : 0,
    onQuest: !!(m.lastQuestStartTime && m.lastQuestDuration) &&
      (m.lastQuestStartTime + (m.lastQuestDuration ?? 0) * 1000 > Date.now()),
    questDuration: m.lastQuestDuration ?? 0,
    lastQuestDuration: m.lastQuestDuration,
    lastQuestSuccessChance: m.lastQuestSuccessChance,
    lastQuestRewardType: m.lastQuestRewardType,
    lastQuestRewardQty: m.lastQuestRewardQty,
    lastQuestStartTime: m.lastQuestStartTime,
  }));

  // --- relics / items
  const relics = Object.values(save.items?.items ?? {}).map((it) => ({
    name: it.name,
    level: it.level,
    rarity: it.rarity,
  }));

  const secondsSince = (ts) => (ts ? Math.max(0, (now - num(ts)) / 1000) : null);

  return {
    meta: {
      version: save.version,
      patch: save.readPatchNumber,
      platform: save.platform,
      saveOrigin: save.__saveOrigin ?? save.saveOrigin ?? "pc",
      lastLoadTime: save.lastLoadTime,
      lastPageLoadTime: save.lastPageLoadTime,
    },
    zone: {
      current: zone,
      hze,
      hzePersist,
      pretransHze: num(save.pretranscendentHighestFinishedZone),
      currentTranscensionHze: num(save.transcendentHighestFinishedZone),
      transcendent: !!save.transcendent,
      transcensions: num(save.numberOfTranscensions),
    },
    resources: {
      gold: str(D(save.gold)),
      heroSouls: str(heroSouls),
      soulsSpentOnAncients: str(D(save.soulsSpent)),
      ancientSouls: num(save.ancientSouls),
      ancientSoulsTotal: num(save.ancientSoulsTotal),
      rubies: num(save.rubies),
      autoclickers: num(save.autoclickers) + num(save.dlcAutoclickers) + num(save.iapAutoClickers),
      immortalSouls: num(save.immortalSouls),
      primalSouls: str(D(save.primalSouls)),
      soulsBonusPercent: str(soulWorldBonus),
    },
    combat: {
      dps: str(totalDps),
      effectiveIdleDps: str(effectiveDps),
      clickDamage: str(totalClick),
      idleMultiplier: str(idleMult),
      monsterHp: str(monsterHp),
      monsterSeconds,
      bossHp: str(bossHp),
      bossZone: nextBossZone,
      bossSeconds,
      instakill: monsterSeconds <= 1 / 30,
      // Highest zone where a monster still dies within one frame.
      instakillZone: guessInstakillZone(effectiveDps, save),
      // Monsters per zone at the current zone (fewer = faster runs).
      mpz: monstersPerZone(
        zone,
        ancients.find((a) => a.name === "Kumawakamaru")?.level ?? 0,
        num(outsidersById[6]?.level ?? 0),
      ),
      // Highest boss you can actually kill inside the timer.
      bossWall: bossWallZone(effectiveDps, save, { timerFor: (z) => 30 - 2 * Math.floor(z / 500) }),
    },
    ancients,
    outsiders: Object.entries(gd.outsiders)
      .map(([id, def]) => {
        const owned = save.outsiders?.outsiders?.[id];
        const level = D(owned?.level ?? 0);
        return {
          id: Number(id),
          name: def.name,
          level: level.toNumber(),
          spent: num(owned?.spentAncientSouls ?? 0),
          bonus: outsiderBonus(def, level).toNumber(),
          maxLevel: def.maxLevel,
          effect: def.effectDescription,
        };
      })
      .filter((o) => o.level > 0 || o.maxLevel > 0),
    heroes,
    powerFive,
    topDps,
    relicsDetail: (() => {
      const types = gameData().itemBonusTypes || {};
      const items = save.items?.items || {};
      const slots = save.items?.slots || {};
      const slotCount = num(save.items?.equipmentSlots ?? 4);
      // Slots 1..slotCount are worn; the rest are the junk pile.
      const equippedByUid = new Map();
      for (const [slot, uid] of Object.entries(slots)) {
        if (Number(slot) <= slotCount) equippedByUid.set(Number(uid), Number(slot));
      }
      const ancientLevel = (id) => num(save.ancients?.ancients?.[id]?.level ?? 0);

      const rows = Object.values(items).map((it) => {
        const pairs = [
          [it.bonusType1, it.bonus1Level],
          [it.bonusType2, it.bonus2Level],
          [it.bonusType3, it.bonus3Level],
          [it.bonusType4, it.bonus4Level],
        ];
        const bonuses = pairs
          .filter(([id]) => id && types[id])
          .map(([id, lvl]) => {
            const t = types[id];
            const ancient = gd.ancients[String(t.ancientId)];
            // Each point of bonus level contributes the formula's coefficient
            // (linear10 -> 10 per level, linear1 -> 1 per level).
            const m = /linear(\d+)/.exec(t.levelAmountFormula || "");
            const perLevel = m ? Number(m[1]) : 1;
            const amount = (Number(lvl) || 0) * perLevel;
            return {
              stat: t.name,
              typeId: Number(id),
              ancientId: t.ancientId,
              ancientName: ancient ? ancient.name : null,
              description: t.effectDescription,
              amount: Math.round(amount * 10) / 10,
              ancientLevel: ancientLevel(t.ancientId),
              label:
                (ancient ? `${ancient.name.split(",")[0]}: ` : "") +
                t.effectDescription.replace("%1", String(Math.round(amount * 10) / 10)),
            };
          });
        return {
          uid: num(it.uid),
          name: it.name,
          level: num(it.level),
          rarity: num(it.rarity),
          type: it.type,
          equipped: equippedByUid.has(num(it.uid)),
          slot: equippedByUid.get(num(it.uid)) ?? null,
          bonuses,
        };
      });

      // A relic's worth is the sum of the ancients it strengthens, weighted by
      // how much this save actually uses them (wiki: each bonus maps to one
      // ancient, and its size is relative to the same bonus on other relics).
      const maxByType = new Map();
      for (const r of rows) for (const b of r.bonuses) {
        maxByType.set(b.typeId, Math.max(maxByType.get(b.typeId) ?? 0, b.amount));
      }
      for (const r of rows) {
        let score = 0;
        for (const b of r.bonuses) {
          const max = maxByType.get(b.typeId) || 1;
          const strength = b.amount / max;
          // An ancient that was never summoned does not use the bonus yet;
          // weighted by its current level when it has been.
          const use = b.ancientLevel > 0 ? 1 + Math.log10(1 + b.ancientLevel) / 3 : 0.15;
          score += strength * use;
        }
        r.score = Math.round(score * 1000) / 1000;
      }

      const suggested = rows
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, slotCount)
        .map((r) => r.uid);

      const byUid = new Map(rows.map((r) => [r.uid, r]));
      return {
        items: rows,
        slots: slotCount,
        equipped: [...equippedByUid.keys()],
        suggested,
        swaps: suggested
          .filter((uid) => !equippedByUid.has(uid))
          .map((uid) => ({
            inName: byUid.get(uid)?.name,
            outName: rows.find((r) => r.equipped && !suggested.includes(r.uid))?.name || null,
          })),
      };
    })(),

    gilds: {
      total: gildsTotal,
      // Each gild is +50% base hero damage; Argaiv raises that per-gild bonus.
      // Verified from the in-game gild screen: 1/2/3 gilds show +172/+344/+516%
      // with Argaiv 61, i.e. 50 + 2 x Argaiv per gild (additive).
      perGildPercent: 50 + (ancients.find((a) => a.name === "Argaiv")?.level ?? 0) * 2,
      argaivLevel: ancients.find((a) => a.name === "Argaiv")?.level ?? 0,
      epicHeroReceivedUpTo: epicReceivedUpTo,
      nextGildZone: nextGildMilestone(num(save.epicHeroReceivedUpTo ?? 0)),
    },
    mercs,
    relics,
    playtime: {
      totalSeconds: num(save.totalPlayTime),
      sessionSeconds: secondsSince(save.lastLoadTime ),
      count: num(save.sessionCount),
    },
    lastAscension: lastAscensionInfo(save),
    run: runClock(save, now),
    stats: {
      totalKills: num(save.totalKills),
      bossKills: num(save.totalBossKills),
      primals: num(save.totalPrimalsKilled),
      ascensions: num(save.numAscensionsThisTranscension),
      totalAscensions: num(save.stats?.transcensions?.[0]?.numAscensions ?? 0),
      soulsFromAscensions: str(D(save.totalHeroSoulsFromAscensions ?? 0)),
    },
  };
}

// ----------------------------------------------------------------- helpers

export function shortName(fullName) {
  if (!fullName) return "";
  return fullName.split(",")[0].trim();
}

export function str(d) {
  return new Decimal(d).toString();
}

/** 1.23e45 style short form for the UI. */
export function fmt(d, digits = 2) {
  const x = new Decimal(d);
  if (!x.isFinite()) return "∞";
  const abs = x.abs();
  if (abs.lt(1000)) return x.toDecimalPlaces(digits).toString();
  return x.toExponential(digits).replace("e+", "e");
}

/**
 * Highest zone whose *boss* still dies inside the boss timer at the current DPS.
 * Binary search over the same monster formula the game uses, so it stays honest
 * across AS tiers.
 */
export function bossWallZone(dps, save, { timerFor }) {
  const d = new Decimal(dps);
  if (d.lte(0)) return 0;
  const start = num(save.currentZoneHeight ?? 1);
  const scale = hpScale(num(save.ancientSoulsTotal));

  const kills = (zone) => {
    const bossZone = Math.ceil(zone / 5) * 5;
    const hp = monsterLife(bossZone, {
      boss: true,
      bossLifePercent: 0,
      transcendent: !!save.transcendent,
      hzePersist: num(save.highestFinishedZonePersist),
      scale,
    });
    const seconds = hp.dividedBy(d).toNumber();
    return seconds <= timerFor(zone);
  };

  let lo = start;
  let hi = start;
  let step = 10;
  // exponential probe upward until it fails
  while (kills(hi) && hi < 5_000_000) {
    lo = hi;
    hi += step;
    step *= 2;
  }
  // binary search between last good and first bad
  while (hi - lo > 5) {
    const mid = Math.floor((lo + hi) / 2 / 5) * 5;
    if (mid <= lo) break;
    if (kills(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function guessInstakillZone(dps, save) {
  // Walk zones upward until a monster survives one frame (30 dps applications/s).
  const frame = D(dps).dividedBy(30);
  if (frame.lte(0)) return 0;
  let zone = num(save.currentZoneHeight ?? 1);
  const transcendent = !!save.transcendent;
  const hzePersist = num(save.highestFinishedZonePersist);
  for (let i = 0; i < 6000; i++) {
    const hp = monsterLife(zone + 1, { boss: false, transcendent, hzePersist });
    if (hp.gt(frame)) break;
    zone++;
  }
  return zone;
}

function runClock(save, now) {
  const groups = save.stats?.transcensions ?? {};
  let startedAt = null;
  for (const t of Object.values(groups)) {
    for (const a of Object.values(t.ascensions ?? {})) {
      if (!a || !a.endTime) continue;
      // The open run is the most recent ascension boundary.
      if (startedAt == null || a.endTime > startedAt) startedAt = a.endTime;
    }
  }
  const zone = num(save.currentZoneHeight ?? 1);
  const seconds = startedAt ? Math.max(0, (now - startedAt) / 1000) : null;
  const zones = zone - 1;
  return {
    startedAt,
    seconds,
    zonesThisRun: zones,
    zonesPerHour: seconds && seconds > 60 && zones > 0 ? (zones / seconds) * 3600 : null,
  };
}

function lastAscensionInfo(save) {
  const groups = save.stats?.transcensions ?? {};
  let best = null;
  for (const t of Object.values(groups)) {
    for (const a of Object.values(t.ascensions ?? {})) {
      if (!a || !a.endTime || !a.highestZoneEver) continue;
      const gained = Number(a.heroSoulsEnd ?? 0) - Number(a.heroSoulsStart ?? 0);
      if (gained <= 0) continue;
      if (!best || a.endTime > best.endTime) {
        best = { zone: a.highestZoneEver, souls: gained, endTime: a.endTime, hours: (a.endTime - a.startTime) / 3600000 };
      }
    }
  }
  return best;
}

function nextGildMilestone(epicReceivedUpTo) {
  if (epicReceivedUpTo < 100) return 100;
  return epicReceivedUpTo + 10;
}
