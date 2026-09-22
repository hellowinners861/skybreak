import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".artifacts", "flight-check");
const require = createRequire(import.meta.url);
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), resolve(root, "src/flight.ts"), "--target", "ES2020", "--module", "ES2020", "--moduleResolution", "Bundler", "--outDir", output, "--skipLibCheck", "--pretty", "false"], { cwd: root, stdio: "inherit" });
const flight = await import(pathToFileURL(resolve(output, "flight.js")).href);

const anchors = flight.COURSE_ANCHORS;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const speed = (state) => Math.hypot(...state.velocity);
const inputToward = (state, anchor) => {
  const dx = anchor[0] - state.position[0];
  const dz = anchor[2] - state.position[2];
  const length = Math.max(Math.hypot(dx, dz), 0.001);
  return [dx / length, 0, dz / length];
};
const substeps = (duration, callback) => {
  let remaining = duration;
  while (remaining > 1e-9) {
    const step = Math.min(remaining, 1 / 120);
    callback(step);
    remaining -= step;
  }
};

const verifyInvariants = () => {
  const near = { position: [0, 41.15, 0], velocity: [3, 2, -4], grounded: false, attached: false, ropeLength: 0 };
  flight.attachToAnchor(near, [0, 41.15, 98], [0, 0, 1]);
  assert.ok(Math.abs(near.ropeLength - 98) < 0.01, "near-98m attach preserves rope length");
  assert.deepEqual(near.position, [0, 41.15, 0], "attach does not teleport");
  const speedBefore = speed(near);
  flight.attachToAnchor(near, [0, 41.15, 97], [0, 0, 1]);
  assert.equal(speed(near), speedBefore, "midair attach adds no speed");
  const velocityBeforeRelease = [...near.velocity];
  flight.releaseFlight(near);
  assert.deepEqual(near.velocity, velocityBeforeRelease, "release preserves velocity");

  const swing = { position: [0, 25, 0], velocity: [8, 0, 0], grounded: false, attached: false, ropeLength: 0 };
  flight.attachToAnchor(swing, [0, 25, 20], [0, 0, 1]);
  const energyBefore = 0.5 * speed(swing) ** 2 + 18 * swing.position[1];
  for (let index = 0; index < 600; index += 1) flight.stepAttached(swing, [0, 25, 20], [0, 0, 0], 1 / 120, false);
  const energyAfter = 0.5 * speed(swing) ** 2 + 18 * swing.position[1];
  assert.ok(Math.abs(energyAfter - energyBefore) < 24, "neutral rope integration remains energy-stable");
  const launch = { position: [0, 1.15, 0], velocity: [0, 0, 0], grounded: true, attached: false, ropeLength: 0 };
  flight.attachToAnchor(launch, anchors[0], [0, 0, 1]);
  assert.ok(launch.velocity[1] >= 8 && !launch.grounded, "ground attach launches upward");
};

const simulate = (fps) => {
  const dt = 1 / fps;
  const state = { position: [0, 41.15, -86], velocity: [0, 0, 0], grounded: true, attached: false, ropeLength: 0 };
  const reconnectSpeeds = [];
  const heights = [];
  let elapsed = 0;
  let boostClock = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const previousSpeed = speed(state);
    flight.attachToAnchor(state, anchor, [0, 0, 1]);
    if (index > 0) assert.ok(previousSpeed >= 8, `anchor ${index + 1} reconnect speed too low at ${fps}Hz: ${previousSpeed}`);
    reconnectSpeeds.push(speed(state));
    let previousZ = state.position[2];
    let credited = false;
    for (let frame = 0; frame < Math.round(fps * 8); frame += 1) {
      boostClock += dt;
      substeps(dt, (step) => {
        if (credited) return;
        previousZ = state.position[2];
        flight.stepAttached(state, anchor, inputToward(state, anchor), step, (boostClock % 1.7) < 0.7, 1.15, [0, 0.35, 1]);
        elapsed += step;
        heights.push(state.position[1]);
        assert.ok(!state.grounded && state.position[1] > 1.15, `ground contact at anchor ${index + 1}, ${fps}Hz`);
        if (flight.crossedCourseAnchor(previousZ, state.position[2], anchor, state.position[0])) credited = true;
      });
      if (credited) break;
    }
    assert.ok(credited, `did not cross anchor ${index + 1} plane at ${fps}Hz`);
    flight.releaseFlight(state);
    if (index === anchors.length - 1) break;
    for (let frame = 0; frame < Math.round(fps * 0.2); frame += 1) {
      substeps(dt, (step) => {
        flight.stepDetached(state, inputToward(state, anchors[index + 1]), step, false, [0, 0.35, 1]);
        elapsed += step;
        heights.push(state.position[1]);
        assert.ok(!state.grounded && state.position[1] > 1.15, `ground contact during release ${index + 1}, ${fps}Hz`);
      });
    }
    let reachedNext = false;
    for (let frame = 0; frame < Math.round(fps * 8); frame += 1) {
      if (distance(state.position, anchors[index + 1]) <= 98) { reachedNext = true; break; }
      substeps(dt, (step) => {
        flight.stepDetached(state, inputToward(state, anchors[index + 1]), step, false, [0, 0.35, 1]);
        elapsed += step;
        heights.push(state.position[1]);
        assert.ok(!state.grounded && state.position[1] > 1.15, `ground contact before anchor ${index + 2}, ${fps}Hz`);
      });
    }
    assert.ok(reachedNext, `did not reach reconnect range for anchor ${index + 2} at ${fps}Hz`);
  }
  assert.ok(elapsed <= 30, `route exceeded 30 seconds at ${fps}Hz: ${elapsed}`);
  return { reconnectSpeeds, minHeight: Math.min(...heights), elapsed };
};

verifyInvariants();
const runs = [30, 60, 120].map((fps) => [fps, simulate(fps)]);
const reference = runs[1][1].reconnectSpeeds;
for (const [fps, result] of runs) assert.ok(result.reconnectSpeeds.every((value, index) => Math.abs(value - reference[index]) < 8), `frame-rate divergence at ${fps}Hz`);
console.log(`flight verification: PASS (3 airborne anchors, release/reconnect, minheight ${Math.min(...runs.map(([, result]) => result.minHeight)).toFixed(2)}m, speeds ${reference.map((value) => value.toFixed(1)).join("/")}m/s, elapsed ${runs.map(([fps, result]) => `${fps}:${result.elapsed.toFixed(2)}s`).join(" ")})`);
