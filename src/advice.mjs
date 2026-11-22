// Turns a state snapshot into an ordered plan.
//
// The rules come from the Clicker Heroes community bot (McNiibot, Playsaurus)
// and are transcribed in strategy.mjs: ascend at 130 / on boss failure, only
// Siya+Lib before 300, transcend at 300, then the 3-ascension cycle.
// Numbers always come from the save; the rules only decide *what matters*.
import fs from "node:fs";
import Decimal from "decimal.js";
import { breakpoints, gameData, hpScale, monsterLife } from "./engine.mjs";
import { RULES, ANCIENT_MAX_LEVEL, KAPPA, ancientRule, ascensionRule, bossTimer, kappaExpectedZones, nextAutoclickerCost, transcendenceRule, tpPercent } from "./strategy.mjs";
import { ancientSuggestions, DEFAULT_SETTINGS } from "./suggest.mjs";

const D = (v) => new Decimal(v ?? 0);
const POWER_HEROES = [2, 3, 4, 7, 9]; // Treebeast, Ivan, Brittany, Samurai, Forest Seer

export function advise(state, { settings = null } = {}) {
  state = settings ? { ...state, settings } : state;
  const timeline = [];
  const warnings = [];
  const gold = D(state.resources.gold);
  const souls = D(state.resources.heroSouls);
  const rate = state.run?.zonesPerHour;

  const eta = (targetZone) => {
    if (!rate || rate <= 0) return null;
    const hours = Math.max(0, (targetZone - state.zone.current) / rate);
    if (hours < 1 / 60) return "now";
    if (hours < 1) return `~${Math.round(hours * 60)} min`;
    return `~${hours.toFixed(1)} h`;
  };

  // 1. ascend or push — the rule that decides everything else
  const asc = ascensionRule(state);
  if (asc.action === "ascend") {
    timeline.push({
      when: "NOW",
      kind: "ascend",
      action: `Ascend at zone ${state.zone.current}`,
      detail: asc.reason,
      why: lastRunNote(state),
      eta: null,
    });
  } else {
    const noDamage = Number(state.combat.effectiveIdleDps ?? 0) <= 0;
    const needsCheckpoint = state.zone.current < RULES.firstAscensionZone;
    const best = [...(state.heroes || [])].sort((a, b) => b.level - a.level)[0];
    timeline.push({
      when: "NOW",
      kind: "push",
      action: noDamage
        ? `Fresh run at zone ${state.zone.current} — buy and level heroes`
        : `Keep pushing — boss ${state.combat.bossZone} in ${fmtSeconds(state.combat.bossSeconds)}`,
      detail: noDamage
        ? "No hero levels are placed yet, so there is no DPS to compare against the boss timer. Pick up the hero ladder (highest affordable hero, then 25 levels into the one before it)." +
          (best ? ` Highest hero on the board: ${best.name} (level ${best.level}).` : "")
        : asc.reason,
      why: noDamage
        ? "Hero levels are where gold turns into damage; the boss timer means nothing until you have damage."
        : needsCheckpoint
          ? `${RULES.firstAscensionZone - state.zone.current} more zones to the 130 checkpoint.`
          : "You are past 130, so a failed boss is the only trigger left.",
      eta: null,
    });
  }

  // 2. transcendence checkpoint
  const tr = transcendenceRule(state);
  timeline.push({
    // Not "NOW": the bot's rule needs a payout larger than the last
    // transcension, which we cannot verify from the save. Label the condition.
    when: tr.ready === true ? "WHEN A PAYOUT BEATS LAST TRANSCEND" : "LATER",
    kind: "transcend",
    action: tr.ready === true
      ? (state.zone.transcensions === 0
          ? "Transcend (first time — zone 300)"
          : `Transcend (next one, #${state.zone.transcensions + 1})`)
      : `Transcendence: ${tpPercent(state.resources.ancientSoulsTotal).toFixed(1)}% TP`,
    detail: tr.reason,
    why: "TP multiplies every primal soul drop; it is the main long-term scaling.",
    eta: null,
  });

  // 3. ancients — pointless right before a transcension (they reset). Past
  // zone 300 the bot says "use a calculator", so the allocator drives here;
  // before 300 its own Siya/Lib threshold rule does.
  const post300 = state.zone.hzePersist >= 300;
  const plan = ancientRule(state, souls);
  if (post300) {
    const buys = ancientSuggestions(state, state.settings || DEFAULT_SETTINGS)
      .filter((a) => a.rank && a.diff > 0)
      .sort((a, b) => a.rank - b.rank);
    if (buys.length) {
      const total = buys.reduce((acc, b) => acc.plus(b.cost), D(0));
      timeline.push({
        when: "THIS TRANSCEND",
        kind: "ancients",
        action: tr.ready === true ? "Ancient upgrades suggested (see Ancients tab)" : "Ancient upgrades suggested",
        detail: buys.slice(0, 3).map((b) => `#${b.rank} ${b.name} ${b.current}→${b.suggested}`).join(" · ") + " …",
        why: `Full order and costs are in the Ancients tab.${tr.ready === true ? " The transcend resets them, so this is the plan for after it." : ""}`,
        eta: null,
      });
    }
  } else if (plan.buys.length) {
    timeline.push({
      when: "NOW",
      kind: "ancients",
      action: `Level Siya/Lib: ${fmtNum(plan.spent)} souls`,
      detail: plan.buys
        .map((b) => `${b.name} ${b.from} → ${b.level}  (${fmtNum(b.cost)} souls)`)
        .join("\n"),
      why: "Only Siya + Libertas matter before zone 300; level them equally.",
      eta: null,
    });
  } else {
    const siya = state.ancients.find((a) => a.name === "Siyalatas");
    const threshold = siya ? D(siya.nextCost).times(siya.level) : D(0);
    timeline.push({
      when: "WHEN HS > " + fmtNum(threshold),
      kind: "ancients",
      action: "Hold your souls, do not level ancients yet",
      detail: siya
        ? `Rule: level Siya/Lib only when HS > next cost x level = ${fmtNum(siya.nextCost)} x ${siya.level} = ${fmtNum(threshold)} souls. You have ${fmtNum(souls)}.`
        : "No Siyalatas yet — buy it first.",
      why: "Unspent hero souls are +10% damage each; spending early wastes that.",
      eta: null,
    });
  }

  // 4. hero — the bot's upgrade ladder (highest hero to 10, previous to 25, ...)
  const hero = planHero(state, gold);
  if (hero) {
    timeline.push({
      when: "NOW",
      kind: "hero",
      action: hero.title,
      detail: hero.detail,
      why: "Hero levels are where gold turns into damage.",
      eta: null,
    });
  }

  // 5. gilds — state, not an action. The Gilds tab owns this; the timeline
  // only shows a gild step when regilding is actually the right move now.
  const gild = planGilds(state, tr.ready === true);
  if (gild && gild.when === "NOW" && !tr.ready) {
    timeline.push({
      when: gild.when,
      kind: "gilds",
      action: gild.title,
      detail: gild.detail,
      why: "Gilds multiply one hero; moving them too early wastes souls on regilding.",
      eta: null,
    });
  }

  // 6. rubies: 4 autoclickers first, everything else is a trap
  const ac = state.resources.autoclickers ?? 0;
  if (ac < 4) {
    const cost = nextAutoclickerCost(ac);
    timeline.push({
      when: "WHEN RUBIES ALLOW",
      kind: "shop",
      action: ac === 0 ? "Buy your first Auto Clicker" : `Buy Auto Clicker #${ac + 1}`,
      detail:
        `Costs ${fmtNum(cost)} rubies (have ${state.resources.rubies}). Four in total = 7,000 rubies. ` +
        `Never spend rubies on gilds, relics or instant mercs. Reach four autoclickers before 2x damage.`,
      why: "ACs are the only ruby purchase that changes how you play. 2x damage is optional and does nothing during FANT (the first ascension after a transcend).",
      eta: null,
    });
  } else {
    timeline.push({
      when: "OPTIONAL",
      kind: "shop",
      action: "2x damage — optional, skip during FANT",
      detail:
        `All four autoclickers are bought. 2x damage costs 50 rubies but is insignificant next to exponential DPS growth, ` +
        `and it does not apply during FANT. Skip it if rubies are better spent on timelapses or the QA rush.`,
      why: "The bot's /2xdps is explicit: 4 ACs first, then 2x damage is fine but optional.",
      eta: null,
    });
  }

  // 7. skills, only when the wall is close
  if (state.combat.bossSeconds > bossTimer(state.zone.current) * 0.5) {
    timeline.push({
      when: "BEFORE YOU ASCEND",
      kind: "skills",
      action: "Burn skills: LS + GC + Energize + Reload, then everything",
      detail: "Lucky Strikes + Golden Clicks + Energize, wait out the first wave, reload, then fire all skills until the boss fails.",
      why: "Skills are worth ~1-2 extra zones at the end of a run; ascend when they run out.",
      eta: null,
    });
  }

  // 8. where you are in the prestige cycle
  timeline.push({
    when: "PROGRESS",
    kind: "progress",
    action: `Ascension ${state.stats.ascensions} this transcension · ${state.stats.totalAscensions} all time · ${state.zone.transcensions} transcension(s)`,
    detail: `TP ${tpPercent(state.resources.ancientSoulsTotal).toFixed(1)}% · best zone ${state.zone.hzePersist}. Ascend on a failed boss; transcend when "Next AS" shows at least +1.`,
    why: "Bot loop: ascend until HS beats your last transcension, do 3 more ascensions, then transcend — until ~24% TP.",
    eta: null,
  });

  // 9. TP breakpoint progress (McNiibot /bp)
  const bp = breakpoints(state.resources.ancientSoulsTotal);
  if (bp.next) {
    timeline.push({
      when: `AT ${bp.next.as} AS`,
      kind: "breakpoint",
      action: `Next TP breakpoint: ${bp.current.tp}% → ${bp.next.tp}%`,
      detail: `TP goes ${bp.current.tp}% -> ${bp.next.tp}% at ${bp.next.as} AS (you have ${state.resources.ancientSoulsTotal}, ${bp.toNext} to go)` +
        (bp.next.hpScale ? `, and monster HP growth steepens to ${bp.next.hpScale} - but only from zone ${bp.next.hpStartsAt.toLocaleString()}, not now.` : "."),
      why: "TP multiplies primal souls; these are the tiers the bot's /bp lists.",
      eta: null,
    });
  }

  // 9b. kappa (rare centurion) — only relevant past zone 1000
  if (state.zone.hzePersist >= KAPPA.minZone) {
    timeline.push({
      when: "PASSIVE",
      kind: "kappa",
      action: "Kappa hunting is live",
      detail:
        `Centurions from zone ${KAPPA.minZone + 10} up have a ${(KAPPA.chance * 100).toFixed(1)}% chance to be a kappa ` +
        `(${(KAPPA.mobileChance * 100).toFixed(1)}% on mobile, halved during holiday events). ` +
        `Expect one roughly every ${kappaExpectedZones().toLocaleString()} zones of clearing.`,
      why: "You will usually instakill straight past one, so do not wait for it.",
      eta: null,
    });
  }

  // 10. mercs — lives in the Mercs tab, not the progression timeline
  const mercsStep = planMercs(state);

  // Only warn about a failing boss once the run can actually fail: a fresh
  // run at zone 1 with no DPS shows "infinity" and must not say "ascend".
  const canFail = Number(state.combat.effectiveIdleDps ?? 0) > 0 && state.zone.current >= 130;
  if (canFail && state.combat.bossSeconds > 120) {
    warnings.push(`Boss ${state.combat.bossZone} takes ${fmtSeconds(state.combat.bossSeconds)} — that is a fail, ascend.`);
  }

  // Order the plan by when the player should act, not by the order we built it.
  const ORDER = { push: 0, hero: 1, shop: 2, ancients: 3, gilds: 4, breakpoint: 5, skills: 6, progress: 7, transcend: 8, kappa: 9 };
  const isNow = (t) => (t.when || "").startsWith("NOW");
  timeline.sort((a, b) => {
    const na = isNow(a) ? 0 : 1;
    const nb = isNow(b) ? 0 : 1;
    if (na !== nb) return na - nb;
    return (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9);
  });

  const actions = timeline.map((t, i) => ({
    kind: t.kind,
    priority: i,
    title: t.action,
    detail: [t.detail, t.why, t.eta].filter(Boolean).join("\n"),
  }));

  return { timeline, actions, warnings, ascend: asc, transcendReady: tr.ready === true, mercs: mercsStep };
}

