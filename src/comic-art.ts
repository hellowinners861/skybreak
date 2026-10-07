import { Color3, DynamicTexture, Material, Mesh, MeshBuilder, Scene, ShaderMaterial, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

// One palette for the whole city. Repeated architecture is baked into material batches.
export const COMIC = { ink: "#17243d", blue: "#2459c4", cream: "#fff1d2", red: "#ef493d", yellow: "#ffd24b", sky: "#a7d9ec" };
export type CityLot = [number, number, number, number, number];

// Three lighting bands, authored in world space so rotating costume parts keep their shading.
const celVertex = `precision highp float;
attribute vec3 position; attribute vec3 normal;
uniform mat4 worldViewProjection; uniform mat4 world;
varying vec3 vNormal;
void main() { vNormal = mat3(world) * normal; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
const celFragment = `precision highp float;
uniform vec3 paperColor; varying vec3 vNormal;
void main() {
  float sun = dot(normalize(vNormal), normalize(vec3(0.35, 1.0, -0.42)));
  float band = sun > 0.65 ? 1.0 : (sun > 0.05 ? 0.84 : 0.62);
  gl_FragColor = vec4(paperColor * band, 1.0);
}`;

export function createComicArt(scene: Scene) {
  const paint = (name: string, color: string) => {
    const mat = new ShaderMaterial(name, scene, { vertexSource: celVertex, fragmentSource: celFragment }, {
      attributes: ["position", "normal"], uniforms: ["worldViewProjection", "world", "paperColor"],
    });
    mat.setColor3("paperColor", Color3.FromHexString(color));
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
  const distant = flatPaint("comic-distant-city", "#81adc3");
  const cloud = flatPaint("comic-cloud", "#eaf7f6");
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
  const sphere = (name: string, diameter: number, pos: [number, number, number], mat: Material, parent?: TransformNode) => {
    const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 6 }, scene);
    mesh.material = mat; mesh.position.set(...pos); mesh.isPickable = false;
    if (parent) mesh.parent = parent;
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

  const decorateCity = (lots: CityLot[]) => {
    lots.forEach(([x, z, hx, hz, h], i) => {
      // A dark top cornice and cream floor bands give the boxes an architectural scale.
      box(`cornice-${i}`, [hx * 2 + .65, .5, hz * 2 + .65], [x, h + .4, z], ink, undefined, true);
      for (let y = 3; y < h - 1; y += 4) {
        box(`floor-${i}`, [hx * 2 + .1, .22, hz * 2 + .1], [x, y - 1.35, z], cream, undefined, true);
        for (let column = -hx + 2; column < hx - 1; column += 3.5) {
          for (const face of [-1, 1]) {
            box("window-frame", [1.95, 2.3, .12], [x + column, y, z + face * (hz + .06)], ink, undefined, true);
            box("window", [1.5, 1.75, .14], [x + column, y, z + face * (hz + .13)], (i + Math.round(column)) % 3 === 0 ? cream : glass, undefined, true);
          }
        }
        for (let column = -hz + 2; column < hz - 1; column += 3.5) {
          for (const face of [-1, 1]) {
            box("side-window", [.12, 2.1, 1.65], [x + face * (hx + .07), y, z + column], ink, undefined, true);
            box("side-glass", [.14, 1.65, 1.2], [x + face * (hx + .14), y, z + column], glass, undefined, true);
          }
        }
      }
      box("roof-service", [4.2, 2.3, 3], [x - hx / 3, h + 1.6, z + hz / 3], i % 2 ? cream : blue, undefined, true);
      box("roof-vent", [4.4, .2, 3.2], [x - hx / 3, h + 2.85, z + hz / 3], ink, undefined, true);
      box("antenna", [.18, 4, .18], [x + hx / 2, h + 2.3, z - hz / 2], ink, undefined, true);
      if (i % 4 === 0) sign(["AIR POST", "SKY PORT", "NORTH 01", "UP / UP", "FLY CLUB"][i / 4], [x, h - 2, z - hz - .3], hx * 1.6, 2, COMIC.yellow);
    });
    // Skyline outside the playable bounds, with a deliberately softer contrast.
    for (let i = 0; i < 20; i++) {
      const height = 38 + (i * 19 % 49);
      const x = (i - 10) * 19;
      box("skyline", [13, height, 15], [x, height / 2 - 7, 160 + (i % 3) * 12], distant, undefined, true);
      box("skyline-cap", [7, 6, 8], [x, height - 4, 160 + (i % 3) * 12], distant, undefined, true);
    }
    for (let i = 0; i < 7; i++) {
      // Flat cloud ribbons rather than particle glow or full-screen post processing.
      const mesh = box("cloud", [26 + i % 3 * 10, 2, 5], [-150 + i * 50, 85 + i % 3 * 11, 145], cloud, undefined, true);
      mesh.rotation.z = -.035;
    }
    for (let z = -110; z < 115; z += 12) box("road-dash", [.35, .04, 4], [0, .16, z], cream, undefined, true);
    for (let x = -110; x < 115; x += 12) box("road-dash", [4, .04, .35], [x, .16, 0], cream, undefined, true);
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
      box("hook-cantilever", [Math.abs(side - x) + 1, .55, .65], [(side + x) / 2, y + 1.3, z], ink, undefined, true);
      box("hook-pedestal", [3, 1, 4], [side, y - 1.8, z], yellow, undefined, true);
      sign(`0${i + 1}`, [side, y - 5.5, z - 3.08], 3.5, 2.1, COMIC.cream);
    }
  };

  const createHero = (root: TransformNode) => {
    box("hero-jacket", [.92, .88, .56], [0, .05, 0], cream, root);
    box("hero-harness", [.96, .18, .62], [0, -.26, 0], ink, root);
    box("hero-backpack", [.65, .64, .24], [0, .04, -.39], blue, root);
    box("hero-backpack-stripe", [.12, .55, .03], [0, .04, -.53], yellow, root);
    sphere("hero-helmet", .64, [0, .77, 0], cream, root);
    box("hero-goggles", [.58, .18, .18], [0, .78, .26], ink, root);
    box("hero-scarf-collar", [.68, .15, .68], [0, .48, 0], red, root);
    const scarf = new TransformNode("hero-scarf", scene); scarf.parent = root; scarf.position.set(0, .48, -.32);
    const tail = box("hero-scarf-tail", [.32, .11, 1.25], [.1, .1, -.58], red, scarf);
    tail.rotation.y = -.3;
    const tip = box("hero-scarf-tip", [.38, .1, .65], [.35, .17, -1.4], red, scarf); tip.rotation.y = -.45;
    const limbs: TransformNode[] = [];
    for (const side of [-1, 1]) {
      const arm = new TransformNode(`hero-arm-${side}`, scene); arm.parent = root; arm.position.set(side * .55, .35, 0);
      box("hero-sleeve", [.28, .56, .32], [0, -.22, 0], blue, arm);
      sphere("hero-glove", .32, [0, -.57, .04], ink, arm);
      const leg = new TransformNode(`hero-leg-${side}`, scene); leg.parent = root; leg.position.set(side * .25, -.35, 0);
      box("hero-trousers", [.32, .6, .34], [0, -.24, 0], blue, leg);
      box("hero-boot", [.37, .26, .5], [0, -.68, .08], ink, leg);
      limbs.push(arm, leg);
    }
    let phase = 0;
    return (dt: number, speed: number, grounded: boolean, attached: boolean) => {
      phase += dt * (4 + speed * .25);
      scarf.rotation.x = Math.sin(phase * 1.3) * .17;
      scarf.rotation.y = Math.sin(phase) * .2;
      limbs.forEach((limb, i) => {
        const arm = i % 2 === 0;
        limb.rotation.x = grounded ? Math.sin(phase + (i < 2 ? 0 : Math.PI)) * Math.min(.5, speed * .06) : (arm ? (attached ? -1.9 : -.7) : .55 + Math.sin(phase) * .1);
        limb.rotation.z = arm ? (i < 2 ? -.18 : .18) : 0;
      });
    };
  };

  const createGiant = (root: TransformNode) => {
    box("giant-waist", [6, 3, 4], [0, 9, 0], ink, root);
    const torso = box("giant-armored-torso", [9, 8, 5], [0, 14, 0], blue, root);
    box("giant-breastplate", [7, 5.6, .6], [0, 14.1, -2.85], cream, root);
    box("giant-chest-socket", [3.3, 3.3, .5], [0, 14, -3.2], ink, root);
    box("giant-neck", [2.5, 2, 2.6], [0, 19, 0], ink, root);
    box("giant-helmet", [5.3, 4.1, 4], [0, 21.3, 0], blue, root);
    box("giant-brow", [5.6, .75, 1], [0, 22.1, -2], cream, root);
    box("giant-face", [4, 1.8, .45], [0, 20.7, -2.14], ink, root);
    box("giant-eye", [3.1, .32, .14], [0, 21, -2.44], red, root);
    box("giant-crest", [.8, 2.4, 4.3], [0, 23, 0], red, root);
    for (const side of [-1, 1]) {
      box("giant-shoulder-joint", [3.3, 3.3, 3.4], [side * 5.2, 16, 0], ink, root);
      const plate = box("giant-shoulder-plate", [4.4, 3, 5], [side * 6.8, 17, 0], cream, root); plate.rotation.z = side * .14;
      box("giant-arm", [2.5, 6.5, 2.8], [side * 7, 12.5, 0], ink, root);
      box("giant-forearm-armor", [3.8, 4.6, 4], [side * 7.4, 9.7, -.2], blue, root);
      box("giant-knuckle", [3.6, 2.2, 3.9], [side * 7.4, 6.5, -.5], ink, root);
      box("giant-arm-stripe", [3.9, .6, 4.1], [side * 7.4, 10.7, -.2], red, root);
      box("giant-thigh", [2.5, 4, 3], [side * 2.4, 6.3, 0], ink, root);
      box("giant-knee", [3.6, 2.2, 3.8], [side * 2.4, 4.6, -.3], cream, root);
      box("giant-shin", [3.2, 3.1, 3.4], [side * 2.4, 2.8, 0], blue, root);
      box("giant-foot", [4.3, 1.3, 6], [side * 2.4, .65, -1], ink, root);
    }
    return (time: number, hp: number, flash: number) => {
      // Keep gameplay anchors and weakpoint fixed; only the armor reacts.
      torso.rotation.z = hp > 0 ? Math.sin(time * 1.2) * .012 : .08;
      torso.scaling.setAll(flash > 0 ? 1.035 : 1);
    };
  };
  const bake = () => {
    batches.forEach((meshes, mat) => {
      const merged = Mesh.MergeMeshes(meshes, true, true);
      if (merged) { merged.name = `city-batch-${mat.name}`; merged.isPickable = false; merged.freezeWorldMatrix(); }
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
