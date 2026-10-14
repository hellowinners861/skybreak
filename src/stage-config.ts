import type { FlightVec } from './flight';
export type StageId = 1 | 2 | 3;
export type StageLot = [number, number, number, number, number];
export const BASE_LOTS: StageLot[] = [
  [-62,-72,9,8,14],[-38,-72,10,8,21],[38,-72,10,8,17],[62,-72,9,8,25],
  [-70,-40,12,9,18],[-42,-40,9,11,27],[42,-40,12,10,21],[70,-40,10,8,13],
  [-70,0,13,10,23],[-42,2,10,9,15],[42,1,11,12,24],[70,4,8,9,18],
  [-70,40,11,10,16],[-42,42,10,8,22],[42,39,12,9,28],[70,38,9,11,18],
  [-62,72,13,9,20],[-30,72,10,11,15],[30,72,10,11,24],[62,72,12,10,24],
];
export const STAGE_ONE_COINS: FlightVec[] = [[-77,15,-72],[-58,20,-58],[-39,26,-47],[-20,20,-37],[0,25,-27],[20,28,-16],[37,23,-3],[46,27,14],[37,30,31],[24,23,45],[7,23,57],[-13,20,65]];
export const STAGE_TWO_COINS: FlightVec[] = [[-76,67,-144],[-84,85,-80],[-90,74,0],[-84,72,84],[-100,74,144],[-22,62,95],[40,72,74],[84,90,78],[92,78,2],[84,70,-80],[60,79,-144],[5,65,-95]];
export function stageConfig(id: StageId) {
  const scale = id !== 1 ? 2 : 1, height = id !== 1 ? 3 : 1;
  const lots: StageLot[] = BASE_LOTS.map(([x,z,hx,hz,h])=>[x*scale,z*scale,hx,hz,h*height]);
  if (id !== 1) for (const side of [-1,1]) for (const z of [-144,-80,80,144]) lots.push([side*210,z,9,9,72]);
  return { id, worldScale: scale, heightScale: height, giantScale: id !== 1 ? 4 : 1, halfExtent: 120*scale, playableHalfExtent:116*scale, launchHeight:40*height, launchZ:-88*scale, spawn:[0,40*height+1.15,-88*scale+(id===3?6.5:2)] as FlightVec, lots, coins:id!==1?STAGE_TWO_COINS:STAGE_ONE_COINS };
}
export function giantPose(seconds: number) {
  const angle = seconds*.05;
  return { position:[22*Math.sin(angle),0,-90*Math.cos(angle)] as FlightVec, yaw:Math.atan2(-22*Math.cos(angle),-90*Math.sin(angle)) };
}
export function giantPoint(local: FlightVec, pose: { position: FlightVec; yaw: number }, scale: number): FlightVec {
  const [x,y,z] = local, c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
  return [pose.position[0]+(x*c+z*s)*scale,pose.position[1]+y*scale,pose.position[2]+(-x*s+z*c)*scale];
}
