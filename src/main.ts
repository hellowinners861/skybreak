import { jetPose, jetMissionClear } from './jet-route';
import { createJet } from './jet-model';
import { createStageStructures } from './stage-structures';
import { TERRACE_FOOTPRINTS } from './stage-structure-plan';
import { stageConfig, giantPose, giantPoint, type StageId } from './stage-config';
import { chooseAttack, attackVelocity, guideAttack, sweptWeakpointHit, impactVelocity, type AttackKind } from './combat';
import { createAppMenu, type GameSettings } from './app-menu';
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
import { damageGiant, collectCoin, createProgressState, isStageClear, resetProgress, tickAttackCooldown, tryAttack } from "./gameplay";
import { attachToAnchor, crossedCourseAnchor, COURSE_ANCHORS, FlightState, releaseFlight, stepAttached, stepDetached, stepTowed } from "./flight";
import { COMIC, createComicArt } from "./comic-art";
import { createBuildingShell, createCitySky, SUN_DIRECTION } from "./city-environment";
import { createWallMaterials } from "./wall-materials";
import { createBuildingFinishes, createRoofDeck } from "./building-finishes";
import { createCityStreets } from "./city-streets";
import { nearestVisibleWireTarget, type VisibleWireTarget } from "./wire-targeting";
import { resolveFlightCollision } from "./flight-collision";
import "./style.css";

const requestedStage = Number(new URLSearchParams(location.search).get("stage"));
const stageId: StageId = requestedStage === 3 ? 3 : requestedStage === 2 ? 2 : 1;
const stage = stageConfig(stageId);

type AnchorKind = "building" | "giant" | "course" | "jet";

type Anchor = {
  name: string;
  kind: AnchorKind;
  position: Vector3;
  mesh: Mesh;
  courseIndex?: number;
  giantLocal?: [number, number, number];
  motionDelta?: Vector3;
};