// Quest order from qubit64's "[CH1 Single Mercenary] Strategies for Quests,
// Revive, and Timelapse" (r/ClickerHeroes, ahupf4). Ruby reward is
// L * days * (1 + rubyBonus) * multiplier, and the ranking below already
// prices in the 0.8^days death roll.
// Generated by tools/quest-optimizer.mjs from the post's objective
// (max over permutations of (D∘M)^T P_s / (D^T P_s)); reproduces 1.09 rubies/day.
function questOrder() {
  try {
    return JSON.parse(fs.readFileSync(new URL("./data/quest-order.json", import.meta.url), "utf8")).order;
  } catch {
    return [];
  }
}

const QUEST_PRIORITY = [
  { key: "4h ruby", mult: 1.5 },
  { key: "2h ruby", mult: 1.75 },
  { key: "1h ruby", mult: 2.0 },
  { key: "30m ruby", mult: 2.5 },
  { key: "15m ruby", mult: 2.75 },
  { key: "8h ruby", mult: 1.25 },
  { key: "5m ruby", mult: 3.2 },
  { key: "short non-ruby", mult: 0 },
  { key: "24h ruby", mult: 1.0 },
  { key: "8-24h non-ruby", mult: 0 },
  { key: "48h ruby", mult: 0.8 },
  { key: "48h non-ruby", mult: 0 },
];
// Two published revive models, by rarity index
// 0 none, 1 common, 2 uncommon, 3 rare, 4 epic, 5 fabled, 6 mythic, 7 legendary, 8 transcendent.
//
// qubit64 (newer, ruby-only, includes recruit downtime): narrow window.
const REVIVE_QUBIT64 = {
  0: [2.6, 8.5], 1: [2.2, 8.9], 2: [2.0, 9.1], 3: [1.9, 9.2], 4: [1.3, 9.7],
  5: [1.0, 10.8], 6: [1.0, 13.4], 7: [1.0, 15.5], 8: [1.0, 19.1],
};
// dukC2 (older, HS-vs-QA / ruby-vs-cost): wider windows, and "D" = don't
// revive on long quests. [min, maxShort, maxLong|null(=D)]
const REVIVE_DUKC2_HS = {
  0: [2, 15.4, 12.9], 1: [1.5, 15.6, 13.2], 2: [1.4, 15.7, 13.3], 3: [1, 16, 13.4],
  4: [1, 16.9, 13.7], 5: [1, 16.9, 14.6], 6: [1, 17.8, 15.6], 7: [1, 21.1, 19],
  8: [1, 24.6, 22.5],
};
const REVIVE_DUKC2_RUBY = {
  0: [2.8, 9.81, null], 1: [2.4, 10.1, null], 2: [2.2, 10.3, null], 3: [2.1, 10.4, null],
  4: [1.5, 10.9, 7.1], 5: [1, 12.5, 9.0], 6: [1, 13.0, 10.5], 7: [1, 16.6, 14.4],
  8: [1, 20.2, 18.0],
};
const PEAK_REVIVE_LEVEL = 5.8;
const reviveCost = (level) => 10 + Math.ceil(Math.pow(1.5, level));

