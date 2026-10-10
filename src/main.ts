import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  LinesMesh,
  Material,
  Mesh,
  MeshBuilder,
  Scene,
  SceneInstrumentation,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { collectCoin, createProgressState, isStageClear, resetProgress, tickAttackCooldown, tryAttack } from "./gameplay";
import { attachToAnchor, crossedCourseAnchor, COURSE_ANCHORS, FlightState, releaseFlight, stepAttached, stepDetached } from "./flight";
import { COMIC, createComicArt } from "./comic-art";
import { createBuildingShell, createCitySky, SUN_DIRECTION } from "./city-environment";
import { createWallMaterials } from "./wall-materials";
import { createBuildingFinishes, createRoofDeck } from "./building-finishes";
import { createCityStreets } from "./city-streets";
import { nearestVisibleWireTarget, type VisibleWireTarget } from "./wire-targeting";
import { resolveFlightCollision } from "./flight-collision";
import "./style.css";

type AnchorKind = "building" | "giant" | "course";

type Anchor = {
  name: string;
  kind: AnchorKind;
  position: Vector3;
  mesh: Mesh;
  courseIndex?: number;
};

type Building = {
  mesh: Mesh;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  top: number;
};

type Coin = {
  mesh: Mesh;
  collected: boolean;
};

type MessageTone = "normal" | "warn" | "good";

const select = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const canvas = select<HTMLCanvasElement>("#render-canvas");
const coinCount = select<HTMLElement>("#coin-count");
const giantHpReadout = select<HTMLElement>("#giant-hp");
const objective = select<HTMLElement>("#objective");
const anchorReadout = select<HTMLElement>("#anchor-readout");
const routeReadout = select<HTMLElement>("#route-readout");
const message = select<HTMLElement>("#message");
const speedLines = select<HTMLElement>("#speed-lines");
const stickZone = select<HTMLElement>("#stick-zone");
const stickKnob = select<HTMLElement>("#stick-knob");
const boostButton = select<HTMLButtonElement>("#boost-button");
const attackButton = select<HTMLButtonElement>("#attack-button");
const wireButton = select<HTMLButtonElement>("#wire-button");
const wireLabel = select<HTMLElement>("#wire-label");
const clearScreen = select<HTMLElement>("#clear-screen");
const clearCoins = select<HTMLElement>("#clear-coins");
const retryButton = select<HTMLButtonElement>("#retry-button");
const quickRetryButton = select<HTMLButtonElement>("#quick-retry");

const speedReadout = select<HTMLElement>("#speed-readout");
const speedFill = select<HTMLElement>("#speed-fill");

const engine = new Engine(canvas, true, {
  antialias: true,
  preserveDrawingBuffer: false,
  stencil: true,
});
// Render at up to 1.5 pixels per CSS pixel; keep mobile edges crisp without full DPR cost.
engine.setHardwareScalingLevel(1 / Math.min(1.5, window.devicePixelRatio || 1));

const scene = new Scene(engine);
const instrumentation = import.meta.env.DEV ? new SceneInstrumentation(scene) : null;
scene.clearColor = Color4.FromHexString("#a7d9ecff");
const buildingFinishes = createBuildingFinishes(scene);
const art = createComicArt(scene, buildingFinishes);

const camera = new UniversalCamera("follow-camera", new Vector3(-84, 8, -98), scene);
camera.minZ = 0.2;
camera.maxZ = 420;
camera.fov = 0.9;
camera.inputs.clear();

