// One-shot state dump: `npm run state [-- <savefile>]`
import { readSave } from "./save.mjs";
import { buildState, fmt } from "./engine.mjs";

const file = process.argv[2] || null;
const { save, path, mtimeMs } = await readSave(file);
const s = buildState(save, { now: Date.now() });

console.log(`save: ${path}`);
console.log(`  modified ${new Date(mtimeMs).toISOString()}  patch ${s.meta.patch}  v${s.meta.version}`);
console.log(`zone ${s.zone.current}  HZE ${s.zone.hze} (persist ${s.zone.hzePersist})  transcensions ${s.zone.transcensions}`);
console.log(`gold ${fmt(s.resources.gold)}  souls ${fmt(s.resources.heroSouls)}  soul bonus +${fmt(s.resources.soulsBonusPercent)}%  rubies ${s.resources.rubies}`);
console.log(`dps ${fmt(s.combat.dps)}  idle ${fmt(s.combat.effectiveIdleDps)}  click ${fmt(s.combat.clickDamage)}`);
console.log(`monster@${s.zone.current}: ${fmt(s.combat.monsterHp)} hp, ${s.combat.monsterSeconds.toFixed(2)}s`);
console.log(`boss@${s.combat.bossZone}: ${fmt(s.combat.bossHp)} hp, ${s.combat.bossSeconds.toFixed(2)}s`);
console.log(`instakill zone ~${s.combat.instakillZone}`);
console.log("\nancients:");
for (const a of s.ancients) {
  console.log(`  ${a.name.padEnd(12)} lvl ${String(a.level).padStart(5)}  next ${fmt(a.nextCost).padStart(10)}  ${a.effect.slice(0, 60)}`);
}
console.log("\ntop heroes:");
for (const h of s.heroes.slice(0, 6)) console.log(`  ${h.name.padEnd(22)} lvl ${String(h.level).padStart(5)} gilds ${h.gilds}  dps ${fmt(h.dps)}`);
console.log("\nmercs:", s.mercs.map(m => `${m.name}(r${m.rarity},l${m.level})`).join(", ") || "none");