function reviveRange(rarity, focus) {
  if (focus === "hs") {
    const [min, maxShort, maxLong] = REVIVE_DUKC2_HS[rarity] ?? REVIVE_DUKC2_HS[0];
    return { min, max: maxShort, maxLong };
  }
  const [min, maxShort, maxLong] = REVIVE_DUKC2_RUBY[rarity] ?? REVIVE_DUKC2_RUBY[0];
  return { min, max: maxShort, maxLong };
}

function planMercs(state) {
  const m = state.mercs || [];
  const dead = m.filter((x) => x.timeToDie <= 0);
  const alive = m.filter((x) => x.timeToDie > 0);
  const computed = questOrder();
  const list = (computed.length ? computed.slice(0, 8) : QUEST_PRIORITY.map((q) => q.key)).join(" > ") + " …";

  if (!m.length) {
    return {
      when: "NOW", kind: "mercs",
      action: "Recruit a mercenary",
      detail: "No mercs. Up to 5; each is a free ruby trickle.",
      why: `Quest order: ${list}.`,
      eta: null,
    };
  }

  const focus = state.settings?.mercFocus || "ruby";
  const revivable = dead.filter((x) => {
    const r = reviveRange(x.rarity, focus);
    return x.level >= r.min && x.level <= r.max;
  });
  if (dead.length && revivable.length) {
    const d = revivable[0];
    return {
      when: "NOW", kind: "mercs",
      action: `Revive ${d.name} (level ${d.level}, rarity ${d.rarity})`,
      detail: `Level ${d.level} (rarity ${d.rarity}) sits inside the ${reviveRange(d.rarity, focus).min}-${reviveRange(d.rarity, focus).max} window for ${focus} focus. Revive costs 10 + ceil(1.5^${d.level}) = ${reviveCost(d.level)} rubies.`,
      why: "Outside that window the revive costs more rubies than the merc will earn back.",
      eta: null,
    };
  }
  if (dead.length && !revivable.length) {
    const d = dead[0];
    return {
      when: "DO NOT REVIVE", kind: "mercs",
      action: `Let ${d.name} go (level ${d.level})`,
      detail: `Level ${d.level} (rarity ${d.rarity}) is outside the ${reviveRange(d.rarity, focus).min}-${reviveRange(d.rarity, focus).max} window for ${focus} focus. ` +
        (reviveRange(d.rarity, focus).maxLong === null
          ? `On long quests this rarity is a hard "don't revive"; if it died on a good ruby quest, the peak level ${PEAK_REVIVE_LEVEL} applies instead.`
          : `It costs more rubies than the merc earns back — recruit fresh.`),
      why: "A revive at the wrong level is a net ruby loss.",
      eta: null,
    };
  }

  const soonest = [...alive].sort((a, b) => a.timeToDie - b.timeToDie)[0];
  const top3 = (computed.length ? computed.slice(0, 3) : QUEST_PRIORITY.map((q) => q.key)).join(" · ");
  return {
    when: "NOW", kind: "mercs",
    action: `Send ${alive.length} merc${alive.length === 1 ? "" : "s"} on ruby quests`,
    detail: `Best offers: ${top3}. Soonest death: ${soonest.name}, ${humanDur(soonest.timeToDie)}.`,
    why: "4h ruby is the sweet spot. Offers are rolled by the game, so I can rank the quest types but not tonight's four.",
    eta: null,
  };
}