const hemi = new HemisphericLight("soft-sky-light", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.55;
hemi.diffuse = new Color3(1, .97, .9);
hemi.groundColor = new Color3(.28, .40, .62);

const sun = new DirectionalLight("city-sun", SUN_DIRECTION.negate(), scene);
sun.position = new Vector3(-80, 150, -100);
sun.intensity = 0.48;

const hex = (value: string): Color3 => Color3.FromHexString(value);

const material = (name: string, diffuse: string, emissive = "#000000"): StandardMaterial => {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = hex(diffuse);
  result.emissiveColor = hex(emissive);
  result.specularColor = Color3.Black();
  return result;
};

const groundMaterial = material("ground-material", "#b6c9c8");
const anchorMaterial = material("anchor-material", COMIC.yellow, "#6a5010");
const anchorGiantMaterial = anchorMaterial;
const coinMaterial = material("coin-material", COMIC.yellow, "#55420e");
const weakpointMaterial = material("weakpoint-material", COMIC.yellow, "#6a5010");
const markerMaterial = material("target-marker-material", COMIC.cream, "#756e5d");
const markerGiantMaterial = markerMaterial;

const updateSky = createCitySky(scene);

const ground = MeshBuilder.CreateBox("arena-ground", { width: 240, height: 1, depth: 240 }, scene);
ground.position.y = -0.5;
ground.material = groundMaterial;
ground.isPickable = false;
ground.receiveShadows = true;

const buildings: Building[] = [];
const anchors: Anchor[] = [];
const wallMaterials = createWallMaterials(scene);
const buildingLayouts: Array<[number, number, number, number, number]> = [
  [-62, -72, 9, 8, 14], [-38, -72, 10, 8, 21], [38, -72, 10, 8, 17], [62, -72, 9, 8, 25],
  [-70, -40, 12, 9, 18], [-42, -40, 9, 11, 27], [42, -40, 12, 10, 21], [70, -40, 10, 8, 13],
  [-70, 0, 13, 10, 23], [-42, 2, 10, 9, 15], [42, 1, 11, 12, 24], [70, 4, 8, 9, 18],
  [-70, 40, 11, 10, 16], [-42, 42, 10, 8, 22], [42, 39, 12, 9, 28], [70, 38, 9, 11, 18],
  [-62, 72, 13, 9, 20], [-30, 72, 10, 11, 15], [30, 72, 10, 11, 24], [62, 72, 12, 10, 24],
];

const cityStreets = createCityStreets(scene, buildingLayouts, [
  [-22, -96, 22, -80], // Launch building is not part of the repeating lots.
  ...COURSE_ANCHORS.map(([x, , z]): [number, number, number, number] => {
    const supportX = x >= 0 ? 26 : -26;
    return [supportX - 2, z - 3, supportX + 2, z + 3];
  }),
]);

for (let index = 0; index < buildingLayouts.length; index += 1) {
  const [x, z, halfX, halfZ, height] = buildingLayouts[index];
  const building = createBuildingShell(`building-${index + 1}`, halfX, halfZ, height, index, scene);
  building.position = new Vector3(x, 0, z);
  building.material = wallMaterials[index % wallMaterials.length];

  createRoofDeck(`roof-${index + 1}`, x, z, halfX, halfZ, height, buildingFinishes[index % 3].roof, scene);

  const anchorMesh = MeshBuilder.CreateSphere(`building-anchor-${index + 1}`, { diameter: 1.1, segments: 8 }, scene);
  const anchorPosition = new Vector3(x, height + 2, z);
  anchorMesh.position = anchorPosition;
  anchorMesh.material = anchorMaterial;
  anchorMesh.isPickable = false;
  anchors.push({ name: `ビル ${String(index + 1).padStart(2, "0")}`, kind: "building", position: anchorPosition.clone(), mesh: anchorMesh });
  buildings.push({ mesh: building, x, z, halfX, halfZ, top: height });
}

const openingRoof = createBuildingShell("opening-roof", 22, 8, 40, 1, scene);
openingRoof.position = new Vector3(0, 0, -88);
openingRoof.material = wallMaterials[1];
// Keep the cap above the wall top (40m), below the launch markings (40.025m).
createRoofDeck("roof-opening", 0, -88, 22, 8, 39.732, buildingFinishes[1].roof, scene);
buildings.push({ mesh: openingRoof, x: 0, z: -88, halfX: 22, halfZ: 8, top: 40 });

const courseAnchorPositions = COURSE_ANCHORS.map(([x, y, z]) => new Vector3(x, y, z));
const courseSupportMaterial = material("course-support-material", COMIC.blue);
for (let index = 0; index < courseAnchorPositions.length; index += 1) {
  const point = courseAnchorPositions[index];
  const supportX = point.x >= 0 ? 26 : -26;
  const support = MeshBuilder.CreateBox(`course-support-${index + 1}`, { width: 4, height: point.y - 2, depth: 6 }, scene);
  support.position = new Vector3(supportX, (point.y - 2) / 2, point.z);
  support.material = courseSupportMaterial;
  buildings.push({ mesh: support, x: supportX, z: point.z, halfX: 2, halfZ: 3, top: point.y - 2 });
  const anchorMesh = MeshBuilder.CreateSphere(`course-anchor-${index + 1}`, { diameter: 1.8, segments: 10 }, scene);
  anchorMesh.position = point.clone();
  anchorMesh.material = anchorMaterial;
  anchorMesh.isPickable = false;
  anchors.push({ name: `COURSE ${index + 1}`, kind: "course", courseIndex: index, position: point.clone(), mesh: anchorMesh });
}

const giantRoot = new TransformNode("giant-root", scene);
giantRoot.position = new Vector3(15, 0, 48);

const animateGiant = art.createGiant(giantRoot);
art.decorateCity(buildingLayouts, cityStreets.landscape.patches);
art.bake();
// These are only render meshes. Collision uses the original immutable lot dimensions.
const staticLots = buildings.map(({ mesh }) => mesh);
const shellGroups = new Map<Material, Mesh[]>();
for (const mesh of staticLots) {
  if (!mesh.material) throw new Error(`City shell has no material: ${mesh.name}`);
  const group = shellGroups.get(mesh.material) ?? [];
  group.push(mesh);
  shellGroups.set(mesh.material, group);
}
const cityShells: Mesh[] = [];
for (const [paint, meshes] of shellGroups) {
  const merged = Mesh.MergeMeshes(meshes, true, true);
  if (merged) {
    merged.name = `city-shell-${paint.name}`;
    merged.isPickable = false;
    merged.receiveShadows = true;
    merged.freezeWorldMatrix();
    cityShells.push(merged);
  }
}
const roofGroups = new Map<Material, Mesh[]>();
for (const roof of scene.meshes.filter(mesh => /^roof-(\d+|opening)$/.test(mesh.name)) as Mesh[]) {
  const group = roofGroups.get(roof.material!) ?? [];
  group.push(roof); roofGroups.set(roof.material!, group);
}
const cityRoofs: Mesh[] = [];
for (const [paint, meshes] of roofGroups) {
  const merged = Mesh.MergeMeshes(meshes, true, true);
  if (merged) { merged.name = `city-roofs-${paint.name}`; merged.receiveShadows = true; merged.isPickable = false; merged.freezeWorldMatrix(); cityRoofs.push(merged); }
}
// Static sun shadows render once, keeping city depth affordable on mobile.
const cityShadows = new ShadowGenerator(1024, sun);
cityShadows.usePercentageCloserFiltering = true;
cityShadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
cityShadows.setDarkness(.3);
cityShadows.bias = .003;
cityShadows.normalBias = .05;
for (const mesh of cityShells) cityShadows.addShadowCaster(mesh);
for (const roof of cityRoofs) cityShadows.addShadowCaster(roof);
for (const mesh of scene.meshes) {
  if (mesh.name === "city-batch-city-sage" || mesh.name === "city-batch-city-leaf") cityShadows.addShadowCaster(mesh);
}
const cityShadowMap = cityShadows.getShadowMap();
if (cityShadowMap) cityShadowMap.refreshRate = 0;

const weakpoint = MeshBuilder.CreateSphere("giant-weakpoint", { diameter: 2.15, segments: 12 }, scene);
weakpoint.position = giantRoot.position.add(new Vector3(0, 14, -3.45));
weakpoint.material = weakpointMaterial;
weakpoint.isPickable = false;
const weakpointRing = MeshBuilder.CreateTorus("giant-weakpoint-ring", { diameter: 4.2, thickness: 0.16, tessellation: 24 }, scene);
weakpointRing.position = weakpoint.position.clone();
weakpointRing.rotation.x = Math.PI / 2;
weakpointRing.material = weakpointMaterial;
weakpointRing.isPickable = false;

const createAnchor = (name: string, position: Vector3): void => {
  const anchorMesh = MeshBuilder.CreateSphere(name, { diameter: 1.45, segments: 10 }, scene);
  anchorMesh.position = position.clone();
  anchorMesh.material = anchorGiantMaterial;
  anchorMesh.isPickable = false;
  anchors.push({ name, kind: "giant", position: position.clone(), mesh: anchorMesh });
};

createAnchor("巨人・左肩", giantRoot.position.add(new Vector3(-7, 16, 0)));
createAnchor("巨人・右肩", giantRoot.position.add(new Vector3(7, 16, 0)));
createAnchor("巨人・胸部", giantRoot.position.add(new Vector3(0, 12, -4)));
createAnchor("巨人・頭上", giantRoot.position.add(new Vector3(0, 23, 0)));

const marker = MeshBuilder.CreateTorus("selected-anchor-marker", { diameter: 3.1, thickness: 0.16, tessellation: 24 }, scene);
marker.rotation.x = Math.PI / 2;
marker.material = markerMaterial;
marker.isPickable = false;
marker.setEnabled(false);

const spawnPosition = new Vector3(0, 41.15, -86);
const player = new TransformNode("player", scene);
player.position = spawnPosition.clone();
const animateHero = art.createHero(player);

const coinPositions: Vector3[] = [
  new Vector3(-77, 15, -72), new Vector3(-58, 20, -58), new Vector3(-39, 26, -47), new Vector3(-20, 20, -37),
  new Vector3(0, 25, -27), new Vector3(20, 28, -16), new Vector3(37, 23, -3), new Vector3(46, 27, 14),
  new Vector3(37, 30, 31), new Vector3(24, 23, 45), new Vector3(7, 23, 57), new Vector3(-13, 20, 65),
];
const coins: Coin[] = [];
for (let index = 0; index < coinPositions.length; index += 1) {
  const coin = MeshBuilder.CreateTorus(`coin-${index + 1}`, { diameter: 1.85, thickness: 0.25, tessellation: 18 }, scene);
  coin.position = coinPositions[index].clone();
  coin.rotation.x = Math.PI / 2;
  coin.material = coinMaterial;
  coin.isPickable = false;
  const stamp = MeshBuilder.CreateCylinder(`coin-stamp-${index + 1}`, { diameter: 1.15, height: .16, tessellation: 6 }, scene);
  stamp.parent = coin;
  stamp.material = coinMaterial;
  stamp.isPickable = false;
  coins.push({ mesh: coin, collected: false });
}
const progress = createProgressState(coins.length, 3);

const lineCount = 18;
for (let index = 0; index < lineCount; index += 1) {
  const line = document.createElement("i");
  line.className = "speed-line";
  line.style.transform = `translate(-50%, -100%) rotate(${index * (360 / lineCount)}deg)`;
  speedLines.appendChild(line);
}

let playerPosition = spawnPosition.clone();
let velocity = Vector3.Zero();
let lastSafePosition = spawnPosition.clone();
let grounded = true;
let attachedAnchor: Anchor | null = null;
let ropeLength = 0;
let wireMesh: LinesMesh | null = null;
let candidateAnchor: Anchor | null = null;
let candidateDistance = 0;
let coinsCollected = 0;
let giantHp = 3;
let stageCleared = false;
let attackCooldown = 0;
let weakpointFlash = 0;
let safePositionTimer = 0;
let messageTimer = 0;
let courseStage = 0;
let courseStarted = false;
let previousPhysicsZ = spawnPosition.z;
let boostTimer = 0;
let boostCooldown = 0;
let cameraYaw = 0;
let cameraPitch = -0.12;
let manualCameraUntil = 0;
let cameraPointerId: number | null = null;
let cameraLastX = 0;
let cameraLastY = 0;
let stickPointerId: number | null = null;
let boostPointerId: number | null = null;
let stickInput = Vector3.Zero();
let boosting = false;
const pressedKeys = new Set<string>();
const playerHalfHeight = 1.15;
const playerRadius = 0.56;
const gravity = -18;
const maxSpeed = 42;
const flightState: FlightState = { position: [spawnPosition.x, spawnPosition.y, spawnPosition.z], velocity: [0, 0, 0], grounded: true, attached: false, ropeLength: 0 };

const approach = (current: number, target: number, maxDelta: number): number => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

const angleApproach = (current: number, target: number, amount: number): number => {
  let difference = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return current + difference * amount;
};

const viewDirection = (): Vector3 => new Vector3(
  Math.sin(cameraYaw) * Math.cos(cameraPitch),
  Math.sin(cameraPitch),
  Math.cos(cameraYaw) * Math.cos(cameraPitch),
);

const showMessage = (text: string, tone: MessageTone = "normal"): void => {
  message.textContent = text;
  message.classList.remove("visible", "warn", "good");
  if (tone !== "normal") message.classList.add(tone);
  requestAnimationFrame(() => message.classList.add("visible"));
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => message.classList.remove("visible"), 2200);
};

