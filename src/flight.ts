export type FlightVec = [number, number, number];

export const COURSE_ANCHORS: readonly FlightVec[] = [
  [6, 54, -62],
  [-6, 54, -38],
  [6, 54, -14],
];

export type FlightState = {
  position: FlightVec;
  velocity: FlightVec;
  grounded: boolean;
  attached: boolean;
  ropeLength: number;
  recoveryRemaining?: number;
  reelSpeed?: number;
};

const length = (v: FlightVec): number => Math.hypot(v[0], v[1], v[2]);
const normalize = (v: FlightVec): FlightVec => {
  const size = Math.max(length(v), 0.0001);
  return [v[0] / size, v[1] / size, v[2] / size];
};
const dot = (a: FlightVec, b: FlightVec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const crossedCourseAnchor = (previousZ: number, nextZ: number, anchor: FlightVec, x: number): boolean =>
  previousZ < anchor[2] && nextZ >= anchor[2] && Math.abs(x - anchor[0]) <= 20;

export const attachToAnchor = (state: FlightState, anchor: FlightVec, cameraForward: FlightVec): void => {
  const offset: FlightVec = [state.position[0] - anchor[0], state.position[1] - anchor[1], state.position[2] - anchor[2]];
  state.attached = true;
  state.recoveryRemaining = 0;
  state.reelSpeed = 0;
  state.ropeLength = Math.max(length(offset), 0.5);
  if (state.grounded) {
    const towardAnchor: FlightVec = [-offset[0], 0, -offset[2]];
    const forward = normalize(length(towardAnchor) > .1 ? towardAnchor : [cameraForward[0], 0, cameraForward[2]]);
    state.velocity[0] += forward[0] * 8;
    state.velocity[2] += forward[2] * 8;
    // Street-level recovery needs enough lift to leave the ground and steer.
    // Launch vertically first so a nearby facade does not cancel takeoff at once.
    if (state.position[1] <= 1.16) {
      state.velocity[0] = 0;
      state.velocity[2] = 0;
      state.velocity[1] = Math.max(state.velocity[1], 3);
      if (anchor[1] > state.position[1] + 2) state.recoveryRemaining = 1.4;
    } else state.velocity[1] = Math.max(state.velocity[1], 6);
    state.grounded = false;
  }
};

export const stepAttached = (state: FlightState, anchor: FlightVec, input: FlightVec, dt: number, boosting: boolean, groundY = 1.15, boostForward: FlightVec = [0, 0, 1]): void => {
  const offset: FlightVec = [state.position[0] - anchor[0], state.position[1] - anchor[1], state.position[2] - anchor[2]];
  const radial = normalize(offset);
  let reelSpeed = 0;
  if ((state.recoveryRemaining ?? 0) > 0) {
    const reelDt = Math.min(dt, state.recoveryRemaining!);
    const previousSpeed = state.reelSpeed ?? 0;
    state.reelSpeed = Math.min(18, previousSpeed + 30 * reelDt);
    const shortened = Math.min(Math.max(0, state.ropeLength - 2), (previousSpeed + state.reelSpeed) * .5 * reelDt);
    state.ropeLength -= shortened;
    reelSpeed = shortened / Math.max(dt, .000001);
    state.recoveryRemaining = Math.max(0, state.recoveryRemaining! - dt);
  }
  state.velocity[1] += -18 * dt;
  const tangentDot = dot(input, radial);
  const tangent: FlightVec = [input[0] - radial[0] * tangentDot, input[1] - radial[1] * tangentDot, input[2] - radial[2] * tangentDot];
  // Preserve analogue input strength; do not turn a tiny joystick movement
  // (or an almost radial input) into full-strength tangential acceleration.
  state.velocity[0] += tangent[0] * 16 * dt;
  state.velocity[1] += tangent[1] * 16 * dt;
  state.velocity[2] += tangent[2] * 16 * dt;
  if (boosting) {
    const boostSource = length(input) > 0.001 ? input : boostForward;
    const boostDirection = normalize([boostSource[0], Math.max(0, boostSource[1]), boostSource[2]]);
    state.velocity[0] += boostDirection[0] * 24 * dt;
    state.velocity[1] += boostDirection[1] * 24 * dt;
    state.velocity[2] += boostDirection[2] * 24 * dt;
    // Boost is thrust, not an automatic winch: keep the captured rope length.
  }
  const speed = length(state.velocity);
  if (speed > 42) {
    const scale = 42 / speed;
    state.velocity = [state.velocity[0] * scale, state.velocity[1] * scale, state.velocity[2] * scale];
  }
  const next: FlightVec = [state.position[0] + state.velocity[0] * dt, state.position[1] + state.velocity[1] * dt, state.position[2] + state.velocity[2] * dt];
  const nextOffset: FlightVec = [next[0] - anchor[0], next[1] - anchor[1], next[2] - anchor[2]];
  const nextDistance = length(nextOffset);
  if (nextDistance > state.ropeLength) {
    const scale = state.ropeLength / nextDistance;
    state.position = [anchor[0] + nextOffset[0] * scale, anchor[1] + nextOffset[1] * scale, anchor[2] + nextOffset[2] * scale];
    const correctedRadial = normalize([state.position[0] - anchor[0], state.position[1] - anchor[1], state.position[2] - anchor[2]]);
    const outward = dot(state.velocity, correctedRadial);
    // A powered spool pulls inward at its shortening speed. Tangential
    // momentum survives; normal swinging resumes when the short recovery ends.
    if (outward > -reelSpeed) {
      state.velocity[0] -= correctedRadial[0] * (outward + reelSpeed);
      state.velocity[1] -= correctedRadial[1] * (outward + reelSpeed);
      state.velocity[2] -= correctedRadial[2] * (outward + reelSpeed);
    }
  } else state.position = next;
  if (state.position[1] < groundY) {
    state.position[1] = groundY;
    state.velocity[1] = Math.max(0, state.velocity[1]);
    state.grounded = true;
  } else state.grounded = false;
};

export const releaseFlight = (state: FlightState): void => { state.attached = false; state.recoveryRemaining = 0; state.reelSpeed = 0; };

export const stepDetached = (state: FlightState, input: FlightVec, dt: number, boosting: boolean, boostForward: FlightVec = [0, 0.35, 1], gravity = -18, maxSpeed = 42, integratePosition = true): void => {
  const drag = Math.pow(0.999, dt * 60);
  const steering = (boosting ? 10 : 8) * dt;
  state.velocity[0] = state.velocity[0] * drag + input[0] * steering;
  state.velocity[2] = state.velocity[2] * drag + input[2] * steering;
  state.velocity[1] += gravity * dt;
  if (boosting) {
    const boostDirection = normalize([boostForward[0], Math.max(0, boostForward[1]), boostForward[2]]);
    state.velocity[0] += boostDirection[0] * 20 * dt;
    state.velocity[1] += boostDirection[1] * 20 * dt;
    state.velocity[2] += boostDirection[2] * 20 * dt;
  }
  const speed = length(state.velocity);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    state.velocity = [state.velocity[0] * scale, state.velocity[1] * scale, state.velocity[2] * scale];
  }
  if (integratePosition) {
    state.position = [
      state.position[0] + state.velocity[0] * dt,
      state.position[1] + state.velocity[1] * dt,
      state.position[2] + state.velocity[2] * dt,
    ];
  }
  state.grounded = false;
};