function lastRunNote(state) {
  const l = state.lastAscension;
  if (!l) return "";
  return `Last run: +${l.souls} souls at zone ${l.zone} in ${l.hours?.toFixed(1)}h.`;
}

function planHero(state, gold) {
  const gd = gameData();
  const owned = new Set(state.heroes.map((h) => h.id));
  const top = state.heroes[0];

  // Upgrade ladder from the game data: each hero unlocks an upgrade at 10, 25,
  // 50, 75, (100/125). The bot's order is highest hero to its next unlock,
  // then step back through the older heroes.
  const ladder = upgradeLadder();
  const active = [...state.heroes]
    .filter((h) => ladder[h.id]?.length)
    // Highest-level hero first (that is where your damage is). On a fresh run
    // every level is 0, so fall back to the cheapest hero instead of the last
    // one in the list — otherwise it told a zone-1 run to level Dread Knight.
    .sort((a, b) => (b.level - a.level) || (a.id - b.id))
    .map((h) => {
      const next = ladder[h.id].find((lvl) => lvl > h.level);
      return next ? { hero: h, target: next } : null;
    })
    .filter(Boolean);

  if (active.length) {
    const pick = active[0];
    const cost = heroCostTo(gd.heroes[String(pick.hero.id)], pick.target, D(state.ancients.find((a) => a.name === "Dogcog")?.bonus ?? 0));
    const affordable = gold.gte(cost);
    return {
      title: `Level ${pick.hero.name} to ${pick.target} for its upgrade`,
      detail: `${fmtNum(cost)} gold ${affordable ? "(affordable now)" : `(you have ${fmtNum(gold)})`}. Then the previous hero's next unlock.`,
    };
  }

  // fallback: everything is at its last upgrade -> carry the power hero
  const power = POWER_HEROES.map((id) => state.heroes.find((h) => h.id === id)).filter((h) => h && h.level >= 1000);
  if (power.length) {
    const best = power.sort((a, b) => b.gilds - a.gilds || b.level - a.level)[0];
    return {
      title: `Level ${best.name} (x10 at each 1000)`,
      detail: `Power hero with ${best.gilds} gilds; ${fmtNum(best.next25Cost)} gold per 25 levels.`,
    };
  }

  if (!top) return null;
  const target = Math.ceil((top.level + 1) / 25) * 25;
  return {
    title: `Level ${top.name} to ${target}`,
    detail: `${fmtNum(top.next25Cost)} gold for the next x4 breakpoint.`,
  };
}

