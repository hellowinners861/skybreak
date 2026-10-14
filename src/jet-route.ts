import type { FlightVec } from './flight';
export const JET_PERIOD = 52;
const WAYPOINTS: FlightVec[] = [[0,135,-150],[15,138,-65],[8,141,45],[0,138,155],[-120,135,145],[-165,134,10],[-100,133,-135],[-35,134,-165]];
// Closed Catmull–Rom spline: continuous position, velocity and gentle bank.
const sample = (seconds: number): FlightVec => {
  const phase=((seconds%JET_PERIOD)+JET_PERIOD)%JET_PERIOD/JET_PERIOD*WAYPOINTS.length;
  const i=Math.floor(phase),t=phase-i;
  const p=[-1,0,1,2].map(d=>WAYPOINTS[(i+d+WAYPOINTS.length)%WAYPOINTS.length]);
  return [0,1,2].map(axis=>.5*((2*p[1][axis])+(-p[0][axis]+p[2][axis])*t+(2*p[0][axis]-5*p[1][axis]+4*p[2][axis]-p[3][axis])*t*t+(-p[0][axis]+3*p[1][axis]-3*p[2][axis]+p[3][axis])*t*t*t)) as FlightVec;
};
export function jetPose(seconds: number) {
  const position=sample(seconds),before=sample(seconds-.01),after=sample(seconds+.01);
  const velocity=after.map((v,i)=>(v-before[i])/.02) as FlightVec;
  const yaw=Math.atan2(velocity[0],velocity[2]);
  const previous=sample(seconds-.5),next=sample(seconds+.5);
  const ax=(next[0]-2*position[0]+previous[0])/.25,az=(next[2]-2*position[2]+previous[2])/.25;
  const lateral=ax*Math.cos(yaw)-az*Math.sin(yaw);
  return {position,velocity,yaw,pitch:-Math.atan2(velocity[1],Math.hypot(velocity[0],velocity[2])),bank:-Math.atan2(lateral,18)};
}
export const jetMissionClear = (giantHp: number, rideSeconds: number): boolean => giantHp<=0 && rideSeconds>=3;