const getMovement = (): Vector3 => {
  let x = stickInput.x;
  let y = stickInput.z;
  if (pressedKeys.has("KeyA")) x -= 1;
  if (pressedKeys.has("KeyD")) x += 1;
  if (pressedKeys.has("KeyW")) y += 1;
  if (pressedKeys.has("KeyS")) y -= 1;

  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  const forward = new Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
  const right = new Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
  return right.scale(x).add(forward.scale(y));
};

const isBoosting = (): boolean => boostTimer > 0;

const triggerBoost = (): void => {
  if (boostCooldown > 0 || stageCleared) return;
  boostTimer = 0.7;
  boostCooldown = 1;
  boosting = true;
};

const capVelocity = (): void => {
  const speed = velocity.length();
  if (speed > maxSpeed) velocity.scaleInPlace(maxSpeed / speed);
};

const detachWire = (announce: boolean): void => {
  if (!attachedAnchor) return;
  releaseFlight(flightState);
  attachedAnchor = null;
  ropeLength = 0;
  if (wireMesh) {
    wireMesh.dispose();
    wireMesh = null;
  }
  if (announce) showMessage("ワイヤー解除 / 勢いを維持", "good");
};

const segmentBlocked = (start: Vector3, end: Vector3, target?: Anchor): boolean => {
  const delta = end.subtract(start);
  for (const building of buildings) {
    let tMin = 0;
    let tMax = 1;
    const axes: Array<[number, number, number]> = [
      [start.x, delta.x, building.x],
      [start.y, delta.y, building.top / 2],
      [start.z, delta.z, building.z],
    ];
    const mins = [building.x - building.halfX, 0, building.z - building.halfZ];
    const maxs = [building.x + building.halfX, building.top, building.z + building.halfZ];
    for (let axis = 0; axis < 3; axis += 1) {
      const origin = axes[axis][0];
      const direction = axes[axis][1];
      if (Math.abs(direction) < 0.0001) {
        if (origin < mins[axis] || origin > maxs[axis]) { tMin = 2; break; }
        continue;
      }
      const near = (mins[axis] - origin) / direction;
      const far = (maxs[axis] - origin) / direction;
      tMin = Math.max(tMin, Math.min(near, far));
      tMax = Math.min(tMax, Math.max(near, far));
      if (tMin > tMax) break;
    }
    if (tMin <= tMax && tMax >= 0.02 && tMin <= Math.max(0, 1 - 0.3 / Math.max(delta.length(), 0.3))) return true;
  }
  return false;
};