type Building = {
  mesh: Mesh;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  top: number;
  bottom?: number;
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
const releaseButton = select<HTMLButtonElement>("#release-button");
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
camera.maxZ = stageId !== 1 ? 900 : 420;
camera.fov = 0.9;
camera.inputs.clear();

const hemi = new HemisphericLight("soft-sky-light", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.55;
hemi.diffuse = new Color3(1, .97, .9);
hemi.groundColor = new Color3(.28, .40, .62);

const sun = new DirectionalLight("city-sun", SUN_DIRECTION.negate(), scene);
sun.position = new Vector3(-80*stage.worldScale, 150*stage.heightScale, -100*stage.worldScale);
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

const updateSky = createCitySky(scene, stage.worldScale);

const ground = MeshBuilder.CreateBox("arena-ground", { width: stage.halfExtent*2, height: 1, depth: stage.halfExtent*2 }, scene);
ground.position.y = -0.5;
ground.material = groundMaterial;
ground.isPickable = false;
ground.receiveShadows = true;

const buildings: Building[] = [];
const anchors: Anchor[] = [];
const wallMaterials = createWallMaterials(scene);
const buildingLayouts = stage.lots;

const cityStreets = createCityStreets(scene, buildingLayouts, [
  ...(stageId !== 1 ? TERRACE_FOOTPRINTS : []),
  [-22, stage.launchZ-8, 22, stage.launchZ+8], // Launch building is not part of the repeating lots.
  ...(stageId === 1 ? COURSE_ANCHORS : []).map(([x, , z]): [number, number, number, number] => {
    const supportX = x >= 0 ? 26 : -26;
    return [supportX - 2, z - 3, supportX + 2, z + 3];
  }),
], stage.worldScale);

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

const structures = stageId !== 1 ? createStageStructures(scene, wallMaterials, buildingFinishes, anchorMaterial) : {meshes:[],obstacles:[],anchors:[]};
buildings.push(...structures.obstacles);
anchors.push(...structures.anchors.map(anchor => ({...anchor,kind:'building' as const})));

const openingRoof = createBuildingShell("opening-roof", 22, 8, stage.launchHeight, 1, scene);
openingRoof.position = new Vector3(0, 0, stage.launchZ);
openingRoof.material = wallMaterials[1];
// Keep the cap above the wall top (40m), below the launch markings (40.025m).
createRoofDeck("roof-opening", 0, stage.launchZ, 22, 8, stage.launchHeight-.268, buildingFinishes[1].roof, scene);
buildings.push({ mesh: openingRoof, x: 0, z: stage.launchZ, halfX: 22, halfZ: 8, top: stage.launchHeight });

const courseAnchorPositions = (stageId === 1 ? COURSE_ANCHORS : []).map(([x, y, z]) => new Vector3(x, y, z));
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
giantRoot.position = stageId === 1 ? new Vector3(15, 0, 48) : new Vector3(...giantPose(0).position);
giantRoot.scaling.setAll(stage.giantScale);
giantRoot.rotation.y = stageId === 1 ? 0 : giantPose(0).yaw;

const animateGiant = art.createGiant(giantRoot, stageId !== 1);
art.decorateCity(buildingLayouts, cityStreets.landscape.patches, { worldScale:stage.worldScale, heightScale:stage.heightScale, course:stageId === 1 });
art.bake();
// These are only render meshes. Collision uses the original immutable lot dimensions.
const staticLots = [...new Set([...buildings.map(({ mesh }) => mesh), ...structures.meshes])];
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
weakpoint.position = new Vector3(...giantPoint([0,14,-3.45], {position:giantRoot.position.asArray() as [number,number,number],yaw:giantRoot.rotation.y}, stage.giantScale));
weakpoint.material = weakpointMaterial;
weakpoint.isPickable = false;
const weakpointRing = MeshBuilder.CreateTorus("giant-weakpoint-ring", { diameter: 4.2, thickness: 0.16, tessellation: 24 }, scene);
weakpointRing.position = weakpoint.position.clone();
weakpointRing.rotation.x = Math.PI / 2;
weakpointRing.material = weakpointMaterial;
weakpointRing.isPickable = false;

const createAnchor = (name: string, local: [number,number,number]): void => {
  const position = new Vector3(...giantPoint(local, {position:giantRoot.position.asArray() as [number,number,number],yaw:giantRoot.rotation.y}, stage.giantScale));
  const anchorMesh = MeshBuilder.CreateSphere(name, { diameter: 1.45*stage.giantScale, segments: 10 }, scene);
  anchorMesh.position = position.clone(); anchorMesh.material = anchorGiantMaterial; anchorMesh.isPickable = false;
  anchors.push({ name, kind:"giant", position:position.clone(), mesh:anchorMesh, giantLocal:local, motionDelta:Vector3.Zero() });
};
createAnchor("巨人・左肩", [-7,16,0]); createAnchor("巨人・右肩", [7,16,0]);
createAnchor("巨人・胸部", [0,12,-4]); createAnchor("巨人・頭上", [0,23,0]);

const jetRoot = stageId === 3 ? createJet(scene) : null;
const jetAnchor: Anchor | null = jetRoot ? (()=>{
  const mesh=MeshBuilder.CreateSphere('jet-wire-hook',{diameter:1.7,segments:10},scene);
  mesh.material=anchorMaterial;mesh.isPickable=false;
  const anchor: Anchor={name:'戦闘機・機体下フック',kind:'jet',position:Vector3.Zero(),mesh,motionDelta:Vector3.Zero()};
  anchors.push(anchor);return anchor;
})() : null;

const marker = MeshBuilder.CreateTorus("selected-anchor-marker", { diameter: 3.1, thickness: 0.16, tessellation: 24 }, scene);
marker.rotation.x = Math.PI / 2;
marker.material = markerMaterial;
marker.isPickable = false;
marker.setEnabled(false);

const spawnPosition = new Vector3(...stage.spawn);
const player = new TransformNode("player", scene);
player.position = spawnPosition.clone();
const animateHero = art.createHero(player);

const coinPositions = stage.coins.map(position => new Vector3(...position));
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
let specialAttack: { kind: "rush" | "dive"; remaining: number } | null = null;
let lastAttack: AttackKind | null = null;
let safePositionTimer = 0;
let messageTimer = 0;
let courseStage = stageId === 1 ? 0 : 3;
let giantClock = 0;
let jetClock = 0;
let jetRideSeconds = 0;
const weakpointDelta = Vector3.Zero();
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
  if (!appMenu?.isPlaying()) return;
  if (boostCooldown > 0 || stageCleared) return;
  appMenu.sound("boost");
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
      [start.y, delta.y, (building.top + (building.bottom ?? 0)) / 2],
      [start.z, delta.z, building.z],
    ];
    const mins = [building.x - building.halfX, building.bottom ?? 0, building.z - building.halfZ];
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
      blocked: segmentBlocked(camera.position, anchor.position),
    });
  }
  // NEXT in the opening course should not send the player back to an earlier hook.
  // They remain available to WIRE when detached, and after the opening ends.
  const completedBefore = Math.max(courseStage, attachedAnchor?.courseIndex ?? 0);
  const completed = attachedAnchor?.kind === "course" && courseStage < 3
    ? anchors.filter(anchor => anchor.kind === "course" && (anchor.courseIndex ?? -1) < completedBefore) : [];
  const best = nearestVisibleWireTarget(candidates, [playerPosition.x, playerPosition.y, playerPosition.z], camera.minZ, Infinity, attachedAnchor ?? undefined, completed);
  candidateAnchor = best?.target ?? null;
  candidateDistance = best?.distance ?? 0;
};

