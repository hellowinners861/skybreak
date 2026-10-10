// Metres in world X/Z. Planning stays independent of Babylon so coverage and
// exclusion of streets/buildings can be verified without a graphics context.
export type GroundRect = [number, number, number, number];
export type GroundFinish = "stone" | "slate" | "grass" | "edge";
export type GroundPatch = { rect: GroundRect; finish: GroundFinish; place: string };
export type GardenBench = { x: number; z: number; alongZ: boolean };
export const GROUND_BOUNDS: GroundRect = [-120, -120, 120, 120];

export function subtractGround(a: GroundRect, b: GroundRect): GroundRect[] {
  const x0 = Math.max(a[0], b[0]), z0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]), z1 = Math.min(a[3], b[3]);
  if (x0 >= x1 || z0 >= z1) return [a];
  return [
    [a[0], a[1], x0, a[3]], [x1, a[1], a[2], a[3]],
    [x0, a[1], x1, z0], [x0, z1, x1, a[3]],
  ].filter(r => r[2] - r[0] > 0.0001 && r[3] - r[1] > 0.0001) as GroundRect[];
}

export function planCityLandscape(occupied: GroundRect[]) {
  const patches: GroundPatch[] = [];
  const benches: GardenBench[] = [];
  const claimed = [...occupied];
  const fill = (rect: GroundRect, finish: GroundFinish, place: string) => {
    const clipped: GroundRect = [Math.max(-120, rect[0]), Math.max(-120, rect[1]), Math.min(120, rect[2]), Math.min(120, rect[3])];
    if (clipped[2] <= clipped[0] || clipped[3] <= clipped[1]) return;
    let pieces = [clipped];
    for (const mask of claimed) pieces = pieces.flatMap(p => subtractGround(p, mask));
    for (const piece of pieces) {
      patches.push({rect: piece, finish, place});
      claimed.push(piece);
    }
  };
  const lawn = (r: GroundRect, place: string) => {
    // A narrow, consistent stone border makes planting read as intentional.
    const e = .22;
    fill([r[0]+e, r[1]+e, r[2]-e, r[3]-e], "grass", place);
    fill(r, "edge", place);
  };

  // Shared courts occupy the generous gaps; the 2m residual alleys stay paved.
  for (const sign of [-1, 1]) {
    const mirror = (r: GroundRect): GroundRect => sign < 0 ? [-r[2],r[1],-r[0],r[3]] : r;
    for (const [z0,z1] of [[-45,-34],[34,45]]) {
      // East-side facades sit farther into the gap than their west neighbours.
      lawn(sign < 0 ? [-55.8,z0,-54.1,z1] : [55.7,z0,57.4,z1], "shared-court");
    }
    // These low beds leave the central carriageway and course supports clear.
    for (const [z0,z1] of [[-48,-29],[29,39]]) {
      lawn(mirror([10,z0,18,z1]), "central-garden");
    }
    // A walk across each pair of rear plots connects the two street frontages.
    fill(mirror([6,94,90,97]), "stone", "park-crosswalk");
    fill(mirror([54,83,57,114]), "stone", "park-walk");
    lawn(mirror([31,88,51,111]), "pocket-park");
    lawn(mirror([60,88,84,111]), "pocket-park");
    fill(mirror([29,85,86,114]), "stone", "park-terrace");
    benches.push({x:sign*52.6,z:102,alongZ:true});
    // A continuous outer promenade, punctuated by road crossings.
    fill(mirror([108,-120,111,120]), "stone", "outer-promenade");
    lawn(mirror([103,-118,107,118]), "outer-greenbelt");
    lawn(mirror([112,-118,118,118]), "outer-greenbelt");
    // Launch plaza: an uncluttered apron and a pair of long planted edges.
    lawn(mirror([12,-76,22,-69]), "launch-garden");
    fill(mirror([6,-80,30,-62]), "stone", "launch-plaza");
    fill(mirror([6,-107,30,-96]), "stone", "launch-arrival");
    benches.push({x:sign*18,z:-66.5,alongZ:false});
    // Deep rear setbacks get a planted strip, with room for service access.
    lawn(mirror([33,-101,85,-91]), "rear-garden");
    fill(mirror([6,-89,90,-86]), "slate", "rear-access");
  }
  fill([-120,112,120,115], "stone", "outer-promenade");
  fill([-120,-115,120,-112], "stone", "outer-promenade");
  // Use the same calm paving throughout the built-up area. Existing door
  // aprons retain their facade colours; infill never covers them.
  fill([-90,-89,90,86], "stone", "connected-forecourts");
  // Any remaining edge land is intentionally green, never exposed base ground.
  fill(GROUND_BOUNDS, "grass", "greenbelt");
  return { patches, benches };
}