const findCandidate = (): void => {
  const forward = camera.getForwardRay(1).direction.normalize();
  const right = Vector3.Cross(Vector3.Up(), forward).normalize();
  const up = Vector3.Cross(forward, right).normalize();
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const tanHalfFov = Math.tan(camera.fov / 2);
  const candidates: VisibleWireTarget<Anchor>[] = [];
  for (const anchor of anchors) {
    const offset = anchor.position.subtract(camera.position);
    const depth = Vector3.Dot(offset, forward);
    if (depth <= camera.minZ) continue;
    const screenX = Vector3.Dot(offset, right) / (depth * tanHalfFov * aspect);
    const screenY = Vector3.Dot(offset, up) / (depth * tanHalfFov);
    if (Math.abs(screenX) > 1 || Math.abs(screenY) > 1) continue;
    candidates.push({
      target: anchor, position: [anchor.position.x, anchor.position.y, anchor.position.z],
      screenX, screenY, cameraDepth: depth,
      blocked: segmentBlocked(camera.position, anchor.position) || segmentBlocked(playerPosition, anchor.position),
    });
  }
  const best = nearestVisibleWireTarget(candidates, [playerPosition.x, playerPosition.y, playerPosition.z], camera.minZ);
  candidateAnchor = best?.target ?? null;
  candidateDistance = best?.distance ?? 0;
};

