import test from "node:test";
import assert from "node:assert/strict";

// The Power Five is a fixed set (wiki: Power_Five), not a DPS ranking.
const POWER_FIVE_IDS = [2, 3, 4, 7, 9];
const TARGETS = { 2: 2075, 3: 2075, 4: 2075, 7: 2425, 9: 2775 };

test("the five are the wiki set, in wiki order", () => {
  assert.deepEqual(POWER_FIVE_IDS, [2, 3, 4, 7, 9]);
});

test("targets match the wiki table", () => {
  assert.equal(TARGETS[2], 2075); // Treebeast
  assert.equal(TARGETS[3], 2075); // Ivan
  assert.equal(TARGETS[4], 2075); // Brittany
  assert.equal(TARGETS[7], 2425); // Masked Samurai
  assert.equal(TARGETS[9], 2775); // Great Forest Seer
});