let _ladder = null;
function upgradeLadder() {
  if (_ladder) return _ladder;
  _ladder = {};
  for (const u of Object.values(gameData().upgrades)) {
    (_ladder[u.heroId] ||= new Set()).add(u.heroLevelRequired);
  }
  for (const id of Object.keys(_ladder)) _ladder[id] = [..._ladder[id]].sort((a, b) => a - b);
  return _ladder;
}

function planGilds(state, willTranscend = false) {
  // Source: McNiibot's own !gilds command (github.com/zuils/McNiibot).
  // It is level-based, not gold-based like the clickerheroes.dev chart.
  const gd = gameData();
  const byName = (frag) =>
    state.heroes.find((h) => h.name && h.name.toLowerCase().includes(frag.toLowerCase()));
  const level = (frag) => byName(frag)?.level ?? 0;
  const total = state.gilds.total;

  const samurai = level("Samurai");
  const atlas = level("Atlas");
  const souls = D(state.resources.heroSouls);
  const instakilling = state.combat.monsterSeconds <= 1 / 30;

  let body;
  let when = "NOW";

  // Transcendence wipes gilds along with ancients and hero souls, so any
  // regilding done now is spent souls for nothing.
  if (willTranscend) {
    return {
      when: "AFTER TRANSCENDING",
      title: `Gilds (${total}) survive ascensions, not the transcendence`,
      detail:
        `Your ${total} gilds came through the ascensions — hero levels reset, gilds do not. ` +
        "The transcendence that is due now resets gilds, ancients and hero souls together, so regilding before it buys nothing. " +
        "Transcend first, then regild as you earn gilds back (Samurai → Atlas).",
      why: "Gilds are only lost on transcendence; ascensions keep them.",
      eta: null,
    };
  }

  if (state.zone.transcensions === 0) {
    // Before the first transcendence: gilds stay where they landed.
    const power = [2, 3, 4, 7, 9]
      .map((id) => state.heroes.find((h) => h.id === id))
      .filter(Boolean)
      .sort((a, b) => b.gilds - a.gilds || b.level - a.level)[0];
    body =
      `Re-gilding is not recommended before your first transcendence. Level the Power 5 hero with the most gilds` +
      (power ? ` — that is ${power.name} (${power.gilds} gilds, level ${power.level})` : "") +
      `.`;
  } else if (souls.lt(10000)) {
    body =
      `After transcending, move all gilds to The Masked Samurai once you are regularly ascending for 10k+ Hero Souls. ` +
      `You are at ${fmtNum(souls)} — keep the ${total} gilds where they are and level Samurai (currently ${samurai}).`;
    when = "WHEN YOU ASCEND FOR 10K+ SOULS";
  } else if (samurai >= 2425 && atlas < 725) {
    body = `Samurai is ${samurai}. Push Atlas to 725 and then move every gild to Atlas (currently ${atlas}).`;
  } else if (atlas >= 725) {
    const next = ["Terra", "Phthalo", "Orntchya", "Lilin", "Cadmia", "Alabaster", "Astraea", "Chiron", "Moloch", "Bomber Max", "Gog", "Wepwawet"]
      .map((n) => ({ name: n, lvl: level(n) }))
      .filter((h) => h.lvl >= 1000)
      .pop();
    body = next
      ? `${next.name} is level ${next.lvl} — if your current gilded hero is at 1500, move the gilds to ${next.name}.`
      : `Atlas is ${atlas}. Move gilds down the ranger list whenever the next hero passes level 1000 and your current one is 1500. Do not regild while instakilling.`;
  } else {
    body = `Keep gilds on your current hero and level it. Next checkpoints: Samurai to 2425, then Atlas to 725.`;
  }

  if (instakilling && state.zone.transcensions > 0) {
    when = "WHEN INSTAKILL STOPS";
    body += " You are still instakilling, so extra damage changes nothing yet.";
  }

  return {
    when,
    title: `Gilds (${total}): keep them on one hero`,
    detail: body,
    why: "A gild is +50% damage on one hero. Regilding only matters once instakill stops.",
    eta: null,
  };
}