const toggleWire = (): void => {
  if (stageCleared) return;
  if (attachedAnchor) {
    detachWire(true);
    return;
  }
  findCandidate();
  if (!candidateAnchor) {
    showMessage("接続できるアンカーがありません", "warn");
    return;
  }
  attachedAnchor = candidateAnchor;
  flightState.position = [playerPosition.x, playerPosition.y, playerPosition.z];
  flightState.velocity = [velocity.x, velocity.y, velocity.z];
  flightState.grounded = grounded;
  attachToAnchor(flightState, [candidateAnchor.position.x, candidateAnchor.position.y, candidateAnchor.position.z], [camera.getForwardRay(1).direction.x, 0, camera.getForwardRay(1).direction.z]);
  playerPosition.copyFromFloats(...flightState.position);
  velocity.copyFromFloats(...flightState.velocity);
  ropeLength = flightState.ropeLength;
  grounded = flightState.grounded;
  if (candidateAnchor.kind === "course" && candidateAnchor.courseIndex === courseStage) courseStarted = true;
  showMessage(`${candidateAnchor.name} に接続`, "good");
};

const updateWire = (): void => {
  if (!attachedAnchor) return;
  const points = [playerPosition.clone(), attachedAnchor.position.clone()];
  if (!wireMesh) {
    wireMesh = MeshBuilder.CreateLines("active-wire", { points, updatable: true }, scene);
    wireMesh.color = Color3.FromHexString(COMIC.ink);
  } else {
    MeshBuilder.CreateLines("active-wire", { points, instance: wireMesh });
  }
};

const respawn = (): void => {
  detachWire(false);
  playerPosition.copyFrom(lastSafePosition);
  velocity.copyFromFloats(0, 0, 0);
  grounded = true;
  showMessage("ルートへリスポーン", "warn");
};

const collectCoins = (): void => {
  for (let index = 0; index < coins.length; index += 1) {
    const coin = coins[index];
    if (coin.collected) continue;
    if (Vector3.Distance(playerPosition, coin.mesh.position) > 5.2) continue;
    if (!collectCoin(progress, index)) continue;
    art.burst(coin.mesh.position);
    coin.collected = true;
    coin.mesh.setEnabled(false);
    coinsCollected = progress.collectedCount;
    showMessage(`コイン取得　${coinsCollected} / 12`, "good");
  }
};

const attack = (): void => {
  if (stageCleared || attackCooldown > 0) return;
  attackButton.classList.add("active");
  window.setTimeout(() => attackButton.classList.remove("active"), 110);
  const distance = Vector3.Distance(playerPosition, weakpoint.position);
  const result = tryAttack(progress, distance <= 22);
  attackCooldown = progress.attackCooldown;
  giantHp = progress.giantHp;
  if (result === "defeated") {
    showMessage("巨人はすでに倒れている", "good");
    return;
  }
  if (result === "cooldown") {
    showMessage("攻撃準備中", "warn");
    return;
  }
  if (result === "out-of-range") {
    showMessage("弱点へ近づいて攻撃", "warn");
    return;
  }
  weakpointFlash = 0.3;
  art.burst(weakpoint.position);
  showMessage(`弱点ヒット　残りHP ${giantHp}`, "good");
  if (giantHp <= 0) showMessage("巨人撃破。コインを8枚集めよう", "good");
};

const resetStage = (): void => {
  art.resetEffects();
  detachWire(false);
  resetPointersAndKeys();
  playerPosition.copyFrom(spawnPosition);
  lastSafePosition.copyFrom(spawnPosition);
  velocity.copyFromFloats(0, 0, 0);
  grounded = true;
  resetProgress(progress);
  coinsCollected = progress.collectedCount;
  giantHp = progress.giantHp;
  attackCooldown = progress.attackCooldown;
  courseStage = 0;
  courseStarted = false;
  boostTimer = 0;
  boostCooldown = 0;
  weakpointFlash = 0;
  stageCleared = false;
  cameraYaw = 0;
  cameraPitch = -0.12;
  camera.position.copyFrom(spawnPosition.add(new Vector3(0, 2.05, 0)).subtract(viewDirection().scale(14)));
  camera.setTarget(spawnPosition.add(new Vector3(0, 2.05, 0)));
  clearScreen.classList.add("is-hidden");
  for (const coin of coins) {
    coin.collected = false;
    coin.mesh.setEnabled(true);
    coin.mesh.scaling.setAll(1);
  }
  showMessage("画面内の最寄りフックへWIRE → RELEASE", "normal");
};

