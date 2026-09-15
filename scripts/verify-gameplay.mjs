import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".artifacts", "gameplay-check");
const require = createRequire(import.meta.url);
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [
  require.resolve("typescript/bin/tsc"),
  resolve(root, "src/gameplay.ts"),
  "--target", "ES2020", "--module", "ES2020", "--moduleResolution", "Bundler",
  "--outDir", output, "--skipLibCheck", "--pretty", "false",
], { cwd: root, stdio: "inherit" });

const gameplay = await import(pathToFileURL(resolve(output, "gameplay.js")).href);
const state = gameplay.createProgressState(12, 3);
const flight = { y: 1.15, vy: 0, grounded: true };

flight.vy = gameplay.wireLaunchVelocity(flight.grounded, flight.y, 1.15, 18, flight.vy);
assert.ok(flight.vy >= 7.5, "ground attach produces upward launch");

const momentumBefore = 24;
const [releasedX] = gameplay.airMomentumStep(momentumBefore, 0, 0, 0, 0.5, false);
assert.ok(releasedX >= momentumBefore * 0.85, "release keeps horizontal momentum");

assert.equal(gameplay.collectCoin(state, 0), true);
assert.equal(gameplay.collectCoin(state, 0), false);
assert.equal(gameplay.tryAttack(state, false), "out-of-range");
assert.equal(gameplay.tryAttack(state, true), "cooldown");
assert.equal(state.giantHp, 3, "cooldown does not reduce HP");
gameplay.tickAttackCooldown(state, 0.7);
for (let index = 1; index < 8; index += 1) gameplay.collectCoin(state, index);
assert.equal(gameplay.isStageClear(state), false, "coins alone do not clear");
for (let hit = 0; hit < 3; hit += 1) {
  gameplay.tickAttackCooldown(state, 0.7);
  assert.equal(gameplay.tryAttack(state, true), "hit");
}
assert.equal(gameplay.isStageClear(state), true);
const giantOnly = gameplay.createProgressState(12, 3);
giantOnly.giantHp = 0;
assert.equal(gameplay.isStageClear(giantOnly), false, "giant defeat alone does not clear");
gameplay.resetProgress(state);
assert.deepEqual(state, gameplay.createProgressState(12, 3), "retry resets coins, HP and cooldown");
console.log("gameplay verification: PASS (takeoff launch, release momentum, coin dedupe, attack cooldown, clear prerequisites, retry)");
