import { characterModels } from "./character-models";
import type { createBuildingFinishes } from "./building-finishes";
import { decorateFacadeColumns, facadeColumns } from "./facade-trim";
import { HORIZON } from "./city-environment";
import { Color3, DynamicTexture, Material, Mesh, MeshBuilder, Scene, ShaderMaterial, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

// One palette for the whole city. Repeated architecture is baked into material batches.
export const COMIC = { ink: "#17243d", blue: "#2459c4", cream: "#fff1d2", red: "#ef493d", yellow: "#ffd24b", sky: "#a7d9ec" };
export type CityLot = [number, number, number, number, number];

// Three lighting bands, authored in world space so rotating costume parts keep their shading.
const celVertex = `precision highp float;
attribute vec3 position; attribute vec3 normal;
uniform mat4 worldViewProjection; uniform mat4 world;
varying vec3 vNormal; varying vec3 vPosition;
void main() { vPosition = (world * vec4(position, 1.0)).xyz; vNormal = mat3(world) * normal; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
const celFragment = `precision highp float;
uniform vec3 paperColor; uniform vec3 eyePosition; uniform vec3 hazeColor; varying vec3 vNormal; varying vec3 vPosition;
void main() {
  float sun = dot(normalize(vNormal), normalize(vec3(0.35, 1.0, -0.42)));
  float band = 0.62 + 0.22 * smoothstep(0.01, 0.12, sun) + 0.16 * smoothstep(0.60, 0.72, sun);
  float haze = clamp((distance(vPosition, eyePosition) - 95.0) / 235.0, 0.0, 1.0);
  gl_FragColor = vec4(mix(paperColor * band, hazeColor, haze), 1.0);
}`;

export function createComicArt(scene: Scene, finishes: ReturnType<typeof createBuildingFinishes>) {
  const paint = (name: string, color: string) => {
    const mat = new ShaderMaterial(name, scene, { vertexSource: celVertex, fragmentSource: celFragment }, {
      attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world", "paperColor", "eyePosition", "hazeColor"],
    });
    mat.setColor3("paperColor", Color3.FromHexString(color));
    mat.setColor3("hazeColor", HORIZON);
    mat.onBindObservable.add(() => { if (scene.activeCamera) mat.setVector3("eyePosition", scene.activeCamera.globalPosition); });
    return mat;
  };
  const flatPaint = (name: string, color: string) => {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = Color3.Black();
    mat.disableLighting = true; mat.emissiveColor = mat.diffuseColor;
    return mat;
  };
  const ink = paint("comic-ink", COMIC.ink);
  const blue = paint("comic-cobalt", COMIC.blue);
  const cream = paint("comic-paper", COMIC.cream);
  const red = paint("comic-vermilion", COMIC.red);
  const yellow = paint("comic-signal", COMIC.yellow);
  const glass = paint("comic-window", "#508bc3");
  const foliage = paint("city-sage", "#52957f");
  const foliageLight = paint("city-leaf", "#82b798");
  const stone = paint("city-stone", "#d1c7ae");
  const distant = flatPaint("comic-distant-city", "#769db4");
  const farCity = flatPaint("city-far-haze", "#a6bcc8");
  const hill = flatPaint("coastal-ridge", "#bacccd");
  const batches = new Map<Material, Mesh[]>();
  const box = (name: string, size: [number, number, number], pos: [number, number, number], mat: Material, parent?: TransformNode, bake = false) => {
    const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
    mesh.material = mat;
    mesh.position.set(...pos);
    mesh.isPickable = false;
    if (parent) mesh.parent = parent;
    if (bake) { const list = batches.get(mat) ?? []; list.push(mesh); batches.set(mat, list); }
    return mesh;
  };
  const sign = (text: string, pos: [number, number, number], width: number, height: number, color: string) => {
    const texture = new DynamicTexture(`sign-${text}`, { width: 512, height: 128 }, scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = COMIC.ink; ctx.font = "900 72px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(text, 256, 91); texture.update();
    const mat = flatPaint(`sign-paint-${text}`, "#ffffff");
    mat.diffuseTexture = texture; mat.emissiveColor = Color3.White();
    const mesh = MeshBuilder.CreatePlane(`sign-${text}`, { width, height }, scene);
    mesh.position.set(...pos); mesh.material = mat; mesh.isPickable = false;
    return mesh;
  };
  const rounded = (name: string, scale: [number, number, number], pos: [number, number, number], mat: Material) => {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 2, segments: 10 }, scene);
    mesh.scaling.set(...scale); mesh.position.set(...pos); mesh.material=mat; mesh.isPickable=false;
    const list=batches.get(mat)??[]; list.push(mesh); batches.set(mat,list);
    return mesh;
  };

  const decorateCity = (lots: CityLot[]) => {
    lots.forEach(([x, z, hx, hz, h], i) => {
      const finish = finishes[i % 3];
      // Architectural families share their trim, glazing, roof and service metal.
      for (const edge of [-1,1]) {
        box(`cornice-${i}`, [hx*2+.65,.35,.45], [x,h+.4,z+edge*hz], finish.trim,undefined,true);
        box(`side-cornice-${i}`, [.45,.35,hz*2+.65], [x+edge*hx,h+.4,z], finish.trim,undefined,true);
      }
      const residential = i % 3 === 0;
      const modern = i % 3 === 1;
      decorateFacadeColumns(scene, [x,z,hx,hz,h], i, finishes, (mesh, mat) => { const group=batches.get(mat)??[];group.push(mesh);batches.set(mat,group); });
      for (let y = 6; y < h - 1; y += 4) {
        if (!modern) box(`floor-${i}`, [hx * 2 + .1, .18, hz * 2 + .1], [x, y - 1.35, z], finish.trim, undefined, true);
        for (const column of facadeColumns(hx, modern ? 2.5 : 3.2)) {
          for (const face of [-1, 1]) {
            box("window-frame", [modern ? 2.5 : 1.95, 2.3, .12], [x + column, y, z + face * (hz + .06)], finish.frame, undefined, true);
            box("window", [modern ? 2.3 : 1.5, 1.95, .14], [x + column, y, z + face * (hz + .13)], finish.glass, undefined, true);
            box("window-mullion", [modern ? .06 : .08,1.95,.07], [x+column,y,z+face*(hz+.23)], finish.frame, undefined,true);
            if (!modern) box("window-sill", [2.18,.14,.38], [x+column,y-1.15,z+face*(hz+.2)], finish.trim,undefined,true);
            if (residential && y < h-4 && Math.round(column)%2===0) {
              box("balcony-slab", [2.4,.18,1.1], [x+column,y-1.25,z+face*(hz+.5)], finish.trim, undefined,true);
              box("balcony-rail", [2.4,.08,.1], [x+column,y-.55,z+face*(hz+1)], finish.metal, undefined,true);
              for(const offset of [-1,-.5,0,.5,1]) box("balcony-spindle", [.07,.65,.07], [x+column+offset,y-.85,z+face*(hz+1)], finish.metal,undefined,true);
            }
          }
        }
        for (const column of facadeColumns(hz, modern ? 2.5 : 3.2)) {
          for (const face of [-1, 1]) {
            box("side-window", [.12, 2.1, 1.65], [x + face * (hx + .07), y, z + column], finish.frame, undefined, true);
            box("side-glass", [.14, 1.85, 1.35], [x + face * (hx + .14), y, z + column], finish.glass, undefined, true);
            box("side-mullion", [.07,1.85,.08], [x+face*(hx+.23),y,z+column], finish.frame,undefined,true);
            if (!modern) box("side-sill", [.38,.14,1.95], [x+face*(hx+.2),y-1.05,z+column], finish.trim,undefined,true);
          }
        }
      }
      // Each family owns a different facade rhythm and crown rather than random ornaments.
      for (const edge of [-1,1]) {
        box("roof-parapet", [hx*2,.7,.25], [x,h+.65,z+edge*(hz-.1)], finish.trim,undefined,true);
      }
      for (const edge of [-1,1]) {
        box("side-parapet", [.25,.7,hz*2], [x+edge*(hx-.1),h+.65,z], finish.trim,undefined,true);
        box("parapet-cap", [hx*2+.15,.12,.42], [x,h+1.05,z+edge*(hz-.1)], finish.metal,undefined,true);
        box("side-parapet-cap", [.42,.12,hz*2+.15], [x+edge*(hx-.1),h+1.05,z], finish.metal,undefined,true);
      }
      if (modern) {
        box("recessed-crown", [hx*1.45,2.4,hz*.65], [x,h+1.5,z+hz*.55], finish.glass,undefined,true);
        box("crown-canopy", [hx*1.5,.28,hz*.7], [x,h+2.84,z+hz*.55], finish.trim,undefined,true);
      }
      // Recessed shopfronts and a striped awning make the ground floor read at street scale.
      box("shop-transom", [hx*1.65,2.6,.18], [x,1.9,z-hz-.14], finish.frame,undefined,true);
      for(let c=-hx+2;c<hx-1;c+=3.2) {
        box("shop-glass", [2.65,2.1,.2], [x+c,1.9,z-hz-.26], finish.glass,undefined,true);
        const awning=box("shop-awning", [3.2,.15,1.8], [x+c,3.5,z-hz-.85], (Math.round(c)+i)%2 ? finish.trim : finish.accent,undefined,true);
        awning.rotation.x=.12;
      }
      box("door", [1.4,2.5,.22], [x,1.3,z-hz-.4], finish.frame,undefined,true);
      box("door-pane", [.95,1.7,.24], [x,1.7,z-hz-.44], finish.glass,undefined,true);
      box("entry-steps", [2.2,.25,.85], [x,.2,z-hz-.7], stone,undefined,true);
      // Props remain beside lots, away from the central wire course.
      for(const side of [-1,1]) {
        const tx=x+side*(hx+1.2), tz=z-hz+2;
        box("tree-trunk", [.35,3.2,.35], [tx,1.7,tz], ink,undefined,true);
        rounded("tree-crown", [1.55,2.1,1.45], [tx,4.2,tz], foliage);
        rounded("tree-crown-light", [1.2,1.5,1.15], [tx-.45,5,tz-.25], foliageLight);
      }
      box("street-lamp", [.16,5.4,.16], [x+hx+1,2.8,z+hz], ink,undefined,true);
      box("lamp-arm", [1.4,.15,.18], [x+hx+.45,5.45,z+hz], ink,undefined,true);
      rounded("lamp-shade", [.5,.15,.4], [x+hx-.1,5.4,z+hz], cream);
      const serviceX=x-hx/3, serviceZ=z+hz/3;
      box("roof-service", [3.4,1.3,2.5], [serviceX,h+1.1,serviceZ], finish.metal,undefined,true);
      box("service-cap", [3.6,.12,2.7], [serviceX,h+1.82,serviceZ], finish.trim,undefined,true);
      for(let l=0;l<5;l++) box("vent-louver", [2.6,.065,.08], [serviceX,h+.7+l*.19,serviceZ-1.3], finish.frame,undefined,true);
      box("roof-access", [2.4,2.7,2.4], [x+hx*.45,h+1.65,z+hz*.35], finish.trim,undefined,true);
      box("access-door", [.9,1.9,.12], [x+hx*.45,h+1.3,z+hz*.35-1.23], finish.frame,undefined,true);
      box("access-cap", [2.65,.18,2.65], [x+hx*.45,h+3.1,z+hz*.35], finish.metal,undefined,true);
      if (residential) {
        box("chimney", [.85,2.1,.85], [x-hx*.55,h+1.35,z-hz*.45], finish.accent,undefined,true);
        box("chimney-cap", [1.12,.18,1.12], [x-hx*.55,h+2.48,z-hz*.45], finish.trim,undefined,true);
      }
      if (!modern) {
        for(const side of [-1,1]) {
          box("roof-planter", [2.3,.6,.8], [x+side*hx*.35,h+.65,z-hz*.65], finish.accent,undefined,true);
          box("planter-leaves", [2.05,.26,.65], [x+side*hx*.35,h+1.03,z-hz*.65], foliage,undefined,true);
        }
      }
      box("antenna", [.18, 4, .18], [x + hx / 2, h + 2.3, z - hz / 2], ink, undefined, true);
      if (i % 4 === 0) sign(["AIR POST", "SKY PORT", "NORTH 01", "UP / UP", "FLY CLUB"][i / 4], [x, h - 2, z - hz - .3], hx * 1.6, 2, COMIC.yellow);
    });
    // Skyline outside the playable bounds, with a deliberately softer contrast.
    for (let layer=0;layer<2;layer++) for (let i=0;i<36;i++) {
      const angle=i/36*Math.PI*2;
      const radius=layer ? 235 : 175;
      const x=Math.cos(angle)*radius, z=Math.sin(angle)*radius;
      const height=22+(i*19%52), mat=layer ? farCity : distant;
      box("skyline-podium", [14, height*.7, 16], [x,height*.35-8,z],mat,undefined,true);
      box("skyline-tower", [10,height*.3+4,11], [x,height*.85-6,z],mat,undefined,true);
      if(i%3===0) box("skyline-spire", [1.2,9,1.2], [x,height+2,z],mat,undefined,true);
      if(layer===1 && i%3===0) rounded("distant-ridge", [48,12+i%5*3,24], [x,-5,z],hill);
    }
    // Dress the launch hub too: its 40m wall otherwise dominates the street view.
    for (let y=4;y<39;y+=5) {
      for (const side of [-1,1]) {
        box("launch-facade-band", [44,.25,.15], [0,y-1.4,-88+side*8.08], cream,undefined,true);
        for(let x=-18;x<=18;x+=4) {
          box("launch-frame", [2.8,2.4,.16], [x,y,-88+side*8.16],finishes[1].frame,undefined,true);
          box("launch-pane", [2.3,1.9,.18], [x,y,-88+side*8.26],finishes[1].glass,undefined,true);
          box("launch-mullion", [.07,1.9,.07], [x,y,-88+side*8.4],finishes[1].frame,undefined,true);
        }
        box("launch-side-band", [.15,.25,16], [side*22.08,y-1.4,-88],cream,undefined,true);
        for(let z=-93;z<=-83;z+=4) {
          box("launch-side-frame", [.16,2.4,2.8], [side*22.16,y,z],finishes[1].frame,undefined,true);
          box("launch-side-pane", [.18,1.9,2.3], [side*22.26,y,z],finishes[1].glass,undefined,true);
        }
      }
    }
    for(const side of [-1,1]) box("launch-pier", [.65,39,.25], [side*20.5,19.5,-79.7],finishes[1].trim,undefined,true);
    // The opening roof is a launch pad, not another anonymous box.
    box("launch-pad", [10, .07, 7], [0, 40.06, -86], yellow, undefined, true);
    for (const side of [-1, 1]) {
      const arrow = box("launch-chevron", [2.6, .08, .5], [side * .85, 40.14, -83.5], ink, undefined, true);
      arrow.rotation.y = side * -.65;
    }
    for (let x = -20; x <= 20; x += 4) box("launch-edge", [2, .13, .65], [x, 40.08, -80.2], red, undefined, true);
    sign("TAKE OFF", [-12, 41.5, -78.5], 4.5, 1.1, COMIC.cream);
    for (const [i, [x, y, z]] of [[6,54,-62],[-6,54,-38],[6,54,-14]].entries()) {
      const side = x > 0 ? 26 : -26;
      for (const edge of [-1,1]) {
        box("mast-rib", [.26,y-2,.26], [side+edge*1.8,(y-2)/2,z-3.08],cream,undefined,true);
        for(let level=8;level<y-6;level+=7) {
          box("mast-inset", [2.9,4,.1], [side,level,z+edge*3.07],glass,undefined,true);
          if (edge===1) box("mast-collar", [4.15,.3,6.15], [side,level+2.6,z],cream,undefined,true);
        }
      }
      box("hook-cantilever", [Math.abs(side - x) + 1, .55, .65], [(side + x) / 2, y + 1.3, z], ink, undefined, true);
      box("hook-pedestal", [3, 1, 4], [side, y - 1.8, z], yellow, undefined, true);
      sign(`0${i + 1}`, [side, y - 5.5, z - 3.08], 3.5, 2.1, COMIC.cream);
    }
  };

  const { createHero, createGiant } = characterModels(scene, { ink, blue, cream, red, yellow, glass });
  const bake = () => {
    batches.forEach((meshes, mat) => {
      const merged = Mesh.MergeMeshes(meshes, true, true);
      if (merged) { merged.name = `city-batch-${mat.name}`; merged.isPickable = false; merged.receiveShadows = mat instanceof StandardMaterial; merged.freezeWorldMatrix(); }
    });
    batches.clear();
  };
  // A bounded pool: pickups and impacts do not allocate meshes during play.
  const sparks = Array.from({ length: 12 }, (_, i) => {
    const mesh = box("comic-impact", [.22, .22, .22], [0, 0, 0], i % 2 ? yellow : cream);
    mesh.setEnabled(false);
    return { mesh, velocity: Vector3.Zero(), life: 0 };
  });
  const burst = (position: Vector3) => sparks.forEach((spark, i) => {
    const angle = i / sparks.length * Math.PI * 2;
    spark.mesh.position.copyFrom(position);
    spark.velocity.set(Math.cos(angle) * 5, 2 + i % 3 * 2, Math.sin(angle) * 5);
    spark.life = .42; spark.mesh.setEnabled(true);
  });
  const updateEffects = (dt: number) => sparks.forEach(spark => {
    if (spark.life <= 0) return;
    spark.life = Math.max(0, spark.life - dt);
    spark.mesh.position.addInPlace(spark.velocity.scale(dt));
    spark.mesh.rotation.z += dt * 7;
    spark.mesh.scaling.setAll(spark.life / .42);
    spark.mesh.setEnabled(spark.life > 0);
  });
  const resetEffects = () => sparks.forEach(spark => { spark.life = 0; spark.mesh.setEnabled(false); });
  return { decorateCity, createHero, createGiant, bake, burst, updateEffects, resetEffects };
}
