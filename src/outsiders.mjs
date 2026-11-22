/**
 * Outsider allocation — direct port of driej's Clicker-Heroes-Outsiders
 * (github.com/driej/Clicker-Heroes-Outsiders, js/main.js), which is what
 * McNiibot's /as and /firstascension tell players to use.
 *
 * Kept as a faithful port: same cost formula, same greedy breakpoint
 * comparisons, same caps and ratios. Do not "improve" it here.
 */

/** Total AS needed to reach `level` on a linear1 outsider. */
export function costFromLevel(level) {
  return (level + 1) * (level / 2);
}

/** Highest level affordable with `spendable` AS. */
export function spendAS(ratio, as) {
  const spendable = ratio * as;
  if (spendable < 1) return 0;
  return Math.floor(Math.sqrt(8 * spendable + 1) / 2 - 0.5);
}

/** Chor'gorloth / Phandoryss / Ponyboy distribution. */
export function nOS(ancientSouls, transcendentPower, zone) {
  let as = ancientSouls;
  if (as > 20000) {
    as -= 11325;
    const pony = spendAS(0.88, as);
    as -= costFromLevel(pony);
    return [150, as, pony];
  }

  const hpMultiplier = Math.min(1.545, 1.145 + zone / 500000);
  const hsMultiplier = Math.pow(1 + transcendentPower, 0.2);
  const heroDamageMultiplier = zone > 1.2e6 ? 1000 : zone > 168000 ? 4.5 : 4;
  const heroCostMultiplier = zone > 1.2e6 ? 1.22 : 1.07;
  const goldToDps = Math.log10(heroDamageMultiplier) / Math.log10(heroCostMultiplier) / 25;
  const dpsToZones = Math.log10(hpMultiplier) - Math.log10(1.15) * goldToDps;

  let chor = 0;
  let phan = 0;
  let pony = 0;
  const chorBuff = 1 / 0.95;

  let guard = 0;
  while (as > 0 && guard++ < 1e6) {
    if (pony < 1) {
      as -= ++pony;
      continue;
    } else if (phan < 3) {
      phan++;
      as--;
      continue;
    }

    const damageIncrease = (phan + 2) / (phan + 1);
    const zoneIncrease = Math.log10(damageIncrease) / dpsToZones;
    let phanBuff = Math.pow(hsMultiplier, zoneIncrease);
    if (phan < 50) phanBuff *= Math.pow(1.1, 1 / phan);

    if (chor < as && chor < 150) {
      const chorBpAS = Math.pow(chorBuff, 1 / (chor + 1));
      if (chorBpAS >= phanBuff) {
        if (pony < as) {
          const ponyBuff = (Math.pow(pony + 1, 2) * 10 + 1) / (Math.pow(pony, 2) * 10 + 1);
          const ponyBpAS = Math.pow(ponyBuff, 1 / (pony + 1));
          if (ponyBpAS >= chorBpAS) {
            as -= ++pony;
            continue;
          }
        }
        as -= ++chor;
        continue;
      }
    }

    if (pony < as) {
      const ponyBuff = (Math.pow(pony + 1, 2) * 10 + 1) / (Math.pow(pony, 2) * 10 + 1);
      const ponyBpAS = Math.pow(ponyBuff, 1 / (pony + 1));
      if (ponyBpAS >= phanBuff) {
        as -= ++pony;
        continue;
      }
    }

    phan++;
    as--;
  }
  return [chor, phan, pony];
}

/** Borb level needed so FANT is not gated by monsters-per-zone. */
export function borbForFant(ancientSouls, transcendentPower) {
  const [, , pony] = nOS(ancientSouls * 0.5, transcendentPower, 100);
  const ponyBonus = Math.pow(pony, 2) * 10 + 1;
  // chor from the same sub-allocation is not returned by nOS at 0.5 budget;
  // recompute with the full split so the log term stays honest.
  const [chor] = nOS(ancientSouls * 0.5, transcendentPower, 100);
  const chorBonus = Math.pow(1 / 0.95, chor);
  const tp = 1 + transcendentPower;
  const s = tp * tp;
  const a = s + s * s + s * s * s;
  let logHSFant = Math.log10(Math.max(1, 20 * ponyBonus * a));
  logHSFant += Math.log10(chorBonus);
  const kumaFast = Math.max(1, Math.floor(logHSFant / Math.log10(2) - 3 / Math.log(2)) - 1);
  const kumaEffect = 8 * (1 - Math.exp(-0.025 * kumaFast));
  return Math.ceil((8 / kumaEffect - 1) * 8);
}

/**
 * Full allocation for a budget. Returns target levels per outsider id.
 * Mirrors the calculator's order: Borb, Xyl (0), the four "super" outsiders,
 * then Chor/Phan/Pony with whatever remains.
 */
export function allocate({ ancientSouls, transcendentPower, zone, orphalas = true }) {
  let remaining = ancientSouls;

  const borbFant = ancientSouls <= 2000
    ? Math.min(spendAS(0.35, remaining), borbForFant(ancientSouls, transcendentPower))
    : 0;
  let borb = Math.max(borbFant, 0);
  if (costFromLevel(borb) > remaining - 5) borb = spendAS(1, Math.max(0, remaining - 5));
  remaining -= costFromLevel(borb);

  const xyl = 0;

  const scale = ancientSouls < 100 ? ancientSouls / 100 : 1;
  const rhageistRatio = ancientSouls < 100 ? 0.2 * scale : ancientSouls < 21000 ? 0.2 : 0;
  const kariquaRatio = ancientSouls < 100 ? 0.01 * scale : ancientSouls < 21000 ? 0.01 : 0;
  const orphalasRatio = orphalas ? (ancientSouls < 100 ? 0.05 * scale : ancientSouls < 21000 ? 0.05 : 0) : 0;
  const senakhanRatio = ancientSouls < 100 ? 0.05 * scale : ancientSouls < 21000 ? 0.05 : 0;

  const rhageist = spendAS(rhageistRatio, remaining);
  const kariqua = spendAS(kariquaRatio, remaining);
  const orphalasLvl = spendAS(orphalasRatio, remaining);
  const senakhan = spendAS(senakhanRatio, remaining);
  remaining -= costFromLevel(rhageist);
  remaining -= costFromLevel(kariqua);
  remaining -= costFromLevel(orphalasLvl);
  remaining -= costFromLevel(senakhan);

  const [chor, phan, pony] = nOS(Math.max(0, remaining), transcendentPower, zone);

  return {
    Xyliqil: xyl,
    "Chor'gorloth": chor,
    Phandoryss: phan,
    Ponyboy: pony,
    Borb: borb,
    Rhageist: rhageist,
    "K'Ariqua": kariqua,
    Orphalas: orphalasLvl,
    "Sen-Akhan": senakhan,
    remaining: Math.max(0, remaining - costFromLevel(chor) - phan - costFromLevel(pony)),
  };
}
