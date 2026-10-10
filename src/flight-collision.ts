import type { FlightState, FlightVec } from "./flight";

export type FlightObstacle = { x: number; z: number; halfX: number; halfZ: number; top: number };

// Both swinging and free flight land on the same roofs and slide against the
// same walls. The previous feet position distinguishes landing from a side hit.
export function resolveFlightCollision(
  state: FlightState, previous: FlightVec, buildings: FlightObstacle[],
  halfHeight = 1.15, radius = .56,
): boolean {
  const next = state.position;
  let touched = false;
  state.grounded = false;
  if (next[1] <= halfHeight) {
    next[1] = halfHeight;
    state.velocity[1] = Math.max(0, state.velocity[1]);
    state.grounded = true;
    touched = true;
  }
  for (const building of buildings) {
    const overlapX = building.halfX + radius - Math.abs(next[0] - building.x);
    const overlapZ = building.halfZ + radius - Math.abs(next[2] - building.z);
    if (overlapX <= 0 || overlapZ <= 0 || next[1] - halfHeight > building.top + .001 || next[1] + halfHeight <= 0) continue;
    if (previous[1] - halfHeight >= building.top - .001 && state.velocity[1] <= 0) {
      next[1] = building.top + halfHeight;
      state.velocity[1] = 0;
      state.grounded = true;
    } else if (overlapX < overlapZ) {
      const side = Math.sign(previous[0] - building.x) || Math.sign(next[0] - building.x) || 1;
      next[0] = building.x + side * (building.halfX + radius);
      if (state.velocity[0] * side < 0) state.velocity[0] = 0;
    } else {
      const side = Math.sign(previous[2] - building.z) || Math.sign(next[2] - building.z) || 1;
      next[2] = building.z + side * (building.halfZ + radius);
      if (state.velocity[2] * side < 0) state.velocity[2] = 0;
    }
    touched = true;
  }
  return touched;
}