const updateHud = (): void => {
  coinCount.textContent = `COIN ${String(coinsCollected).padStart(2, "0")} / 12`;
  speedReadout.textContent = String(Math.round(velocity.length()));
  speedFill.style.width = `${Math.min(100, velocity.length() / maxSpeed * 100)}%`;
  wireButton.setAttribute("aria-pressed", String(!!attachedAnchor));
  giantHpReadout.textContent = `GIANT ${"◆".repeat(giantHp)}${"◇".repeat(3 - giantHp)}`;
  giantHpReadout.setAttribute("aria-label", `巨人 HP ${giantHp} / 3`);
  select<HTMLElement>(".eyebrow").textContent = courseStage < 3 ? "FLIGHT CHECK / はじめの飛行" : "MISSION / コイン回収・巨人撃破";
  const creditedAnchor = attachedAnchor?.kind === "course" && (attachedAnchor.courseIndex ?? -1) < courseStage;
  if (courseStage < 3) objective.textContent = creditedAnchor ? "解除して次のアンカーへ" : "3つのアンカーをつないで飛ぼう";
  else if (giantHp <= 0 && coinsCollected >= 8) objective.textContent = "目標達成。STAGE CLEAR";
  else if (giantHp <= 0) objective.textContent = `あと${Math.max(0, 8 - coinsCollected)}枚のコインを集めよう`;
  else if (coinsCollected >= 8) objective.textContent = "巨人の弱点へ近づいて攻撃しよう";
  else objective.textContent = `コインを8枚集めて、巨人を倒せ（${coinsCollected} / 8）`;

  if (courseStage < 3) {
    const nextCourse = courseAnchorPositions[courseStage];
    const creditedAnchor = attachedAnchor?.kind === "course" && (attachedAnchor.courseIndex ?? -1) < courseStage;
    if (creditedAnchor) {
      routeReadout.textContent = `${courseStage} / 3　RELEASE → 次のアンカー`;
    } else {
      const offset = nextCourse.subtract(playerPosition);
      const distance = offset.length();
      const targetDirection = offset.clone().normalize();
      const forward = new Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
      const right = new Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
      const forwardDot = Vector3.Dot(targetDirection, forward);
      const heading = forwardDot > 0.72 ? "正面" : (forwardDot < -0.2 ? "背後" : (Vector3.Dot(targetDirection, right) >= 0 ? "右" : "左"));
      const vertical = offset.y > 3 ? "上" : (offset.y < -3 ? "下" : "同高度");
      routeReadout.textContent = `${courseStage} / 3　次のフック ${Math.round(distance)}m・${heading} / ${vertical}`;
    }
  } else {
    const nextCoin = coins.find((coin) => !coin.collected);
    const target = giantHp > 0 && coinsCollected >= 8 ? weakpoint.position : nextCoin?.mesh.position;
    if (target) {
    const offset = target.subtract(playerPosition);
    const horizontalDistance = Math.hypot(offset.x, offset.z);
    const targetDirection = offset.clone().normalize();
    const forward = new Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    const right = new Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const forwardDot = Vector3.Dot(targetDirection, forward);
    const heading = forwardDot > 0.72 ? "正面" : (forwardDot < -0.2 ? "背後" : (Vector3.Dot(targetDirection, right) >= 0 ? "右" : "左"));
    const targetLabel = giantHp > 0 && coinsCollected >= 8 ? `巨人の弱点：${Math.round(horizontalDistance)}m / ${heading}` : `次のコイン：${Math.round(horizontalDistance)}m / ${heading}`;
      routeReadout.textContent = targetLabel;
    } else {
      routeReadout.textContent = "目標ルート完了";
    }
  }

  if (attachedAnchor) {
    anchorReadout.textContent = `● ${attachedAnchor.name} / ${Math.round(Vector3.Distance(playerPosition, attachedAnchor.position))}m`;
    wireLabel.textContent = "RELEASE";
  } else if (candidateAnchor) {
    anchorReadout.textContent = `◎ 最寄り ${candidateAnchor.name} / ${Math.round(candidateDistance)}m`;
    wireLabel.textContent = "WIRE";
  } else {
    anchorReadout.textContent = "画面内のフックに近づこう（98m以内）";
    wireLabel.textContent = "WIRE";
  }
};

const updateCamera = (dt: number, now: number): void => {
  const forward = viewDirection();
  const focus = playerPosition.add(new Vector3(0, 2.05, 0));
  let wantedPosition = focus.subtract(forward.scale(14));
  if (segmentBlocked(focus, wantedPosition)) wantedPosition = focus.subtract(forward.scale(5.8));
  camera.position = Vector3.Lerp(camera.position, wantedPosition, clamp(dt * 7.5, 0, 1));
  camera.setTarget(focus);
};

const updateCandidateMarker = (dt: number): void => {
  const selected = attachedAnchor ?? candidateAnchor;
  if (!selected) {
    marker.setEnabled(false);
    return;
  }
  marker.setEnabled(true);
  marker.position = selected.position;
  marker.rotation.y += dt * 2.5;
  marker.material = selected.kind === "giant" ? markerGiantMaterial : markerMaterial;
  marker.scaling.setAll(attachedAnchor ? 1.18 : 1);
};

