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
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), resolve(root, "src/flight.ts"), resolve(root, "src/wire-targeting.ts"), resolve(root, "src/flight-collision.ts"), "--target", "ES2020", "--module", "ES2020", "--moduleResolution", "Bundler", "--outDir", output, "--skipLibCheck", "--pretty", "false"], { cwd: root, stdio: "inherit" });
const flight = await import(pathToFileURL(resolve(output, "flight.js")).href);
const { nearestVisibleWireTarget } = await import(pathToFileURL(resolve(output, "wire-targeting.js")).href);
const { resolveFlightCollision } = await import(pathToFileURL(resolve(output, "flight-collision.js")).href);

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
  assert.ok(launch.velocity[1] >= 18 && !launch.grounded, "street attach lifts upward");
  assert.deepEqual(launch.velocity.slice(0,1).concat(launch.velocity.slice(2)),[0,0],"street takeoff avoids launching into a nearby wall");
  for(let i=0;i<60;i++) {
    const previous=[...launch.position];
    flight.stepAttached(launch,anchors[0],[0,0,0],1/120,false,-Infinity);
    resolveFlightCollision(launch,previous,[]);
    assert.equal(launch.grounded,false,"street recovery remains airborne");
  }
  assert.ok(launch.position[1]>7,"street recovery gains height");

  const fixture = () => ({position:[0,25,0],velocity:[0,0,0],grounded:false,attached:true,ropeLength:20});
  const small=fixture(), full=fixture();
  flight.stepAttached(small,[0,45,0],[.1,0,0],1/120,false);
  flight.stepAttached(full,[0,45,0],[1,0,0],1/120,false);
  assert.ok(Math.abs(small.velocity[0]/full.velocity[0]-.1)<.001,"analogue steering scales with input");
  for(const rope of [5,20]) {
    const boosted=fixture();boosted.ropeLength=rope;
    boosted.position=[0,45-rope,0];
    flight.stepAttached(boosted,[0,45,0],[0,0,0],1/120,true,1.15,[0,.5,1]);
    assert.equal(boosted.ropeLength,rope,"boost neither lengthens short ropes nor reels in long ones");
    assert.ok(boosted.velocity[1]<24/120,"boost vertical acceleration is applied once");
  }
  const inertia={position:[0,10,0],velocity:[20,0,0],grounded:false,attached:true,ropeLength:20};
  flight.stepAttached(inertia,[0,30,0],[-1,0,0],1/60,false);
  assert.ok(inertia.velocity[0]>19.7,"opposite steering does not instantly cancel swing momentum");
  const released={position:[0,20,0],velocity:[20,0,0],grounded:false,attached:false,ropeLength:20};
  flight.stepDetached(released,[-1,0,0],1/60,false);
  assert.ok(released.velocity[0]>19.8,"released body carries forward momentum against steering");
  const roof={x:0,z:0,halfX:10,halfZ:8,top:40};
  for(const attached of [false,true]) {
    const landing={position:[0,40.65,0],velocity:[2,-40,3],grounded:false,attached,ropeLength:25};
    assert.ok(resolveFlightCollision(landing,[0,41.3,0],[roof]),"roof collision detected");
    assert.deepEqual(landing.position,[0,41.15,0],"fast descent lands on the roof, not beside it");
    assert.deepEqual(landing.velocity,[2,0,3],"landing keeps horizontal momentum");
    assert.equal(landing.grounded,true);
  }
  const wall={position:[10.3,10,0],velocity:[-20,1,4],grounded:false,attached:true,ropeLength:25};
  resolveFlightCollision(wall,[10.7,10,0],[roof]);
  assert.ok(Math.abs(wall.position[0]-10.56)<1e-5,"wall separation");
  assert.deepEqual(wall.velocity,[0,1,4],"wall hit removes only inward velocity");
};

const target=(name,distance,x=0,y=0,depth=10,blocked=false)=>({target:name,position:[distance,0,0],screenX:x,screenY:y,cameraDepth:depth,blocked});
assert.equal(nearestVisibleWireTarget([target("centre",40),target("edge",10,.95,.9)], [0,0,0], .2).target,"edge","nearest point wins even at screen edge");
assert.equal(nearestVisibleWireTarget([target("outside",2,1.01),target("behind",3,0,0,-1),target("wall",4,0,0,10,true),target("near-plane",5,0,0,.1),target("visible",25)], [0,0,0], .2).target,"visible","offscreen, behind, occluded and clipped anchors excluded");
assert.equal(nearestVisibleWireTarget([target("far",200)], [0,1.15,0], .2).target,"far","street-level visible hooks have no range cap");
assert.equal(nearestVisibleWireTarget([target("far",99)], [0,0,0], .2,98),null,"optional explicit range remains supported");
assert.equal(nearestVisibleWireTarget([target("old",31),target("new",30.9,.8)], [0,0,0], .2).target,"new","no sticky previous target or centre bias");

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
