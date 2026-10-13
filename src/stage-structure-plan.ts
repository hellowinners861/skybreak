// Stage 2 additions keep the original tower heights and central patrol corridor.
export const BRIDGES = [-210, 210].map(x => ({ x, z: -112, halfX: 2.4, halfZ: 24, bottom: 71.4, top: 72, style: 1 }));
export const TERRACES = [
  { x: -104, z: -80, halfX: 12, halfZ: 11, top: 27, style: 2 },
  { x: -98, z: -80, halfX: 6, halfZ: 8, top: 54, style: 2 },
  { x: 106, z: 78, halfX: 12, halfZ: 9, top: 28, style: 2 },
  { x: 100, z: 78, halfX: 6, halfZ: 7, top: 56, style: 2 },
];
export const WATER_TOWERS = [
  { x: -124, z: -144, roof: 42, style: 0 },
  { x: 140, z: 76, roof: 54, style: 0 },
];
export const TERRACE_FOOTPRINTS = TERRACES.map(({x,z,halfX,halfZ}): [number,number,number,number] => [x-halfX,z-halfZ,x+halfX,z+halfZ]);
