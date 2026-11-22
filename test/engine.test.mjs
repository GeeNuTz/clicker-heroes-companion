import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { decodeSave, saveCandidates } from "../src/save.mjs";
import {
  ancientBonus,
  ancientCostAtLevel,
  ancientCostBetween,
  buildState,
  gameData,
  monsterLife,
  shortName,
} from "../src/engine.mjs";
import { advise } from "../src/advice.mjs";
import { ancientRule, ascensionRule, transcendenceRule } from "../src/strategy.mjs";
import Decimal from "decimal.js";

const MARKER = "7e8bb5a89f2842ac4af01b3b7e228592";

function encode(obj) {
  const body = zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), "utf8"));
  return MARKER + body.toString("base64");
}

function fixture(overrides = {}) {
  return {
    version: 7,
    readPatchNumber: "1.0e12-6180",
    transcendent: true,
    gold: "1000",
    heroSouls: "100",
    primalSouls: "0",
    ancientSoulsTotal: 10,
    rubies: 10,
    currentZoneHeight: 60,
    highestFinishedZone: 100,
    highestFinishedZonePersist: 120,
    transcendentHighestFinishedZone: 120,
    numberOfTranscensions: 1,
    allDpsMultiplier: 1,
    clickMultiplier: 1,
    goldMultiplier: 1,
    epicHeroReceivedUpTo: 100,
    ancients: { ancients: { 5: { id: 5, level: "10" } }, artificiallyRaisedAncients: {} },
    outsiders: { outsiders: {} },
    heroCollection: { heroes: { 2: { id: 2, level: 25, epicLevel: 0, upgradeDamageMultiplier: "1" } } },
    mercenaries: { mercenaries: {} },
    items: { items: {} },
    stats: { transcensions: {} },
    ...overrides,
  };
}

test("decodeSave round-trips a compressed save", () => {
  const save = fixture();
  const decoded = decodeSave(encode(save));
  assert.equal(decoded.version, 7);
  assert.equal(decoded.heroSouls, "100");
  assert.equal(decoded.__saveOrigin, "pc");
});

test("decodeSave rejects garbage instead of guessing", () => {
  assert.throws(() => decodeSave("not a save at all"), /marker|short/);
  assert.throws(() => decodeSave(""), /short/);
});

test("saveCandidates are absolute paths under a Steam root", () => {
  const list = saveCandidates();
  assert.ok(list.length > 0);
  for (const p of list) {
    assert.ok(p.endsWith("playerSaveData.txt"));
    assert.ok(p.startsWith("/"));
  }
});

test("ancient bonuses match the game's published numbers", () => {
  const gd = gameData();
  const an = (id) => gd.ancients[String(id)];
  const ob = { idleBonus: 0, atmanBonus: 0, kumaBonus: 0, doraBonus: 0, bubosBonus: 0, chronosBonus: 0 };

  // Siyalatas 61 -> 1363% (the 60-69 bracket of libAndSiy)
  assert.equal(ancientBonus(an(5), new Decimal(61), ob).toNumber(), 1363);
  // Libertas 57 -> 1285% (50-59 bracket)
  assert.equal(ancientBonus(an(4), new Decimal(57), ob).toNumber(), 1285);
  // Kumawakamaru 11 -> 8 * (1 - e^-0.275) = 1.923
  assert.ok(Math.abs(ancientBonus(an(21), new Decimal(11), ob).toNumber() - 1.923) < 0.01);
  // Atman 10 -> 9.14%
  assert.ok(Math.abs(ancientBonus(an(13), new Decimal(10), ob).toNumber() - 9.14) < 0.02);
  // Morgulis is 11% per level, additive
  assert.equal(ancientBonus(an(16), new Decimal(100), ob).toNumber(), 1100);
});

