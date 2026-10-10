import type { FlightVec } from "./flight";

export type VisibleWireTarget<T> = {
  target: T;
  position: FlightVec;
  // Normalised screen coordinates: -1..1 is the entire viewport.
  screenX: number;
  screenY: number;
  cameraDepth: number;
  blocked: boolean;
};

export function nearestVisibleWireTarget<T>(
  targets: VisibleWireTarget<T>[], player: FlightVec, nearPlane: number, maxDistance = Infinity, excludedTarget?: T,
): { target: T; distance: number } | null {
  let nearest: { target: T; distance: number } | null = null;
  for (const point of targets) {
    if (excludedTarget !== undefined && point.target === excludedTarget) continue;
    if (point.blocked || point.cameraDepth <= nearPlane ||
        !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY) ||
        Math.abs(point.screenX) > 1 || Math.abs(point.screenY) > 1) continue;
    const distance = Math.hypot(...point.position.map((v, i) => v - player[i]));
    if (!Number.isFinite(distance) || distance < .5 || distance > maxDistance) continue;
    if (!nearest || distance < nearest.distance) nearest = { target: point.target, distance };
  }
  return nearest;
}
