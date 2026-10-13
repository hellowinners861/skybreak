import { Mesh, MeshBuilder, Vector3, type Scene, type Material } from '@babylonjs/core';
import { createBuildingShell } from './city-environment';
import type { createBuildingFinishes } from './building-finishes';
import type { FlightObstacle } from './flight-collision';
import { BRIDGES, TERRACES, WATER_TOWERS } from './stage-structure-plan';

export function createStageStructures(scene: Scene, walls: Material[], finishes: ReturnType<typeof createBuildingFinishes>, anchorMaterial: Material) {
  const meshes: Mesh[] = [];
  const obstacles: (FlightObstacle & { mesh: Mesh })[] = [];
  const anchors: { name: string; position: Vector3; mesh: Mesh }[] = [];
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, paint: Material, solid = false) => {
    const mesh = MeshBuilder.CreateBox(name, { width:w, height:h, depth:d }, scene);
    mesh.position.set(x,y,z); mesh.material=paint; mesh.isPickable=false; meshes.push(mesh);
    if(solid) obstacles.push({mesh,x,z,halfX:w/2,halfZ:d/2,bottom:y-h/2,top:y+h/2});
    return mesh;
  };
  const anchor = (name: string, x: number, y: number, z: number) => {
    const mesh = MeshBuilder.CreateSphere(`structure-anchor-${anchors.length}`, {diameter:1.1,segments:8}, scene);
    const position = new Vector3(x,y,z); mesh.position=position.clone();mesh.material=anchorMaterial;mesh.isPickable=false;
    anchors.push({name,position,mesh});
  };
  const cylinder = (name:string,x:number,y:number,z:number,height:number,diameter:number,paint:Material) => {
    const mesh=MeshBuilder.CreateCylinder(name,{height,diameter,tessellation:16},scene);
    mesh.position.set(x,y,z);mesh.material=paint;mesh.isPickable=false;meshes.push(mesh);return mesh;
  };
  for(const [i,b] of BRIDGES.entries()) {
    const f=finishes[b.style];
    box(`bridge-${i}`,b.x,(b.bottom+b.top)/2,b.z,b.halfX*2,b.top-b.bottom,b.halfZ*2,f.metal,true);
    box(`bridge-surface-${i}`,b.x,b.top-.03,b.z,4.5,.06,48,f.trim);
    for(const side of [-1,1]) {
      box(`bridge-beam-${i}-${side}`,b.x+side*2.1,71.1,b.z,.24,.6,48,f.frame,true);
      box(`bridge-rail-${i}-${side}`,b.x+side*2.2,72.8,b.z,.16,.16,48,f.frame);
      for(let z=b.z-24;z<=b.z+24;z+=8) box('bridge-post',b.x+side*2.2,72.4,z,.14,.8,.14,f.frame);
    }
    for(const z of [b.z-16,b.z+16]) {
      box('bridge-hook-post',b.x,73.1,z,.18,2.2,.18,f.accent);
      anchor(`連絡橋 ${b.x<0?"西":"東"}・${z<b.z?"南端":"北端"}`,b.x,74.2,z);
    }
  }
  for(const [i,b] of TERRACES.entries()) {
    const f=finishes[b.style];
    const shell=createBuildingShell(`terrace-${i}`,b.halfX,b.halfZ,b.top,b.style,scene);
    shell.position.set(b.x,0,b.z);shell.material=walls[b.style];meshes.push(shell);obstacles.push({...b,mesh:shell});
    box('terrace-deck',b.x,b.top-.08,b.z,b.halfX*2-.6,.16,b.halfZ*2-.6,f.roof);
    // Outward-facing windows, thin cornices and corner rails share the city's finishes.
    const side=b.x<0?-1:1, outer=b.x+side*b.halfX;
    for(let y=6;y<b.top-2;y+=8) {
      box('terrace-window',outer+side*.025,y,b.z,.05,3,b.halfZ*2-3,f.glass);
      box('terrace-cornice',b.x,y+2,b.z,b.halfX*2+.08,.16,b.halfZ*2+.08,f.trim);
    }
    box('terrace-edge',outer,b.top+.35,b.z,.25,.7,b.halfZ*2,f.trim);
    for(const z of [b.z-b.halfZ,b.z+b.halfZ]) box('terrace-edge',b.x,b.top+.35,z,b.halfX*2,.7,.25,f.trim);
    const hookX=outer-side*2;
    box('terrace-hook-post',hookX,b.top+1,b.z,.2,2,.2,f.metal);
    anchor(`段状ビル ${i<2?'西':'東'}${i%2===0?'下段':'中段'}`,hookX,b.top+2,b.z);
  }
  for(const [i,t] of WATER_TOWERS.entries()) {
    const f=finishes[t.style], deck=t.roof+7, tankTop=deck+6;
    for(const dx of [-2.8,2.8])for(const dz of [-2.8,2.8])box('tower-leg',t.x+dx,t.roof+3.5,t.z+dz,.32,7,.32,f.metal,true);
    box('tower-service-deck',t.x,deck-.2,t.z,7.6,.4,7.6,f.metal,true);
    const tank=cylinder(`water-tank-${i}`,t.x,deck+3,t.z,6,6.8,f.accent);
    obstacles.push({mesh:tank,x:t.x,z:t.z,halfX:3.55,halfZ:3.55,bottom:deck,top:tankTop+.15});
    for(const y of [deck+.3,deck+3,deck+5.7])cylinder('tower-band',t.x,y,t.z,.2,6.95,f.frame);
    cylinder('tower-lid',t.x,tankTop,t.z,.3,7.1,f.trim);
    box('tower-hook-post',t.x,tankTop+1.1,t.z,.18,2,.18,f.metal);
    anchor(`給水塔 ${i+1}`,t.x,tankTop+2.1,t.z);
  }
  return {meshes,obstacles,anchors};
}