const toggleWire = (): void => {
  if (!appMenu?.isPlaying() || stageCleared) return;
  const transferring = !!attachedAnchor;
  findCandidate();
  if (!candidateAnchor) {
    showMessage(transferring ? "画面内に次のポイントがありません / 接続を維持" : "接続できるアンカーがありません", "warn");
    return;
  }
  specialAttack = null;
  appMenu.sound("wire");
  attachedAnchor = candidateAnchor;
  flightState.position = [playerPosition.x, playerPosition.y, playerPosition.z];
  flightState.velocity = [velocity.x, velocity.y, velocity.z];
  flightState.grounded = grounded;
  attachToAnchor(flightState, [candidateAnchor.position.x, candidateAnchor.position.y, candidateAnchor.position.z], [camera.getForwardRay(1).direction.x, 0, camera.getForwardRay(1).direction.z]);
  playerPosition.copyFromFloats(...flightState.position);
  velocity.copyFromFloats(...flightState.velocity);
  if(candidateAnchor.kind === "jet" && !flightState.recoveryRemaining) flightState.ropeLength += 3; // brief slack before tension builds
  ropeLength = flightState.ropeLength;
  grounded = flightState.grounded;
  if (candidateAnchor.kind === "course" && candidateAnchor.courseIndex === courseStage) courseStarted = true;
  showMessage(`${candidateAnchor.name} に${transferring ? "乗り換え" : "接続"}`, "good");
  findCandidate();
  updateHud();
};

const updateWire = (): void => {
  if (!attachedAnchor) return;
  const middle=Vector3.Lerp(playerPosition,attachedAnchor.position,.5);
  if(attachedAnchor.kind === 'jet') middle.y-=Math.min(4,Math.max(0,ropeLength-Vector3.Distance(playerPosition,attachedAnchor.position))*.5);
  const points = [playerPosition.clone(), middle, attachedAnchor.position.clone()];
  if (!wireMesh) {
    wireMesh = MeshBuilder.CreateLines("active-wire", { points, updatable: true }, scene);
    wireMesh.color = Color3.FromHexString(COMIC.ink);
  } else {
    MeshBuilder.CreateLines("active-wire", { points, instance: wireMesh });
  }
};

const respawn = (): void => {
  detachWire(false);
  specialAttack = null;
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
    appMenu.sound("coin");
    coinsCollected = progress.collectedCount;
    showMessage(`コイン取得　${coinsCollected} / 12`, "good");
  }
};