let _chart = null;
function gildingChart() {
  if (!_chart) _chart = JSON.parse(fs.readFileSync(new URL("./data/gilding-chart.json", import.meta.url), "utf8"));
  return _chart;
}

// cumulative hero cost, same curve as the game
function heroCostTo(def, toLevel, dogcogPercent) {
  const r = 1.07;
  const discount = 1 - dogcogPercent.toNumber() / 100;
  if (def.id === 1) {
    let sum = 0;
    for (let l = 0; l < Math.min(toLevel, 15); l++) sum += (5 + l) * Math.pow(r, l) * discount;
    if (toLevel > 15) sum += 20 * ((Math.pow(r, toLevel) - Math.pow(r, 15)) / (r - 1)) * discount;
    return D(sum).floor();
  }
  const span = new Decimal(r).pow(toLevel).minus(1);
  return D(def.baseCost).times(span.dividedBy(r - 1)).times(discount).floor();
}

export function fmtNum(d) {
  const x = D(d);
  const abs = x.abs();
  if (abs.lt(10000)) return x.toDecimalPlaces(0).toString();
  if (abs.lt(1e6)) return x.dividedBy(1000).toDecimalPlaces(2).toString() + "k";
  return x.toExponential(2).replace("e+", "e");
}

function humanDur(seconds) {
  const t = Math.abs(Math.round(Number(seconds) || 0));
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtSeconds(s) {
  if (!Number.isFinite(s)) return "infinity";
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  if (s < 90) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}