test("ancient costs follow the per-ancient cost curves", () => {
  const gd = gameData();
  // linear: level n costs 1..n
  assert.equal(ancientCostAtLevel(gd.ancients["4"], new Decimal(3)).toNumber(), 6);
  // exponential: 2^(n+1)-1
  assert.equal(ancientCostAtLevel(gd.ancients["21"], new Decimal(3)).toNumber(), 15);
  // buying from 10 to 12 on a linear ancient costs 11+12
  assert.equal(ancientCostBetween(gd.ancients["4"], new Decimal(10), new Decimal(12)).toNumber(), 23);
});

test("monster life grows with zone and bosses are tougher", () => {
  const mob = monsterLife(10, { boss: false, transcendent: true, hzePersist: 0 }).toNumber();
  const boss = monsterLife(10, { boss: true, transcendent: true, hzePersist: 0 }).toNumber();
  assert.ok(boss > mob);
  const later = monsterLife(20, { boss: false, transcendent: true, hzePersist: 0 }).toNumber();
  assert.ok(later > mob);
});

test("buildState derives souls bonus, dps and boss timer", () => {
  const state = buildState(fixture());
  // 100 souls -> +1000% plus Morgulis 0
  assert.equal(Number(state.resources.soulsBonusPercent), 1000);
  assert.ok(Number(state.combat.dps) > 0);
  assert.ok(Number(state.combat.bossHp) > 0);
  assert.equal(state.combat.bossZone, 60);
});

test("advice tells you to ascend when the boss cannot be killed in 30s", () => {
  const weak = fixture({
    currentZoneHeight: 150,
    highestFinishedZone: 150,
    highestFinishedZonePersist: 150,
    heroCollection: { heroes: { 2: { id: 2, level: 2, epicLevel: 0, upgradeDamageMultiplier: "1" } } },
  });
  const state = buildState(weak);
  const plan = advise(state);
  // Order is presentation; the verdict is what matters here.
  assert.equal(plan.ascend.action, "ascend");
});

test("advice says keep pushing when the boss dies fast", () => {
  const strong = fixture({ heroSouls: "1e26", currentZoneHeight: 130, highestFinishedZone: 130, highestFinishedZonePersist: 130 });
  const state = buildState(strong);
  const plan = advise(state);
  assert.equal(plan.actions[0].kind, "push");
});

test("ancients are held until HS beats nextCost * level", () => {
  // 100 souls, Siya lvl 10 -> next cost 11, threshold 110 -> hold
  const state = buildState(
    fixture({ heroSouls: "100", ancients: { ancients: { 5: { id: 5, level: "10" }, 4: { id: 4, level: "10" } }, artificiallyRaisedAncients: {} } }),
  );
  const plan = ancientRule(state, new Decimal(100));
  assert.equal(plan.buys.length, 0);
});

test("ancients are bought once HS passes the threshold", () => {
  const state = buildState(fixture({ heroSouls: "5000" }));
  const plan = ancientRule(state, new Decimal(5000));
  assert.ok(plan.buys.length > 0);
  const spent = plan.buys.reduce((s, b) => s.plus(b.cost), new Decimal(0));
  assert.ok(spent.lte(5000));
});

test("ascension rule: first ascension waits for zone 130", () => {
  const early = buildState(fixture({ currentZoneHeight: 60, highestFinishedZonePersist: 60, highestFinishedZone: 60 }));
  assert.equal(ascensionRule(early).action, "push");
});

test("ascension rule: past 130 a failed boss means ascend", () => {
  const state = buildState(fixture({ currentZoneHeight: 200, highestFinishedZonePersist: 200, highestFinishedZone: 200 }));
  const rule = ascensionRule(state);
  assert.equal(rule.action, "ascend");
});

test("transcendence waits for zone 300", () => {
  const state = buildState(fixture({ highestFinishedZonePersist: 204 }));
  assert.equal(transcendenceRule(state).ready, false);
});

test("shortName strips the epithet", () => {
  assert.equal(shortName("Siyalatas, Ancient of Abandon"), "Siyalatas");
});