const weakpointVisible = (): boolean => {
  const offset = weakpoint.position.subtract(camera.position);
  const forward = camera.getForwardRay(1).direction.normalize();
  const right = Vector3.Cross(Vector3.Up(), forward).normalize();
  const up = Vector3.Cross(forward, right).normalize();
  const depth = Vector3.Dot(offset, forward), tanFov = Math.tan(camera.fov / 2);
  return giantHp > 0 && depth > camera.minZ
    && Math.abs(Vector3.Dot(offset, right) / (depth * tanFov * engine.getRenderWidth() / engine.getRenderHeight())) <= 1
    && Math.abs(Vector3.Dot(offset, up) / (depth * tanFov)) <= 1
    && !segmentBlocked(camera.position, weakpoint.position) && !segmentBlocked(playerPosition, weakpoint.position);
};
const availableAttack = (): AttackKind => chooseAttack([playerPosition.x,playerPosition.y,playerPosition.z], [velocity.x,velocity.y,velocity.z], grounded, [weakpoint.position.x,weakpoint.position.y,weakpoint.position.z], weakpointVisible());
const attackName = (kind: AttackKind): string => kind === "rush" ? "高速突進" : kind === "dive" ? "落下攻撃" : "通常攻撃";
const showImpact = (kind: AttackKind): void => {
  appMenu.sound("attack"); weakpointFlash = kind === "normal" ? .3 : .65;
  art.burst(weakpoint.position); lastAttack = kind;
  showMessage(`${attackName(kind)}！ ${kind === "normal" ? 1 : 2}ダメージ / 残りHP ${giantHp}`, "good");
};
const attack = (): void => {
  if (!appMenu?.isPlaying() || stageCleared || attackCooldown > 0 || specialAttack) return;
  if (giantHp <= 0) { showMessage("巨人はすでに倒れている", "good"); return; }
  const kind = availableAttack();
  attackButton.classList.add("active");
  window.setTimeout(() => attackButton.classList.remove("active"), 110);
  if (kind !== "normal") {
    detachWire(false); grounded = false;
    velocity.copyFromFloats(...attackVelocity(kind, [playerPosition.x,playerPosition.y,playerPosition.z], [velocity.x,velocity.y,velocity.z], [weakpoint.position.x,weakpoint.position.y,weakpoint.position.z]));
    specialAttack = { kind, remaining: 1.4 };
    progress.attackCooldown = 1.75; attackCooldown = 1.75;
    appMenu.sound("boost");
    showMessage(`${attackName(kind)}！ 弱点へ`, "good"); return;
  }
  const result = tryAttack(progress, Vector3.Distance(playerPosition, weakpoint.position) <= 22 && !segmentBlocked(playerPosition, weakpoint.position));
  attackCooldown = progress.attackCooldown; giantHp = progress.giantHp;
  if (result === "out-of-range") { showMessage("弱点へ近づこう / 加速ならRUSH、上から落下ならDIVE", "warn"); return; }
  if (result === "hit") showImpact(kind);
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
  courseStage = stageId === 1 ? 0 : 3;
  courseStarted = false;
  boostTimer = 0;
  boostCooldown = 0;
  weakpointFlash = 0;
  specialAttack = null; lastAttack = null; player.rotation.x = 0;
  stageCleared = false;
  cameraYaw = 0;
  cameraPitch = stageId === 3 ? .12 : stageId === 1 ? -.12 : -.45;
  giantClock = 0; updateMovingGiant(0);
  jetClock=0;jetRideSeconds=0;updateMovingJet(0);
  select<HTMLElement>(".brand span").textContent = `STAGE 0${stageId} / ${stageId === 3 ? "SKY HUNTER" : stageId === 1 ? "TUTORIAL" : "TITAN DISTRICT"}`;
  camera.position.copyFrom(spawnPosition.add(new Vector3(0, 2.05, 0)).subtract(viewDirection().scale(14)));
  camera.setTarget(spawnPosition.add(new Vector3(0, 2.05, 0)));
  clearScreen.classList.add("is-hidden");
  for (const coin of coins) {
    coin.collected = false;
    coin.mesh.setEnabled(true);
    coin.mesh.scaling.setAll(1);
  }
  if(stageId === 3) clearScreen.querySelector('p')!.replaceChildren('戦闘機で移動・巨人撃破！ コイン ',clearCoins,' / 12（ボーナス）');
  showMessage(stageId === 3 ? "STAGE 3 / 戦闘機へWIRE！ 3秒以上移動し、巨人を倒せ" : stageId === 1 ? "画面内の最寄りフックへWIRE → NEXTで乗り換え" : "STAGE 2 / 巡回する巨人を追い、コイン8枚と巨人撃破！", "normal");
};

