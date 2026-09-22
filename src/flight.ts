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
  state.ropeLength = Math.max(length(offset), 0.5);
  if (state.grounded) {
    const forward = normalize([cameraForward[0], 0, cameraForward[2]]);
    state.velocity[0] += forward[0] * 12;
    state.velocity[2] += forward[2] * 12;
    state.velocity[1] = Math.max(state.velocity[1], 8);
    state.grounded = false;
  }
};

export const stepAttached = (state: FlightState, anchor: FlightVec, input: FlightVec, dt: number, boosting: boolean, groundY = 1.15, boostForward: FlightVec = [0, 0, 1]): void => {
  const offset: FlightVec = [state.position[0] - anchor[0], state.position[1] - anchor[1], state.position[2] - anchor[2]];
  const radial = normalize(offset);
  state.velocity[1] += -18 * dt;
  const tangentDot = dot(input, radial);
  const tangent: FlightVec = [input[0] - radial[0] * tangentDot, input[1] - radial[1] * tangentDot, input[2] - radial[2] * tangentDot];
  if (length(tangent) > 0.001) {
    const tangentDirection = normalize(tangent);
    state.velocity[0] += tangentDirection[0] * 28 * dt;
    state.velocity[1] += tangentDirection[1] * 28 * dt;
    state.velocity[2] += tangentDirection[2] * 28 * dt;
  }
  if (boosting) {
    const boostSource = length(input) > 0.001 ? input : boostForward;
    const boostDirection = normalize([boostSource[0], Math.max(0, boostSource[1]), boostSource[2]]);
    state.velocity[0] += boostDirection[0] * 34 * dt;
    state.velocity[1] += boostDirection[1] * 34 * dt;
    state.velocity[2] += boostDirection[2] * 34 * dt;
    state.velocity[1] += Math.max(0, boostDirection[1]) * 45 * dt;
    state.ropeLength = Math.max(12, state.ropeLength - 6 * dt);
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
    if (outward > 0) {
      state.velocity[0] -= correctedRadial[0] * outward;
      state.velocity[1] -= correctedRadial[1] * outward;
      state.velocity[2] -= correctedRadial[2] * outward;
    }
  } else state.position = next;
  if (state.position[1] < groundY) {
    state.position[1] = groundY;
    state.velocity[1] = Math.max(0, state.velocity[1]);
    state.grounded = true;
  } else state.grounded = false;
};

export const releaseFlight = (state: FlightState): void => { state.attached = false; };

export const stepDetached = (state: FlightState, input: FlightVec, dt: number, boosting: boolean, boostForward: FlightVec = [0, 0.35, 1], gravity = -18, maxSpeed = 42, integratePosition = true): void => {
  const drag = Math.pow(0.997, dt * 60);
  const steering = (boosting ? 18 : 15) * dt;
  state.velocity[0] = state.velocity[0] * drag + input[0] * steering;
  state.velocity[2] = state.velocity[2] * drag + input[2] * steering;
  state.velocity[1] += gravity * dt;
  if (boosting) {
    const boostDirection = normalize([boostForward[0], Math.max(0, boostForward[1]), boostForward[2]]);
    state.velocity[0] += boostDirection[0] * 26 * dt;
    state.velocity[1] += boostDirection[1] * (26 + 45) * dt;
    state.velocity[2] += boostDirection[2] * 26 * dt;
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