const updatePhysicsStep = (dt: number): void => {
  boostTimer = Math.max(0, boostTimer - dt);
  boostCooldown = Math.max(0, boostCooldown - dt);
  if (boostTimer <= 0) boosting = false;
  if (attachedAnchor && segmentBlocked(playerPosition, attachedAnchor.position, attachedAnchor)) detachWire(true);
  const movement = getMovement();
  const previous: [number, number, number] = [playerPosition.x, playerPosition.y, playerPosition.z];
  flightState.position = [...previous];
  flightState.velocity = [velocity.x, velocity.y, velocity.z];
  flightState.grounded = grounded;
  flightState.ropeLength = ropeLength;
  if (attachedAnchor) {
    const forward = viewDirection();
    stepAttached(flightState, [attachedAnchor.position.x, attachedAnchor.position.y, attachedAnchor.position.z],
      [movement.x, 0, movement.z], dt, isBoosting(), -Infinity,
      [forward.x, Math.max(0, forward.y), forward.z]);
  } else if (grounded) {
    const desiredX = movement.x * (isBoosting() ? 18 : 13);
    const desiredZ = movement.z * (isBoosting() ? 18 : 13);
    flightState.velocity[0] = approach(velocity.x, desiredX, 19 * dt);
    flightState.velocity[2] = approach(velocity.z, desiredZ, 19 * dt);
    if (movement.lengthSquared() < .001) {
      flightState.velocity[0] = approach(velocity.x, 0, 22 * dt);
      flightState.velocity[2] = approach(velocity.z, 0, 22 * dt);
    }
    // Gravity also acts when walking off a roof; collision keeps supported feet up.
    flightState.velocity[1] += gravity * dt;
    flightState.position = flightState.position.map((v,i) => v + flightState.velocity[i] * dt) as [number,number,number];
  } else {
    const forward = viewDirection();
    stepDetached(flightState, [movement.x, 0, movement.z], dt, isBoosting(),
      [forward.x, Math.max(0, forward.y), forward.z], gravity, maxSpeed);
  }
  const touched = resolveFlightCollision(flightState, previous, buildings, playerHalfHeight, playerRadius);
  playerPosition.copyFromFloats(...flightState.position);
  velocity.copyFromFloats(...flightState.velocity);
  ropeLength = flightState.ropeLength;
  grounded = flightState.grounded;
  // Release on contact instead of repeatedly pulling the character into a roof
  // or fighting the wall correction on the following physics step.
  if (attachedAnchor && touched) {
    detachWire(false);
    showMessage(grounded ? "着地 / ワイヤー解除" : "壁に接触 / ワイヤー解除", "normal");
  }

  if (Math.abs(playerPosition.x) > 116 || Math.abs(playerPosition.z) > 116 || playerPosition.y < -18) respawn();
  player.position.copyFrom(playerPosition);
  if (velocity.lengthSquared() > 0.1) player.rotation.y = Math.atan2(velocity.x, velocity.z);
  const speed = velocity.length();
  speedLines.classList.toggle("active", speed > 15 || isBoosting());
};

const updatePhysics = (dt: number): void => {
  const bounded = Math.max(0, dt);
  previousPhysicsZ = playerPosition.z;
  const steps = Math.max(1, Math.ceil(bounded / (1 / 120)));
  const step = bounded / steps;
  for (let index = 0; index < steps; index += 1) updatePhysicsStep(step);
};

const updateOpeningCourse = (): void => {
  if (attachedAnchor?.kind === "course" && attachedAnchor.courseIndex === courseStage) {
    if (!grounded && crossedCourseAnchor(previousPhysicsZ, playerPosition.z, [attachedAnchor.position.x, attachedAnchor.position.y, attachedAnchor.position.z], playerPosition.x)) {
      courseStage += 1;
      courseStarted = true;
      showMessage(courseStage < 3 ? `区間クリア ${courseStage} / 3　次のアンカーへ` : "OPENING COMPLETE　次はコインと巨人", "good");
    }
  }
  if (courseStarted && grounded && courseStage < 3) {
    courseStarted = false;
    courseStage = 0;
    showMessage("着地したためコースをリセット", "warn");
  }
};

const updateWorld = (dt: number): void => {
  for (const coin of coins) {
    if (coin.collected) continue;
    coin.mesh.rotation.y += dt * 2.9;
    coin.mesh.rotation.z += dt * 0.55;
  }
  weakpointRing.rotation.z += dt * 1.7;
  weakpointFlash = Math.max(0, weakpointFlash - dt);
  weakpoint.scaling.setAll(weakpointFlash > 0 ? 1.35 : 1);
  weakpointRing.scaling.setAll(weakpointFlash > 0 ? 1.18 : 1);
  tickAttackCooldown(progress, dt);
  attackCooldown = progress.attackCooldown;
  collectCoins();
  findCandidate();
  updateOpeningCourse();
  updateCandidateMarker(dt);
  updateWire();
  safePositionTimer += dt;
  if (grounded && safePositionTimer > 0.45) {
    safePositionTimer = 0;
    lastSafePosition.copyFrom(playerPosition);
  }
  if (!stageCleared && isStageClear(progress)) {
    stageCleared = true;
    detachWire(false);
    clearCoins.textContent = String(coinsCollected);
    clearScreen.classList.remove("is-hidden");
    showMessage("STAGE CLEAR", "good");
  }
  updateHud();
};

const resetStick = (): void => {
  stickInput.copyFromFloats(0, 0, 0);
  stickKnob.style.transform = "translate(-50%, -50%)";
};

const updateStick = (event: PointerEvent): void => {
  const rect = stickZone.getBoundingClientRect();
  const radius = Math.min(rect.width, rect.height) * 0.38;
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? radius / length : 1;
  const limitedX = dx * scale;
  const limitedY = dy * scale;
  stickInput.x = clamp(limitedX / radius, -1, 1);
  stickInput.z = clamp(-limitedY / radius, -1, 1);
  stickKnob.style.transform = `translate(calc(-50% + ${limitedX}px), calc(-50% + ${limitedY}px))`;
};

