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
import "./style.css";

type AnchorKind = "building" | "giant";

type Anchor = {
  name: string;
  kind: AnchorKind;
  position: Vector3;
  mesh: Mesh;
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
  [-72, -72, 9, 8, 14], [-45, -75, 13, 8, 21], [-13, -74, 10, 10, 17], [20, -75, 13, 8, 25], [57, -72, 10, 10, 16],
  [-78, -39, 12, 9, 18], [-46, -39, 9, 11, 27], [43, -39, 12, 10, 21], [74, -38, 10, 8, 13],
  [-78, -4, 13, 10, 23], [-46, 2, 10, 9, 15], [53, 1, 11, 12, 24], [78, 4, 8, 9, 18],
  [-76, 37, 11, 10, 16], [-43, 42, 10, 8, 22], [43, 39, 12, 9, 28], [73, 38, 9, 11, 18],
  [-65, 72, 13, 9, 20], [-25, 71, 10, 11, 15], [62, 71, 12, 10, 24],
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

const spawnPosition = new Vector3(-87, 1.15, -87);
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
let cameraYaw = 0.64;
let cameraPitch = -0.16;
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
const gravity = -26;
const maxSpeed = 42;

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

const isBoosting = (): boolean => boosting || pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight");

const capVelocity = (): void => {
  const speed = velocity.length();
  if (speed > maxSpeed) velocity.scaleInPlace(maxSpeed / speed);
};

const detachWire = (announce: boolean): void => {
  if (!attachedAnchor) return;
  attachedAnchor = null;
  ropeLength = 0;
  if (wireMesh) {
    wireMesh.dispose();
    wireMesh = null;
  }
  playerMaterial.emissiveColor = hex("#0b4658");
  if (announce) showMessage("ワイヤー解除 / 勢いを維持", "good");
};

const findCandidate = (): void => {
  const direction = viewDirection();
  let best: { anchor: Anchor; distance: number; score: number } | null = null;
  for (const anchor of anchors) {
    const offset = anchor.position.subtract(playerPosition);
    const distance = offset.length();
    if (distance < 2.2 || distance > 98) continue;
    const toward = offset.scale(1 / distance);
    const alignment = Vector3.Dot(toward, direction);
    if (alignment < -0.34) continue;
    const distanceScore = 1 - distance / 98;
    const score = alignment * 2.1 + distanceScore * 0.8 + (anchor.kind === "giant" ? 0.035 : 0);
    if (!best || score > best.score) best = { anchor, distance, score };
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
  if (!candidateAnchor) {
    showMessage("接続できるアンカーがありません", "warn");
    return;
  }
  attachedAnchor = candidateAnchor;
  ropeLength = clamp(candidateDistance, 12, 88);
  grounded = false;
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
    const crossesHeight = next.y - playerHalfHeight < building.top && next.y + playerHalfHeight > 0;
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

const resolveAttachedPenetration = (): void => {
  if (playerPosition.y < playerHalfHeight) {
    playerPosition.y = playerHalfHeight;
    if (velocity.y < 0) velocity.y = 0;
  }
  for (const building of buildings) {
    const overlapX = building.halfX + playerRadius - Math.abs(playerPosition.x - building.x);
    const overlapZ = building.halfZ + playerRadius - Math.abs(playerPosition.z - building.z);
    const crossesHeight = playerPosition.y - playerHalfHeight < building.top && playerPosition.y + playerHalfHeight > 0;
    if (overlapX <= 0 || overlapZ <= 0 || !crossesHeight || playerPosition.y >= building.top + playerHalfHeight) continue;
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
};

const respawn = (): void => {
  detachWire(false);
  playerPosition.copyFrom(lastSafePosition);
  velocity.copyFromFloats(0, 0, 0);
  grounded = true;
  showMessage("ルートへリスポーン", "warn");
};

const collectCoins = (): void => {
  for (const coin of coins) {
    if (coin.collected) continue;
    if (Vector3.Distance(playerPosition, coin.mesh.position) > 5.2) continue;
    coin.collected = true;
    coin.mesh.setEnabled(false);
    coinsCollected += 1;
    showMessage(`コイン取得　${coinsCollected} / 12`, "good");
  }
};

const attack = (): void => {
  if (stageCleared || attackCooldown > 0) return;
  attackCooldown = 0.62;
  attackButton.classList.add("active");
  window.setTimeout(() => attackButton.classList.remove("active"), 110);
  const distance = Vector3.Distance(playerPosition, weakpoint.position);
  if (giantHp <= 0) {
    showMessage("巨人はすでに倒れている", "good");
    return;
  }
  if (distance > 22) {
    showMessage("弱点へ近づいて攻撃", "warn");
    return;
  }
  giantHp -= 1;
  weakpointFlash = 0.3;
  showMessage(`弱点ヒット　残りHP ${giantHp}`, "good");
  if (giantHp <= 0) showMessage("巨人撃破。コインを8枚集めよう", "good");
};

const resetStage = (): void => {
  detachWire(false);
  playerPosition.copyFrom(spawnPosition);
  lastSafePosition.copyFrom(spawnPosition);
  velocity.copyFromFloats(0, 0, 0);
  grounded = true;
  coinsCollected = 0;
  giantHp = 3;
  attackCooldown = 0;
  weakpointFlash = 0;
  stageCleared = false;
  cameraYaw = 0.64;
  cameraPitch = -0.16;
  clearScreen.classList.add("is-hidden");
  for (const coin of coins) {
    coin.collected = false;
    coin.mesh.setEnabled(true);
    coin.mesh.scaling.setAll(1);
  }
  showMessage("Stage 1 へようこそ。アンカーを狙ってワイヤー", "normal");
};

const updateHud = (): void => {
  coinCount.textContent = `コイン ${coinsCollected} / 12`;
  giantHpReadout.textContent = `巨人 HP ${giantHp} / 3`;
  if (giantHp <= 0 && coinsCollected >= 8) objective.textContent = "目標達成。STAGE CLEAR";
  else if (giantHp <= 0) objective.textContent = `あと${Math.max(0, 8 - coinsCollected)}枚のコインを集めよう`;
  else if (coinsCollected >= 8) objective.textContent = "巨人の弱点へ近づいて攻撃しよう";
  else objective.textContent = `コインを8枚集めて、巨人を倒せ（${coinsCollected} / 8）`;

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
  const speed = velocity.length();
  if (now > manualCameraUntil && speed > 2.5) {
    const desiredYaw = Math.atan2(velocity.x, velocity.z);
    cameraYaw = angleApproach(cameraYaw, desiredYaw, 1 - Math.exp(-dt * 1.5));
  }
  const forward = viewDirection();
  const focus = playerPosition.add(new Vector3(0, 2.05, 0));
  const wantedPosition = focus.subtract(forward.scale(10.2));
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

const updatePhysics = (dt: number): void => {
  const movement = getMovement();
  if (attachedAnchor) {
    const anchorPosition = attachedAnchor.position;
    const offset = playerPosition.subtract(anchorPosition);
    const distance = Math.max(offset.length(), 0.001);
    const radial = offset.scale(1 / distance);
    velocity.y += gravity * dt;

    if (movement.lengthSquared() > 0.001) {
      const tangent = movement.subtract(radial.scale(Vector3.Dot(movement, radial)));
      if (tangent.lengthSquared() > 0.001) velocity.addInPlace(tangent.normalize().scale(28 * dt));
    } else {
      const tangentVelocity = velocity.subtract(radial.scale(Vector3.Dot(velocity, radial)));
      if (tangentVelocity.lengthSquared() > 0.001) velocity.addInPlace(tangentVelocity.normalize().scale(4 * dt));
    }

    if (isBoosting()) velocity.addInPlace(viewDirection().scale(34 * dt));
    capVelocity();
    const next = playerPosition.add(velocity.scale(dt));
    const nextOffset = next.subtract(anchorPosition);
    const nextDistance = nextOffset.length();
    if (nextDistance > ropeLength) {
      const corrected = anchorPosition.add(nextOffset.scale(ropeLength / Math.max(nextDistance, 0.001)));
      const correctedRadial = corrected.subtract(anchorPosition).normalize();
      const outwardSpeed = Vector3.Dot(velocity, correctedRadial);
      if (outwardSpeed > 0) velocity.subtractInPlace(correctedRadial.scale(outwardSpeed * 1.25));
      playerPosition.copyFrom(corrected);
    } else {
      playerPosition.copyFrom(next);
    }
    resolveAttachedPenetration();
    grounded = false;
  } else {
    const airControl = grounded ? 19 : 7;
    const desiredX = movement.x * (isBoosting() ? 18 : 13);
    const desiredZ = movement.z * (isBoosting() ? 18 : 13);
    velocity.x = approach(velocity.x, desiredX, airControl * dt);
    velocity.z = approach(velocity.z, desiredZ, airControl * dt);
    if (movement.lengthSquared() < 0.001 && grounded) {
      velocity.x = approach(velocity.x, 0, 22 * dt);
      velocity.z = approach(velocity.z, 0, 22 * dt);
    }
    velocity.y += gravity * dt;
    if (isBoosting()) velocity.addInPlace(viewDirection().scale(26 * dt));
    capVelocity();
    moveAndCollide(dt);
  }

  if (Math.abs(playerPosition.x) > 116 || Math.abs(playerPosition.z) > 116 || playerPosition.y < -18) respawn();
  player.position.copyFrom(playerPosition);
  if (velocity.lengthSquared() > 0.1) player.rotation.y = Math.atan2(velocity.x, velocity.z);
  playerMaterial.emissiveColor = attachedAnchor ? hex("#1fa2ba") : (isBoosting() ? hex("#1c7d9a") : hex("#0b4658"));
  const speed = velocity.length();
  speedLines.classList.toggle("active", speed > 15 || isBoosting());
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
  if (attackCooldown > 0) attackCooldown = Math.max(0, attackCooldown - dt);
  collectCoins();
  findCandidate();
  updateCandidateMarker(dt);
  updateWire();
  safePositionTimer += dt;
  if (grounded && safePositionTimer > 0.45) {
    safePositionTimer = 0;
    lastSafePosition.copyFrom(playerPosition);
  }
  if (!stageCleared && coinsCollected >= 8 && giantHp <= 0) {
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
  boostPointerId = pointer.pointerId;
  boosting = true;
  boostButton.classList.add("active");
  boostButton.setPointerCapture(pointer.pointerId);
});
const endBoost = (event: Event): void => {
  const pointer = event as PointerEvent;
  if (pointer.pointerId !== boostPointerId) return;
  boostPointerId = null;
  boosting = false;
  boostButton.classList.remove("active");
};
boostButton.addEventListener("pointerup", endBoost);
boostButton.addEventListener("pointercancel", endBoost);

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
  cameraPitch = clamp(cameraPitch - dy * 0.004, -0.8, 0.45);
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
  const dt = clamp((now - previousTime) / 1000, 0, 0.033);
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