const updateHud = (): void => {
  releaseButton.disabled = !attachedAnchor;
  const kind = specialAttack?.kind ?? availableAttack();
  select<HTMLElement>("#attack-label").textContent = specialAttack ? "GO!" : attackCooldown > 0 ? "WAIT" : kind === "rush" ? "RUSH" : kind === "dive" ? "DIVE" : "ATTACK";
  attackButton.dataset.kind = kind;
  attackButton.setAttribute("aria-label", `${attackName(kind)}${attackCooldown > 0 ? "、準備中" : ""}`);
  select<HTMLElement>("#combat-readout").textContent = giantHp <= 0 ? "巨人撃破！ コインを集めよう" : specialAttack ? `${attackName(kind)}中！` : attackCooldown > 0 ? "攻撃準備中…" : kind === "rush" ? "高速突進 READY / ATTACKで弱点へ" : kind === "dive" ? "落下攻撃 READY / ATTACKで急降下" : "ATTACK通常 / 加速でRUSH・上から落下でDIVE";
  coinCount.textContent = `COIN ${String(coinsCollected).padStart(2, "0")} / 12`;
  speedReadout.textContent = String(Math.round(velocity.length()));
  speedFill.style.width = `${Math.min(100, velocity.length() / maxSpeed * 100)}%`;
  wireButton.setAttribute("aria-pressed", String(!!attachedAnchor));
  giantHpReadout.textContent = `GIANT ${"◆".repeat(giantHp)}${"◇".repeat(3 - giantHp)}`;
  giantHpReadout.setAttribute("aria-label", `巨人 HP ${giantHp} / 3`);
  select<HTMLElement>(".eyebrow").textContent = courseStage < 3 ? "FLIGHT CHECK / はじめの飛行" : "MISSION / コイン回収・巨人撃破";
  const creditedAnchor = attachedAnchor?.kind === "course" && (attachedAnchor.courseIndex ?? -1) < courseStage;
  if (courseStage < 3) objective.textContent = creditedAnchor ? "NEXTで次のアンカーへ" : "3つのアンカーをつないで飛ぼう";
  else if (giantHp <= 0 && coinsCollected >= 8) objective.textContent = "目標達成。STAGE CLEAR";
  else if (giantHp <= 0) objective.textContent = `あと${Math.max(0, 8 - coinsCollected)}枚のコインを集めよう`;
  else if (coinsCollected >= 8) objective.textContent = "巨人の弱点へ近づいて攻撃しよう";
  else objective.textContent = `コインを8枚集めて、巨人を倒せ（${coinsCollected} / 8）`;
  if(stageId === 3) {
    select<HTMLElement>('.eyebrow').textContent='SKY HUNTER / 戦闘機ワイヤー';
    objective.textContent=stageCleared?'目標達成。STAGE CLEAR':jetRideSeconds<3?`戦闘機で3秒移動し、巨人を倒せ（${Math.min(3,jetRideSeconds).toFixed(1)} / 3秒）`:giantHp>0?'戦闘機から解除 → RUSH・DIVEで巨人を倒せ':'巨人撃破！ 戦闘機で3秒移動しよう';
  }

  if (courseStage < 3) {
    const nextCourse = courseAnchorPositions[courseStage];
    const creditedAnchor = attachedAnchor?.kind === "course" && (attachedAnchor.courseIndex ?? -1) < courseStage;
    if (creditedAnchor) {
      routeReadout.textContent = `${courseStage} / 3　NEXT → 次のアンカー`;
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

  if(jetAnchor) {
    const offset=jetAnchor.position.subtract(playerPosition),forward=new Vector3(Math.sin(cameraYaw),0,Math.cos(cameraYaw)),right=new Vector3(Math.cos(cameraYaw),0,-Math.sin(cameraYaw));
    const heading=Vector3.Dot(offset.normalizeToNew(),forward)>.72?'正面':Vector3.Dot(offset.normalizeToNew(),forward)<-.2?'背後':Vector3.Dot(offset,right)>0?'右':'左';
    routeReadout.textContent=attachedAnchor?.kind==='jet'?'✈ 接続中 / RELEASEで勢いを保って巨人へ':`✈ 戦闘機 ${Math.round(offset.length())}m・${heading} / ${offset.y>3?'上':offset.y< -3?'下':'同高度'} → 黄色い球へWIRE`;
  }
  if (attachedAnchor) {
    anchorReadout.textContent = `● ${attachedAnchor.name} / ${Math.round(Vector3.Distance(playerPosition, attachedAnchor.position))}m`;
    wireLabel.textContent = "NEXT";
    if (candidateAnchor) anchorReadout.textContent += ` → 次 ${candidateAnchor.name}`;
  } else if (candidateAnchor) {
    anchorReadout.textContent = `◎ 最寄り ${candidateAnchor.name} / ${Math.round(candidateDistance)}m`;
    wireLabel.textContent = "WIRE";
  } else {
    anchorReadout.textContent = "カメラを動かして黄色い球を画面に入れよう";
    wireLabel.textContent = "WIRE";
  }
};

const updateCamera = (dt: number, now: number): void => {
  const focus = playerPosition.add(new Vector3(0, 2.05, 0));
  // During the opening only, preview the next hook before reaching the current
  // one. Manual swipes take priority, including while the finger is held down.
  if (appMenu.getSettings().courseCamera && attachedAnchor?.kind === "course" && courseStage < 3 && cameraPointerId === null && now >= manualCameraUntil) {
    const nextIndex = Math.min(courseAnchorPositions.length - 1, Math.max(courseStage, (attachedAnchor.courseIndex ?? 0) + 1));
    const offset = courseAnchorPositions[nextIndex].subtract(focus);
    const wantedYaw = Math.atan2(offset.x, offset.z);
    const yawDelta = Math.atan2(Math.sin(wantedYaw - cameraYaw), Math.cos(wantedYaw - cameraYaw));
    cameraYaw += yawDelta * (1 - Math.exp(-2.5 * dt));
    const wantedPitch = clamp(Math.atan2(offset.y, Math.max(14, Math.hypot(offset.x, offset.z))), -0.6, 1.2);
    cameraPitch += (wantedPitch - cameraPitch) * (1 - Math.exp(-3 * dt));
  }
  const forward = viewDirection();
  let wantedPosition = focus.subtract(forward.scale(14));
  if (segmentBlocked(focus, wantedPosition)) wantedPosition = focus.subtract(forward.scale(5.8));
  // Looking up from the street must not put the orbit camera under the ground.
  // Lift its aim by the same amount to preserve the requested upward view.
  const groundLift = Math.max(0, 1.5 - wantedPosition.y);
  wantedPosition.y += groundLift;
  camera.position = Vector3.Lerp(camera.position, wantedPosition, clamp(dt * 7.5, 0, 1));
  camera.position.y = Math.max(1.5, camera.position.y);
  camera.setTarget(focus.add(new Vector3(0, groundLift, 0)));
};

const updateCandidateMarker = (dt: number): void => {
  const selected = candidateAnchor ?? attachedAnchor;
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

const updateMovingGiant = (dt: number): void => {
  if (stageId !== 1 && giantHp > 0) giantClock += dt;
  const pose = stageId !== 1 ? giantPose(giantClock) : { position:[15,0,48] as [number,number,number], yaw:0 };
  giantRoot.position.copyFromFloats(...pose.position); giantRoot.rotation.y = pose.yaw;
  const previousWeakpoint = weakpoint.position.clone();
  weakpoint.position.copyFromFloats(...giantPoint([0,14,-3.45], pose, stage.giantScale));
  weakpointDelta.copyFrom(weakpoint.position.subtract(previousWeakpoint));
  weakpointRing.position.copyFrom(weakpoint.position); weakpointRing.rotation.y = pose.yaw;
  weakpoint.scaling.setAll(stage.giantScale*(weakpointFlash > 0 ? 1.35 : 1)); weakpointRing.scaling.setAll(stage.giantScale*(weakpointFlash > 0 ? 1.18 : 1));
  for (const anchor of anchors) if (anchor.giantLocal) {
    const previous = anchor.position.clone();
    anchor.position.copyFromFloats(...giantPoint(anchor.giantLocal, pose, stage.giantScale));
    anchor.motionDelta!.copyFrom(anchor.position.subtract(previous)); anchor.mesh.position.copyFrom(anchor.position);
  }
};
const updateMovingJet = (dt: number): void => {
  if(!jetRoot || !jetAnchor)return;
  jetClock+=dt;
  const pose=jetPose(jetClock),previous=jetAnchor.position.clone();
  jetRoot.position.copyFromFloats(...pose.position);jetRoot.rotation.set(pose.pitch,pose.yaw,pose.bank);
  jetRoot.computeWorldMatrix(true);
  jetAnchor.position.copyFrom(Vector3.TransformCoordinates(new Vector3(0,-2.1,0),jetRoot.getWorldMatrix()));
  jetAnchor.motionDelta!.copyFrom(jetAnchor.position.subtract(previous));jetAnchor.mesh.position.copyFrom(jetAnchor.position);
};
const updatePhysicsStep = (dt: number): void => {
  updateMovingGiant(dt);
  updateMovingJet(dt);
  boostTimer = Math.max(0, boostTimer - dt);
  boostCooldown = Math.max(0, boostCooldown - dt);
  if (boostTimer <= 0) boosting = false;
  // Visibility is decided from the camera. Player collisions handle contact;
  // a different player-to-hook sightline must not immediately cancel a visible hook.
  const movement = getMovement();
  const previous: [number, number, number] = [playerPosition.x, playerPosition.y, playerPosition.z];
  flightState.position = [...previous];
  flightState.velocity = [velocity.x, velocity.y, velocity.z];
  flightState.grounded = grounded;
  flightState.ropeLength = ropeLength;
  if (specialAttack) {
    velocity.copyFromFloats(...guideAttack([playerPosition.x,playerPosition.y,playerPosition.z], [velocity.x,velocity.y,velocity.z], [weakpoint.position.x,weakpoint.position.y,weakpoint.position.z], dt));
    flightState.velocity = [velocity.x,velocity.y,velocity.z];
  }
  if(attachedAnchor?.kind === 'jet') {
    const forward=viewDirection(),anchorVelocity=dt>0?attachedAnchor.motionDelta!.scale(1/dt):Vector3.Zero();
    stepTowed(flightState,attachedAnchor.position.asArray() as [number,number,number],anchorVelocity.asArray() as [number,number,number],[movement.x,0,movement.z],dt,isBoosting(),[forward.x,Math.max(0,forward.y),forward.z]);
  } else if (attachedAnchor) {
    const forward = viewDirection();
    const delta = attachedAnchor.motionDelta ?? Vector3.Zero();
    const anchorVelocity = delta.scale(1/Math.max(dt,.000001));
    flightState.velocity[0] -= anchorVelocity.x; flightState.velocity[1] -= anchorVelocity.y; flightState.velocity[2] -= anchorVelocity.z;
    stepAttached(flightState, [attachedAnchor.position.x-delta.x, attachedAnchor.position.y-delta.y, attachedAnchor.position.z-delta.z],
      [movement.x, 0, movement.z], dt, isBoosting(), -Infinity,
      [forward.x, Math.max(0, forward.y), forward.z]);
    flightState.position[0] += delta.x; flightState.position[1] += delta.y; flightState.position[2] += delta.z;
    flightState.velocity[0] += anchorVelocity.x; flightState.velocity[1] += anchorVelocity.y; flightState.velocity[2] += anchorVelocity.z;
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
  if (specialAttack) {
    const blocked = segmentBlocked(new Vector3(...previous), playerPosition);
    if (!blocked && !touched && sweptWeakpointHit([previous[0]-weakpoint.position.x+weakpointDelta.x,previous[1]-weakpoint.position.y+weakpointDelta.y,previous[2]-weakpoint.position.z+weakpointDelta.z], [playerPosition.x-weakpoint.position.x,playerPosition.y-weakpoint.position.y,playerPosition.z-weakpoint.position.z], [0,0,0])) {
      const kind = specialAttack.kind; specialAttack = null;
      // The cooldown was reserved at launch; only physical contact deals damage.
      damageGiant(progress, 2); giantHp = progress.giantHp;
      velocity.copyFromFloats(...impactVelocity([playerPosition.x,playerPosition.y,playerPosition.z], [velocity.x,velocity.y,velocity.z], [weakpoint.position.x,weakpoint.position.y,weakpoint.position.z]));
      showImpact(kind);
    } else {
      specialAttack.remaining -= dt;
      if (touched || specialAttack.remaining <= 0) { specialAttack = null; showMessage("攻撃終了 / 再びワイヤーで飛ぼう", "normal"); }
    }
  }
  // Release on contact instead of repeatedly pulling the character into a roof
  // or fighting the wall correction on the following physics step.
  if(attachedAnchor?.kind === "jet" && !touched && !grounded) jetRideSeconds+=dt;
  if (attachedAnchor && touched) {
    detachWire(false);
    showMessage(grounded ? "着地 / ワイヤー解除" : "壁に接触 / ワイヤー解除", "normal");
  }

  if (Math.abs(playerPosition.x) > stage.playableHalfExtent || Math.abs(playerPosition.z) > stage.playableHalfExtent || playerPosition.y < -18) respawn();
  player.position.copyFrom(playerPosition);
  if (velocity.lengthSquared() > 0.1) player.rotation.y = Math.atan2(velocity.x, velocity.z);
  const speed = velocity.length();
  speedLines.classList.toggle("active", appMenu.getSettings().speedLines && (speed > 15 || isBoosting()));
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
    courseStage = stageId === 1 ? 0 : 3;
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
  weakpoint.scaling.setAll(stage.giantScale*(weakpointFlash > 0 ? 1.35 : 1));
  weakpointRing.scaling.setAll(stage.giantScale*(weakpointFlash > 0 ? 1.18 : 1));
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
  if (!stageCleared && (stageId === 3 ? jetMissionClear(giantHp,jetRideSeconds) : isStageClear(progress))) {
    stageCleared = true;
    appMenu.markClear();
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
releaseButton.addEventListener("click", (event) => { event.preventDefault(); detachWire(true); });
wireButton.addEventListener("click", (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  toggleWire();
});
retryButton.addEventListener("click", () => appMenu.restart());
quickRetryButton.addEventListener("click", () => appMenu.confirmRestart());

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
  cameraYaw += dx * 0.006 * appMenu.getSettings().sensitivity;
  cameraPitch = clamp(cameraPitch - dy * 0.004 * appMenu.getSettings().sensitivity, -1.3, 0.9);
  manualCameraUntil = performance.now() + 1600;
});
const endCamera = (event: PointerEvent): void => {
  if (event.pointerId === cameraPointerId) cameraPointerId = null;
};
canvas.addEventListener("pointerup", endCamera);
canvas.addEventListener("pointercancel", endCamera);
canvas.addEventListener("contextmenu", (event: MouseEvent) => event.preventDefault());

window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.code === "Escape") { event.preventDefault(); if (!event.repeat) appMenu.escape(); return; }
  if (!appMenu.isPlaying() || (event.target as HTMLElement)?.matches("input, select, button")) return;
  pressedKeys.add(event.code);
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  if (event.code === "Space") toggleWire();
  if (event.code === "KeyQ") detachWire(true);
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") triggerBoost();
  if (event.code === "KeyE") attack();
  if (event.code === "KeyR") appMenu.confirmRestart();
});
window.addEventListener("keyup", (event: KeyboardEvent) => pressedKeys.delete(event.code));

const resetPointersAndKeys = (): void => {
  pressedKeys.clear();
  stickPointerId = null;
  cameraPointerId = null;
  boostPointerId = null;
  boosting = false;
  boostButton.classList.remove("active");
  resetStick();
};
window.addEventListener("blur", () => { resetPointersAndKeys(); appMenu?.pause(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { resetPointersAndKeys(); appMenu?.pause(); }
});

let appMenu: ReturnType<typeof createAppMenu>;
const applySettings = (settings: GameSettings): void => {
  const limit = settings.quality === 'low' ? 1 : settings.quality === 'high' ? 2 : 1.5;
  const scale = 1 / Math.min(limit, window.devicePixelRatio || 1);
  if (engine.getHardwareScalingLevel() !== scale) { engine.setHardwareScalingLevel(scale); engine.resize(); }
  speedLines.style.display = settings.speedLines ? '' : 'none';
};
resetStage();
appMenu = createAppMenu({ initialStage:stageId, autoStart:new URLSearchParams(location.search).get("play") === "1", start: (id) => {
  if (id === stageId) { resetStage(); return true; }
  const url = new URL(location.href); url.searchParams.set("stage", String(id)); url.searchParams.set("play", "1"); location.assign(url.href); return false;
}, resetInput: resetPointersAndKeys, settings: applySettings });
let lastMenuRender = 0;
let previousTime = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = clamp((now - previousTime) / 1000, 0, 0.1);
  previousTime = now;
  // Keep the initial catch pass available even on a slow first asset download.
  if (!scene.isReady()) {
    appMenu.setJetAudio(0);
    if (now-lastMenuRender >= 250) { scene.render(); lastMenuRender=now; }
    return;
  }
  if (!appMenu.isPlaying()) {
    appMenu.setJetAudio(0);
    if (now - lastMenuRender >= 250) { scene.render(); lastMenuRender = now; }
    return;
  }
  if (!stageCleared) updatePhysics(dt);
  updateCamera(dt, now);
  if (!stageCleared) updateWorld(dt);
  else {
    findCandidate();
    updateCandidateMarker(dt);
    updateHud();
  }
  appMenu.setJetAudio(jetAnchor && !stageCleared ? Math.max(0,1-Vector3.Distance(camera.position,jetAnchor.position)/200)*.8 : 0);
  art.updateEffects(dt);
  updateSky(dt);
  const wireOffset = attachedAnchor?.position.subtract(playerPosition);
  const wireLean = wireOffset ? Math.atan2(wireOffset.x*Math.sin(player.rotation.y)+wireOffset.z*Math.cos(player.rotation.y), Math.max(.5,wireOffset.y)) : 0;
  player.rotation.x = approach(player.rotation.x, specialAttack?.kind === "dive" ? .85 : specialAttack?.kind === "rush" ? .35 : 0, dt * 4);
  animateHero(dt, velocity.length(), grounded, !!attachedAnchor, wireLean);
  animateGiant(stageId !== 1 ? giantClock : now / 1000, giantHp, weakpointFlash, stageId !== 1 && giantHp > 0);
  weakpoint.setEnabled(giantHp > 0);
  weakpointRing.setEnabled(giantHp > 0);
  scene.render();
});