stickZone.addEventListener("pointerdown", (event: Event) => {
  const pointer = event as PointerEvent;
  pointer.preventDefault();
  pointer.stopPropagation();
  if (stickPointerId !== null) return;
  stickPointerId = pointer.pointerId;
  stickZone.setPointerCapture(pointer.pointerId);
  updateStick(pointer);
});
stickZone.addEventListener("pointermove", (event: Event) => {
  const pointer = event as PointerEvent;
  if (pointer.pointerId === stickPointerId) updateStick(pointer);
});
const endStick = (event: Event): void => {
  const pointer = event as PointerEvent;
  if (pointer.pointerId !== stickPointerId) return;
  stickPointerId = null;
  resetStick();
};
stickZone.addEventListener("pointerup", endStick);
stickZone.addEventListener("pointercancel", endStick);

boostButton.addEventListener("pointerdown", (event: Event) => {
  const pointer = event as PointerEvent;
  pointer.preventDefault();
  pointer.stopPropagation();
  triggerBoost();
  boostButton.classList.add("active");
  window.setTimeout(() => boostButton.classList.remove("active"), 120);
});

attackButton.addEventListener("pointerdown", (event: Event) => {
  const pointer = event as PointerEvent;
  pointer.preventDefault();
  pointer.stopPropagation();
  attack();
});
wireButton.addEventListener("pointerdown", (event: Event) => {
  const pointer = event as PointerEvent;
  pointer.preventDefault();
  pointer.stopPropagation();
});
wireButton.addEventListener("click", (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  toggleWire();
});
retryButton.addEventListener("click", () => resetStage());
quickRetryButton.addEventListener("click", () => resetStage());

canvas.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
  if (event.pointerType !== "mouse" && event.clientX < window.innerWidth * 0.42) return;
  event.preventDefault();
  cameraPointerId = event.pointerId;
  cameraLastX = event.clientX;
  cameraLastY = event.clientY;
  manualCameraUntil = performance.now() + 1600;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event: PointerEvent) => {
  if (event.pointerId !== cameraPointerId) return;
  const dx = event.clientX - cameraLastX;
  const dy = event.clientY - cameraLastY;
  cameraLastX = event.clientX;
  cameraLastY = event.clientY;
  cameraYaw += dx * 0.006;
  cameraPitch = clamp(cameraPitch - dy * 0.004, -0.8, 0.9);
  manualCameraUntil = performance.now() + 1600;
});
const endCamera = (event: PointerEvent): void => {
  if (event.pointerId === cameraPointerId) cameraPointerId = null;
};
canvas.addEventListener("pointerup", endCamera);
canvas.addEventListener("pointercancel", endCamera);
canvas.addEventListener("contextmenu", (event: MouseEvent) => event.preventDefault());

window.addEventListener("keydown", (event: KeyboardEvent) => {
  pressedKeys.add(event.code);
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (event.code === "Space") toggleWire();
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") triggerBoost();
  if (event.code === "KeyE") attack();
  if (event.code === "KeyR") resetStage();
});
window.addEventListener("keyup", (event: KeyboardEvent) => pressedKeys.delete(event.code));

const resetPointersAndKeys = (): void => {
  pressedKeys.clear();
  stickPointerId = null;
  cameraPointerId = null;
  boostPointerId = null;
  boosting = false;
  boostTimer = 0;
  boostCooldown = 0;
  boostButton.classList.remove("active");
  resetStick();
};
window.addEventListener("blur", resetPointersAndKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetPointersAndKeys();
});

resetStage();
let previousTime = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = clamp((now - previousTime) / 1000, 0, 0.1);
  previousTime = now;
  if (!stageCleared) updatePhysics(dt);
  updateCamera(dt, now);
  if (!stageCleared) updateWorld(dt);
  else {
    findCandidate();
    updateCandidateMarker(dt);
    updateHud();
  }
  art.updateEffects(dt);
  updateSky(dt);
  animateHero(dt, velocity.length(), grounded, !!attachedAnchor);
  animateGiant(now / 1000, giantHp, weakpointFlash);
  weakpoint.setEnabled(giantHp > 0);
  weakpointRing.setEnabled(giantHp > 0);
  scene.render();
});

window.addEventListener("resize", () => engine.resize());

// Read-only development diagnostics for real input and rendering QA. No production API.
if (import.meta.env.DEV) {
  Object.defineProperty(window, "skybreakDebug", { value: () => ({
    position: playerPosition.asArray(), velocity: velocity.asArray(), ropeLength, candidateDistance, speed: velocity.length(), grounded,
    attached: attachedAnchor?.name ?? null, candidate: candidateAnchor?.name ?? null,
    courseStage, coins: coinsCollected, giantHp, boosting: isBoosting(), stageCleared,
    render: { drawCalls: instrumentation?.drawCallsCounter.current ?? 0, activeMeshes: scene.getActiveMeshes().length,
      vertices: scene.getTotalVertices(), materials: scene.materials.length, textures: scene.textures.length,
      width: engine.getRenderWidth(), height: engine.getRenderHeight() },
  }) });
}
