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
  resolve(root, "src/gameplay.ts"), resolve(root, "src/combat.ts"),
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

const combat = await import(pathToFileURL(resolve(output, 'combat.js')).href);
const weak = [0,14,0];
assert.equal(combat.chooseAttack([0,14,-30],[0,0,26],false,weak,true),'rush');
assert.equal(combat.chooseAttack([0,34,-8],[0,-10,12],false,weak,true),'dive');
assert.equal(combat.chooseAttack([0,34,-8],[0,8,12],false,weak,true),'normal','rising is not a dive');
assert.equal(combat.chooseAttack([0,14,-30],[0,0,-26],false,weak,true),'normal','flying away does not rush');
assert.equal(combat.chooseAttack([0,14,-30],[0,0,26],true,weak,true),'normal','grounded stays normal');
assert.equal(combat.chooseAttack([0,34,-8],[0,-10,12],false,weak,false),'normal','occluded/offscreen stays normal');
assert.equal(combat.chooseAttack([0,64,-8],[0,-10,12],false,weak,true),'normal','special range is bounded');
assert.ok(combat.sweptWeakpointHit([0,14,-20],[0,14,20],weak),'fast segment cannot skip hit');
assert.equal(combat.sweptWeakpointHit([10,14,-20],[10,14,20],weak),false,'misses do not hit');
for(const kind of ['rush','dive']) for(const fps of [30,60,120]) {
 const position=kind==='rush'?[0,14,-40]:[0,38,-8]; const original=[...position];
 let velocity=combat.attackVelocity(kind,position,[0,-8,26],weak), hit=false;
 assert.deepEqual(position,original,'attack launch never teleports');
 for(let i=0;i<fps*1.4;i++) {
  const previous=[...position];velocity=combat.guideAttack(position,velocity,weak,1/fps);velocity[1]-=18/fps;
  for(let axis=0;axis<3;axis++)position[axis]+=velocity[axis]/fps;
  if(combat.sweptWeakpointHit(previous,position,weak)){hit=true;break;}
 }
 assert.ok(hit,`${kind} reaches the target at ${fps}Hz`);
 const bounce=combat.impactVelocity(position,velocity,weak);assert.ok(bounce[1]>0,'impact returns to flight');
}
const heavy=gameplay.createProgressState(0,3);assert.equal(gameplay.tryAttack(heavy,true,1.4,2),'hit');assert.equal(heavy.giantHp,1);assert.equal(gameplay.tryAttack(heavy,true,1.4,2),'cooldown');assert.equal(heavy.giantHp,1,'one press cannot repeatedly damage');gameplay.tickAttackCooldown(heavy,1.4);gameplay.tryAttack(heavy,true,1.4,2);assert.equal(heavy.giantHp,0,'lethal damage clamps HP');
console.log('combat verification: PASS (rush/dive eligibility, actual travel, swept contact, misses, cooldown, damage and rebound at 30/60/120Hz)');
