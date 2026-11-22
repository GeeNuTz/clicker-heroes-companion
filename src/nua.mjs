/**
 * Closed-form "next useful ancient level" targets.
 *
 * Ported from graceoflives' calculator (github.com/graceoflives/fluffy-garbanzo,
 * js/functions.js) — readable source, unlike zuils' minified bundle. These give
 * the optimal level for the utility ancients as a function of your main damage
 * ancient's level, TP and the HP scale, with the same caps the community uses.
 */
import Decimal from "decimal.js";

const D = (v) => new Decimal(v ?? 0);
const LN2 = Math.log(2);

/** Core solver. Mirrors grace's getNUALevel exactly. */
export function nuaLevel(a, b, c, d, s, threshold = 0) {
  const testvalue = D(d).div(a);
  const min = Decimal.min(c, D(c).plus(s));
  const max = Decimal.max(c, D(c).plus(s));
  const loc1 = D(b).plus(LN2);
  const left = Decimal.floor(D(d).div(a).div(max).ln().div(loc1));
  const right = Decimal.ceil(D(d).div(a).div(min).ln().div(loc1));

  if (threshold > 0 && left.gte(threshold)) return D(threshold);

  for (let i = left; i.lte(right); i = i.plus(1)) {
    const lhs = Decimal.pow(2 * Math.exp(b), i).times(
      Decimal.pow(Math.exp(1), i.times(-b)).times(s).plus(c),
    );
    if (lhs.gte(testvalue)) return Decimal.max(1, i);
  }
  return right.toNumber();
}

export const UTILITY_CAPS = {
  Dogcog: 3743,
  Fortuna: 14972,
  Atman: 2880,
  Dora: 18715,
  Chronos: 1101,
  Bubos: 18715,
  Kumawakamaru: 1498,
};

/**
 * Optimal levels for the utility ancients.
 * `m` is the main damage ancient's level (Siyalatas when idle, Fragsworth when
 * active), matching grace's model. `alpha` derives from TP and the HP scale.
 */
export function utilityTargets({ m, tp, hpScale, bestHero = "base" }) {
  const M = D(m);
  const hp = D(hpScale);
  const factor = bestHero === "e9" ? 1.1085 : bestHero === "base" ? 1.4067 : 1.8053;
  const alpha = D(factor).times(D(1).plus(tp).ln()).div(hp.ln());
  const sq = M.pow(2);

  const out = {};
  out.Dogcog = nuaLevel(200 * LN2, 0.01, 1 / 9999999999, sq.times(0.927), 1, UTILITY_CAPS.Dogcog);
  out.Fortuna = nuaLevel(800 * LN2, 0.0025, 10 / 9, sq.times(0.927), -1, UTILITY_CAPS.Fortuna);
  out.Atman = nuaLevel((2 / 0.013) * LN2, 0.013, 4 / 3, sq.div(alpha), -1, UTILITY_CAPS.Atman);
  out.Dora = nuaLevel(1000 * LN2, 0.002, 100 / 99, sq.times(0.927), -1, UTILITY_CAPS.Dora);
  out.Chronos = nuaLevel((2 / 0.034) * LN2, 0.034, 2, sq, -1, UTILITY_CAPS.Chronos);
  out.Bubos = nuaLevel(100 * LN2, 0.002, 1, sq, 1, UTILITY_CAPS.Bubos);
  out["Kumawakamaru"] = nuaLevel(200 * LN2, 0.025, 0.25, sq.div(alpha), 1, UTILITY_CAPS.Kumawakamaru);

  for (const k of Object.keys(out)) out[k] = Math.max(0, Math.floor(Number(out[k]) || 0));
  return out;
}