window.addEventListener("resize", () => engine.resize());

// Read-only development diagnostics for real input and rendering QA. No production API.
if (import.meta.env.DEV) {
  Object.defineProperty(window, "skybreakDebug", { value: () => ({
    giantHooks:anchors.filter(anchor=>anchor.kind === "giant").map(anchor=>({name:anchor.name,position:anchor.position.asArray()})),
    stageId, giantClock, giantPosition:giantRoot.position.asArray(), giantYaw:giantRoot.rotation.y, giantScale:giantRoot.scaling.asArray(), heroScale:player.scaling.asArray(), weakpoint:weakpoint.position.asArray(), halfExtent:stage.halfExtent, launchHeight:stage.launchHeight, buildingTops:buildingLayouts.map(lot=>lot[4]),
    jet: jetAnchor ? {position:jetAnchor.position.asArray(),clock:jetClock,rideSeconds:jetRideSeconds,pose:jetPose(jetClock)} : null,
    structureAnchors: structures.anchors.map(a=>({name:a.name,position:a.position.asArray()})),
    cameraYaw, cameraPitch,
    screen: document.querySelector("#game-shell")?.getAttribute("data-screen"), settings: appMenu.getSettings(),
    position: playerPosition.asArray(), velocity: velocity.asArray(), ropeLength, recoveryRemaining: flightState.recoveryRemaining ?? 0, candidateDistance, speed: velocity.length(), grounded,
    attached: attachedAnchor?.name ?? null, candidate: candidateAnchor?.name ?? null,
    attack: specialAttack?.kind ?? null, attackRemaining: specialAttack?.remaining ?? 0, lastAttack, availableAttack: availableAttack(),
    courseStage, coins: coinsCollected, giantHp, boosting: isBoosting(), stageCleared,
    render: { drawCalls: instrumentation?.drawCallsCounter.current ?? 0, activeMeshes: scene.getActiveMeshes().length,
      vertices: scene.getTotalVertices(), materials: scene.materials.length, textures: scene.textures.length,
      width: engine.getRenderWidth(), height: engine.getRenderHeight() },
  }) });
}
