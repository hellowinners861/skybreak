import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { collectCoin, createProgressState, isStageClear, resetProgress, tickAttackCooldown, tryAttack } from "./gameplay";
import { attachToAnchor, crossedCourseAnchor, COURSE_ANCHORS, FlightState, releaseFlight, stepAttached, stepDetached } from "./flight";
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

const engine = new Engine(canvas, true, {
  antialias: true,
  preserveDrawingBuffer: false,
  stencil: true,
});
engine.setHardwareScalingLevel(Math.min(1.35, Math.max(1, window.devicePixelRatio * 0.78)));

const scene = new Scene(engine);
scene.clearColor = new Color4(0.035, 0.11, 0.19, 1);

const camera = new UniversalCamera("follow-camera", new Vector3(-84, 8, -98), scene);
camera.minZ = 0.2;
camera.maxZ = 420;
camera.fov = 0.9;
camera.inputs.clear();

const hemi = new HemisphericLight("soft-sky-light", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.92;
hemi.diffuse = new Color3(0.73, 0.88, 1);
hemi.groundColor = new Color3(0.08, 0.12, 0.2);

const sun = new DirectionalLight("city-sun", new Vector3(-0.35, -1, 0.42), scene);
sun.position = new Vector3(-80, 150, -100);
sun.intensity = 0.62;

const hex = (value: string): Color3 => Color3.FromHexString(value);

const material = (name: string, diffuse: string, emissive = "#000000"): StandardMaterial => {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = hex(diffuse);
  result.emissiveColor = hex(emissive);
  result.specularColor = new Color3(0.12, 0.16, 0.22);
  return result;
};

const groundMaterial = material("ground-material", "#13253b", "#071523");
const roadMaterial = material("road-material", "#0a1728", "#07111c");
const roofMaterial = material("roof-material", "#1c3b55", "#092131");
const playerMaterial = material("player-material", "#55d8e8", "#0b4658");
const playerAccentMaterial = material("player-accent", "#f4fbff", "#276d7e");
const anchorMaterial = material("anchor-material", "#54ecff", "#1599b4");
const anchorGiantMaterial = material("giant-anchor-material", "#ffbd55", "#91450e");
const coinMaterial = material("coin-material", "#ffd45a", "#b9630d");
const giantMaterial = material("giant-material", "#6e3e63", "#250e31");
const giantLightMaterial = material("giant-light-material", "#be6f76", "#4e1e37");
const weakpointMaterial = material("weakpoint-material", "#ff5c6a", "#ba1529");
const markerMaterial = material("target-marker-material", "#a4f7ff", "#2cc4db");
const markerGiantMaterial = material("target-giant-marker-material", "#ffd16e", "#ba6812");

const skybox = MeshBuilder.CreateBox("skybox", { size: 500 }, scene);
const skyMaterial = material("sky-material", "#0b2841", "#0b2841");
skyMaterial.disableLighting = true;
skyMaterial.backFaceCulling = false;
skybox.material = skyMaterial;
skybox.infiniteDistance = true;
skybox.isPickable = false;

const ground = MeshBuilder.CreateBox("arena-ground", { width: 240, height: 1, depth: 240 }, scene);
ground.position.y = -0.5;
ground.material = groundMaterial;
ground.isPickable = false;

const roadA = MeshBuilder.CreateBox("road-east-west", { width: 240, height: 0.12, depth: 5 }, scene);
roadA.position.y = 0.06;
roadA.material = roadMaterial;
const roadB = MeshBuilder.CreateBox("road-north-south", { width: 5, height: 0.13, depth: 240 }, scene);
roadB.position.y = 0.07;
roadB.material = roadMaterial;

const buildings: Building[] = [];
const anchors: Anchor[] = [];
const buildingPalette = ["#294965", "#325a74", "#3c516c", "#26546d", "#46556d"];
const buildingLayouts: Array<[number, number, number, number, number]> = [
  [-62, -72, 9, 8, 14], [-38, -72, 10, 8, 21], [38, -72, 10, 8, 17], [62, -72, 9, 8, 25],
  [-70, -40, 12, 9, 18], [-42, -40, 9, 11, 27], [42, -40, 12, 10, 21], [70, -40, 10, 8, 13],
  [-70, 0, 13, 10, 23], [-42, 2, 10, 9, 15], [42, 1, 11, 12, 24], [70, 4, 8, 9, 18],
  [-70, 40, 11, 10, 16], [-42, 42, 10, 8, 22], [42, 39, 12, 9, 28], [70, 38, 9, 11, 18],
  [-62, 72, 13, 9, 20], [-30, 72, 10, 11, 15], [30, 72, 10, 11, 24], [62, 72, 12, 10, 24],
];

for (let index = 0; index < buildingLayouts.length; index += 1) {
  const [x, z, halfX, halfZ, height] = buildingLayouts[index];
  const building = MeshBuilder.CreateBox(`building-${index + 1}`, {
    width: halfX * 2,
    height,
    depth: halfZ * 2,
  }, scene);
  building.position = new Vector3(x, height / 2, z);
  building.material = material(`building-mat-${index + 1}`, buildingPalette[index % buildingPalette.length], "#091726");

  const roof = MeshBuilder.CreateBox(`roof-${index + 1}`, {
    width: halfX * 2 + 0.45,
    height: 0.28,
    depth: halfZ * 2 + 0.45,
  }, scene);
  roof.position = new Vector3(x, height + 0.14, z);
  roof.material = roofMaterial;

  const anchorMesh = MeshBuilder.CreateSphere(`building-anchor-${index + 1}`, { diameter: 1.1, segments: 8 }, scene);
  const anchorPosition = new Vector3(x, height + 2, z);
  anchorMesh.position = anchorPosition;
  anchorMesh.material = anchorMaterial;
  anchorMesh.isPickable = false;
  anchors.push({ name: `ビル ${String(index + 1).padStart(2, "0")}`, kind: "building", position: anchorPosition.clone(), mesh: anchorMesh });
  buildings.push({ mesh: building, x, z, halfX, halfZ, top: height });
}

const openingRoof = MeshBuilder.CreateBox("opening-roof", { width: 44, height: 40, depth: 16 }, scene);
openingRoof.position = new Vector3(0, 20, -88);
openingRoof.material = roofMaterial;
buildings.push({ mesh: openingRoof, x: 0, z: -88, halfX: 22, halfZ: 8, top: 40 });

const courseAnchorPositions = COURSE_ANCHORS.map(([x, y, z]) => new Vector3(x, y, z));
for (let index = 0; index < courseAnchorPositions.length; index += 1) {
  const point = courseAnchorPositions[index];
  const supportX = point.x >= 0 ? 26 : -26;
  const support = MeshBuilder.CreateBox(`course-support-${index + 1}`, { width: 4, height: point.y - 2, depth: 6 }, scene);
  support.position = new Vector3(supportX, (point.y - 2) / 2, point.z);
  support.material = material(`course-support-material-${index + 1}`, index % 2 === 0 ? "#1d5874" : "#254c6d", "#082536");
  buildings.push({ mesh: support, x: supportX, z: point.z, halfX: 2, halfZ: 3, top: point.y - 2 });
  const anchorMesh = MeshBuilder.CreateSphere(`course-anchor-${index + 1}`, { diameter: 1.8, segments: 10 }, scene);
  anchorMesh.position = point.clone();
  anchorMesh.material = anchorMaterial;
  anchorMesh.isPickable = false;
  anchors.push({ name: `COURSE ${index + 1}`, kind: "course", courseIndex: index, position: point.clone(), mesh: anchorMesh });
}

const giantRoot = new TransformNode("giant-root", scene);
giantRoot.position = new Vector3(15, 0, 48);

const giantPart = (name: string, dimensions: { width: number; height: number; depth: number }, position: Vector3, partMaterial = giantMaterial): Mesh => {
  const part = MeshBuilder.CreateBox(name, dimensions, scene);
  part.position = giantRoot.position.add(position);
  part.material = partMaterial;
  return part;
};

const giantBody = giantPart("giant-body", { width: 9, height: 18, depth: 5 }, new Vector3(0, 10, 0));
const giantChest = giantPart("giant-chest-plate", { width: 6.2, height: 8, depth: 0.55 }, new Vector3(0, 12, -2.74), giantLightMaterial);
const giantHead = MeshBuilder.CreateSphere("giant-head", { diameter: 6.5, segments: 12 }, scene);
giantHead.position = giantRoot.position.add(new Vector3(0, 22, 0));
giantHead.material = giantMaterial;
const giantEye = MeshBuilder.CreateBox("giant-eye-strip", { width: 3.4, height: 0.45, depth: 0.25 }, scene);
giantEye.position = giantRoot.position.add(new Vector3(0, 22.2, -2.95));
giantEye.material = weakpointMaterial;
const leftArm = giantPart("giant-left-arm", { width: 3, height: 14, depth: 3 }, new Vector3(-7, 10, 0), giantLightMaterial);
leftArm.rotation.z = -0.08;
const rightArm = giantPart("giant-right-arm", { width: 3, height: 14, depth: 3 }, new Vector3(7, 10, 0), giantLightMaterial);
rightArm.rotation.z = 0.08;
giantPart("giant-left-leg", { width: 3.4, height: 9, depth: 3.6 }, new Vector3(-2.6, 1, 0));
giantPart("giant-right-leg", { width: 3.4, height: 9, depth: 3.6 }, new Vector3(2.6, 1, 0));

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
const player = MeshBuilder.CreateBox("player", { width: 1.1, height: 2.3, depth: 0.9 }, scene);
player.position = spawnPosition.clone();
player.material = playerMaterial;
player.isPickable = false;
const playerVisor = MeshBuilder.CreateBox("player-visor", { width: 0.72, height: 0.33, depth: 0.12 }, scene);
playerVisor.parent = player;
playerVisor.position = new Vector3(0, 0.35, 0.47);
playerVisor.material = playerAccentMaterial;
playerVisor.isPickable = false;

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
let cameraPitch = 0.30;
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
  playerMaterial.emissiveColor = hex("#0b4658");
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
  const candidates: Array<{ anchor: Anchor; distance: number; score: number }> = [];
  for (const anchor of anchors) {
    if (anchor.kind === "course" && anchor.courseIndex !== courseStage) continue;
    const offset = anchor.position.subtract(playerPosition);
    const distance = offset.length();
    const cameraOffset = anchor.position.subtract(camera.position).normalize();
    if (distance < 2.2 || distance > 98) continue;
    const toward = offset.scale(1 / distance);
    const forwardDot = Vector3.Dot(cameraOffset, forward);
    if (forwardDot <= 0) continue;
    const screenX = Vector3.Dot(cameraOffset, right) / Math.max(forwardDot, 0.25) / (tanHalfFov * aspect);
    const screenY = Vector3.Dot(cameraOffset, up) / Math.max(forwardDot, 0.25) / tanHalfFov;
    if (Math.abs(screenX) > 0.42 || Math.abs(screenY) > 0.42) continue;
    if (segmentBlocked(camera.position, anchor.position, anchor) || segmentBlocked(playerPosition, anchor.position, anchor)) continue;
    const courseBonus = anchor.kind === "course" ? -0.24 : 0;
    candidates.push({ anchor, distance, score: Math.abs(screenX) + Math.abs(screenY) + distance * 0.002 + courseBonus });
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (candidateAnchor && candidates.some((item) => item.anchor === candidateAnchor && item.score <= (best?.score ?? Infinity) + 0.08)) {
    const current = candidates.find((item) => item.anchor === candidateAnchor)!;
    candidateDistance = current.distance;
    return;
  }
  candidateAnchor = best?.anchor ?? null;
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
  playerMaterial.emissiveColor = hex("#1fa2ba");
  showMessage(`${candidateAnchor.name} に接続`, "good");
};

const updateWire = (): void => {
  if (!attachedAnchor) return;
  const points = [playerPosition.clone(), attachedAnchor.position.clone()];
  if (!wireMesh) {
    wireMesh = MeshBuilder.CreateLines("active-wire", { points, updatable: true }, scene);
    wireMesh.color = new Color3(0.42, 0.94, 1);
  } else {
    MeshBuilder.CreateLines("active-wire", { points, instance: wireMesh });
  }
};

const moveAndCollide = (dt: number): void => {
  let next = playerPosition.add(velocity.scale(dt));
  grounded = false;

  if (next.y <= playerHalfHeight) {
    next.y = playerHalfHeight;
    if (velocity.y < 0) velocity.y = 0;
    grounded = true;
  }

  for (const building of buildings) {
    const overlapX = building.halfX + playerRadius - Math.abs(next.x - building.x);
    const overlapZ = building.halfZ + playerRadius - Math.abs(next.z - building.z);
    const crossesHeight = next.y - playerHalfHeight <= building.top + 0.05 && next.y + playerHalfHeight > 0;
    if (overlapX <= 0 || overlapZ <= 0 || !crossesHeight) continue;

    const wasAbove = playerPosition.y - playerHalfHeight >= building.top - 0.05;
    const isLanding = wasAbove && next.y - playerHalfHeight <= building.top + 0.05 && velocity.y <= 0;
    if (isLanding) {
      next.y = building.top + playerHalfHeight;
      velocity.y = 0;
      grounded = true;
      continue;
    }

    if (next.y < building.top + playerHalfHeight) {
      if (overlapX < overlapZ) {
        const side = Math.sign(next.x - building.x) || Math.sign(playerPosition.x - building.x) || 1;
        next.x = building.x + side * (building.halfX + playerRadius);
        if (velocity.x * side < 0) velocity.x = 0;
      } else {
        const side = Math.sign(next.z - building.z) || Math.sign(playerPosition.z - building.z) || 1;
        next.z = building.z + side * (building.halfZ + playerRadius);
        if (velocity.z * side < 0) velocity.z = 0;
      }
    }
  }

  playerPosition.copyFrom(next);
};

const resolveAttachedPenetration = (): boolean => {
  let groundedOnSurface = false;
  if (playerPosition.y < playerHalfHeight) {
    playerPosition.y = playerHalfHeight;
    if (velocity.y < 0) velocity.y = 0;
    groundedOnSurface = true;
  }
  for (const building of buildings) {
    const overlapX = building.halfX + playerRadius - Math.abs(playerPosition.x - building.x);
    const overlapZ = building.halfZ + playerRadius - Math.abs(playerPosition.z - building.z);
    const crossesHeight = playerPosition.y - playerHalfHeight < building.top && playerPosition.y + playerHalfHeight > 0;
    if (overlapX <= 0 || overlapZ <= 0 || !crossesHeight || playerPosition.y >= building.top + playerHalfHeight) continue;
    if (playerPosition.y >= building.top + playerHalfHeight - 0.35 && velocity.y <= 0) {
      playerPosition.y = building.top + playerHalfHeight;
      velocity.y = 0;
      groundedOnSurface = true;
      continue;
    }
    if (overlapX < overlapZ) {
      const side = Math.sign(playerPosition.x - building.x) || 1;
      playerPosition.x = building.x + side * (building.halfX + playerRadius);
      if (velocity.x * side < 0) velocity.x = 0;
    } else {
      const side = Math.sign(playerPosition.z - building.z) || 1;
      playerPosition.z = building.z + side * (building.halfZ + playerRadius);
      if (velocity.z * side < 0) velocity.z = 0;
    }
  }
  return groundedOnSurface;
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
  showMessage(`弱点ヒット　残りHP ${giantHp}`, "good");
  if (giantHp <= 0) showMessage("巨人撃破。コインを8枚集めよう", "good");
};

const resetStage = (): void => {
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
  cameraPitch = 0.30;
  camera.position.copyFrom(spawnPosition.add(new Vector3(0, 2.05, 0)).subtract(viewDirection().scale(10.2)));
  camera.setTarget(spawnPosition.add(new Vector3(0, 2.05, 0)));
  clearScreen.classList.add("is-hidden");
  for (const coin of coins) {
    coin.collected = false;
    coin.mesh.setEnabled(true);
    coin.mesh.scaling.setAll(1);
  }
  showMessage("狙ってWIRE → 飛ぶ → RELEASE", "normal");
};

const updateHud = (): void => {
  coinCount.textContent = `コイン ${coinsCollected} / 12`;
  giantHpReadout.textContent = `巨人 HP ${giantHp} / 3`;
  const creditedAnchor = attachedAnchor?.kind === "course" && (attachedAnchor.courseIndex ?? -1) < courseStage;
  if (courseStage < 3) objective.textContent = creditedAnchor ? "解除して次のアンカーへ" : "3つのアンカーをつないで飛ぼう";
  else if (giantHp <= 0 && coinsCollected >= 8) objective.textContent = "目標達成。STAGE CLEAR";
  else if (giantHp <= 0) objective.textContent = `あと${Math.max(0, 8 - coinsCollected)}枚のコインを集めよう`;
  else if (coinsCollected >= 8) objective.textContent = "巨人の弱点へ近づいて攻撃しよう";
  else objective.textContent = `コインを8枚集めて、巨人を倒せ（${coinsCollected} / 8）`;

  const courseLabel = courseStage < 3 ? `OPENING ${courseStage} / 3` : "OPENING COMPLETE";
  if (courseStage < 3) {
    const nextCourse = courseAnchorPositions[courseStage];
    const creditedAnchor = attachedAnchor?.kind === "course" && (attachedAnchor.courseIndex ?? -1) < courseStage;
    if (creditedAnchor) {
      routeReadout.textContent = `${courseLabel}　解除して次へ　｜ ${Math.round(velocity.length())}m/s / 高度${Math.round(playerPosition.y)}m`;
    } else {
      const offset = nextCourse.subtract(playerPosition);
      const distance = offset.length();
      const targetDirection = offset.clone().normalize();
      const forward = new Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
      const right = new Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
      const forwardDot = Vector3.Dot(targetDirection, forward);
      const heading = forwardDot > 0.72 ? "正面" : (forwardDot < -0.2 ? "背後" : (Vector3.Dot(targetDirection, right) >= 0 ? "右" : "左"));
      const vertical = offset.y > 3 ? "上" : (offset.y < -3 ? "下" : "同高度");
      routeReadout.textContent = `${courseLabel}　次のアンカー${courseStage + 1}：${Math.round(distance)}m / ${heading}・${vertical}　｜ ${Math.round(velocity.length())}m/s / 高度${Math.round(playerPosition.y)}m`;
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
      routeReadout.textContent = `${courseLabel}　${targetLabel}　｜ ${Math.round(velocity.length())}m/s / 高度${Math.round(playerPosition.y)}m`;
    } else {
      routeReadout.textContent = `${courseLabel}　目標ルート完了　｜ ${Math.round(velocity.length())}m/s / 高度${Math.round(playerPosition.y)}m`;
    }
  }

  if (attachedAnchor) {
    anchorReadout.textContent = `接続中：${attachedAnchor.name}　${Math.round(Vector3.Distance(playerPosition, attachedAnchor.position))}m　｜ タップで解除`;
    wireLabel.textContent = "RELEASE";
  } else if (candidateAnchor) {
    anchorReadout.textContent = `照準：${candidateAnchor.name}　${Math.round(candidateDistance)}m　｜ WIREで接続`;
    wireLabel.textContent = "WIRE";
  } else {
    anchorReadout.textContent = "照準アンカーなし　視線を建物へ向けてください";
    wireLabel.textContent = "WIRE";
  }
};

const updateCamera = (dt: number, now: number): void => {
  const forward = viewDirection();
  const focus = playerPosition.add(new Vector3(0, 2.05, 0));
  let wantedPosition = focus.subtract(forward.scale(10.2));
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
  if (attachedAnchor) {
    flightState.position = [playerPosition.x, playerPosition.y, playerPosition.z];
    flightState.velocity = [velocity.x, velocity.y, velocity.z];
    flightState.grounded = grounded;
    flightState.ropeLength = ropeLength;
    const boostForward = camera.getForwardRay(1).direction;
    stepAttached(flightState, [attachedAnchor.position.x, attachedAnchor.position.y, attachedAnchor.position.z], [movement.x, movement.y, movement.z], dt, isBoosting(), playerHalfHeight, [boostForward.x, Math.max(0, boostForward.y), boostForward.z]);
    playerPosition.copyFromFloats(...flightState.position);
    velocity.copyFromFloats(...flightState.velocity);
    ropeLength = flightState.ropeLength;
    grounded = resolveAttachedPenetration() || flightState.grounded;
  } else {
    if (grounded) {
      const desiredX = movement.x * (isBoosting() ? 18 : 13);
      const desiredZ = movement.z * (isBoosting() ? 18 : 13);
      velocity.x = approach(velocity.x, desiredX, 19 * dt);
      velocity.z = approach(velocity.z, desiredZ, 19 * dt);
      if (movement.lengthSquared() < 0.001) {
        velocity.x = approach(velocity.x, 0, 22 * dt);
        velocity.z = approach(velocity.z, 0, 22 * dt);
      }
    } else {
      const detachedState: FlightState = {
        position: [playerPosition.x, playerPosition.y, playerPosition.z],
        velocity: [velocity.x, velocity.y, velocity.z],
        grounded: false,
        attached: false,
        ropeLength: 0,
      };
      const forward = viewDirection();
      stepDetached(detachedState, [movement.x, 0, movement.z], dt, isBoosting(), [forward.x, Math.max(0, forward.y), forward.z], gravity, maxSpeed, false);
      velocity.copyFromFloats(...detachedState.velocity);
    }
    moveAndCollide(dt);
  }

  if (Math.abs(playerPosition.x) > 116 || Math.abs(playerPosition.z) > 116 || playerPosition.y < -18) respawn();
  player.position.copyFrom(playerPosition);
  if (velocity.lengthSquared() > 0.1) player.rotation.y = Math.atan2(velocity.x, velocity.z);
  playerMaterial.emissiveColor = attachedAnchor ? hex("#1fa2ba") : (isBoosting() ? hex("#1c7d9a") : hex("#0b4658"));
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
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
