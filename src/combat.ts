import type { FlightVec } from './flight';

export type AttackKind = 'normal' | 'rush' | 'dive';
const distance = (a: FlightVec, b: FlightVec) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
export function chooseAttack(position: FlightVec, velocity: FlightVec, grounded: boolean, target: FlightVec, visible: boolean): AttackKind {
  const range = distance(position, target);
  if (grounded || !visible || range > 40 || range < .01) return 'normal';
  if (position[1]-target[1] >= 8 && velocity[1] <= -6 && Math.hypot(position[0]-target[0],position[2]-target[2]) <= 24) return 'dive';
  const speed = Math.hypot(...velocity);
  const approaching = velocity.reduce((sum,v,i)=>sum+v*(target[i]-position[i]),0) / Math.max(.01,speed*range);
  return speed >= 22 && approaching >= .35 ? 'rush' : 'normal';
}

// Starting a special attack changes velocity, never position. Movement and
// building collisions still pass through the regular flight integrator.
export function attackVelocity(kind: 'rush' | 'dive', position: FlightVec, velocity: FlightVec, target: FlightVec): FlightVec {
  const range = Math.max(.01,distance(position,target));
  const speed = Math.min(42,Math.max(kind === 'dive' ? 32 : 28,Math.hypot(...velocity)));
  return target.map((v,i)=>(v-position[i])/range*speed) as FlightVec;
}

export function guideAttack(position: FlightVec, velocity: FlightVec, target: FlightVec, dt: number): FlightVec {
  const range = Math.max(.01,distance(position,target));
  const speed = Math.min(42,Math.max(28,Math.hypot(...velocity)));
  const blend = 1-Math.exp(-4*dt);
  return velocity.map((v,i)=>v+((target[i]-position[i])/range*speed-v)*blend) as FlightVec;
}

// Swept contact prevents a fast player from skipping the weakpoint between frames.
export function sweptWeakpointHit(from: FlightVec, to: FlightVec, target: FlightVec, radius = 4.8): boolean {
  const segment = to.map((v,i)=>v-from[i]);
  const lengthSquared = segment.reduce((sum,v)=>sum+v*v,0);
  const t = Math.max(0,Math.min(1,target.reduce((sum,v,i)=>sum+(v-from[i])*segment[i],0)/Math.max(.000001,lengthSquared)));
  return distance(from.map((v,i)=>v+segment[i]*t) as FlightVec,target) <= radius;
}

export function impactVelocity(position: FlightVec, velocity: FlightVec, target: FlightVec): FlightVec {
  const dx=position[0]-target[0], dz=position[2]-target[2], horizontal=Math.max(.01,Math.hypot(dx,dz));
  return [velocity[0]*.25+dx/horizontal*10,12,velocity[2]*.25+dz/horizontal*10];
}
