import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";

// Shared architectural finishes follow the same brick / tile / plaster order as walls.
export function createBuildingFinishes(scene: Scene) {
  const solid = (name: string, color: string, metal = false) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor = metal
      ? new Color3(0.16, 0.2, 0.24)
      : Color3.Black();
    material.specularPower = 48;
    material.maxSimultaneousLights = 2;
    return material;
  };
  return [
    {
      name: "brick",
      frame: "#e4d2ad",
      trim: "#c6ae8c",
      metal: "#505a59",
      roof: "#a7664b",
      glass: ["#afced3", "#416376"],
      accent: "#927052",
    },
    {
      name: "tile",
      frame: "#354c61",
      trim: "#bac8ca",
      metal: "#6c8590",
      roof: "#526a79",
      glass: ["#b7dce4", "#285971"],
      accent: "#57798a",
    },
    {
      name: "plaster",
      frame: "#736251",
      trim: "#d7c8aa",
      metal: "#626c67",
      roof: "#bbb4a1",
      glass: ["#c8dbd3", "#476c70"],
      accent: "#af8c62",
    },
  ].map((style, index) => {
    const frame = solid(`finish-${style.name}-frame`, style.frame, index === 1);
    const trim = solid(`finish-${style.name}-trim`, style.trim);
    const metal = solid(`finish-${style.name}-metal`, style.metal, true);
    const accent = solid(`finish-${style.name}-accent`, style.accent);
    const glass = solid(`finish-${style.name}-glass`, "#ffffff", true);
    const reflection = new DynamicTexture(
      `glass-sky-${style.name}`,
      128,
      scene,
      true,
    );
    const ctx = reflection.getContext() as CanvasRenderingContext2D;
    const sky = ctx.createLinearGradient(0, 0, 0, 128);
    sky.addColorStop(0, style.glass[0]);
    sky.addColorStop(0.55, style.glass[1]);
    sky.addColorStop(1, "#78959c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "rgba(239,250,246,0.24)";
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(34, 0);
    ctx.lineTo(99, 128);
    ctx.lineTo(75, 128);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(239,250,246,0.1)";
    ctx.beginPath();
    ctx.moveTo(42, 0);
    ctx.lineTo(48, 0);
    ctx.lineTo(113, 128);
    ctx.lineTo(107, 128);
    ctx.closePath();
    ctx.fill();
    reflection.update();
    glass.diffuseTexture = reflection;
    glass.emissiveColor = new Color3(0.05, 0.065, 0.07);
    // Opaque stylized glass keeps the interior private and avoids transparency sorting.
    const roof = solid(`finish-${style.name}-roof`, "#ffffff");
    const surface = new DynamicTexture(
      `roof-surface-${style.name}`,
      256,
      scene,
      true,
    );
    const r = surface.getContext() as CanvasRenderingContext2D;
    r.fillStyle = style.roof;
    r.fillRect(0, 0, 256, 256);
    let seed = 29 + index;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 1800; n++) {
      r.fillStyle =
        random() > 0.5 ? "rgba(255,255,255,.07)" : "rgba(16,30,36,.07)";
      r.fillRect(
        random() * 256,
        random() * 256,
        1 + random() * 2,
        1 + random() * 2,
      );
    }
    if (index === 0) {
      for (let row = 0; row < 8; row++)
        for (let column = -1; column < 8; column++) {
          const x = column * 40 + (row % 2) * 20,
            y = row * 32;
          r.fillStyle = "rgba(55,32,27,.28)";
          r.fillRect(x, y, 40, 2);
          r.fillRect(x, y, 2, 32);
          r.fillStyle = "rgba(255,217,174,.16)";
          r.fillRect(x + 3, y + 3, 35, 2);
        }
    } else if (index === 1) {
      for (let x = 0; x < 256; x += 32) {
        r.fillStyle = "rgba(20,38,48,.28)";
        r.fillRect(x, 0, 2, 256);
        r.fillStyle = "rgba(216,231,235,.16)";
        r.fillRect(x + 2, 0, 1, 256);
      }
    } else {
      r.strokeStyle = "rgba(91,84,70,.18)";
      r.lineWidth = 1;
      for (let x = 0; x <= 256; x += 64) {
        r.beginPath();
        r.moveTo(x, 0);
        r.lineTo(x, 256);
        r.stroke();
        r.beginPath();
        r.moveTo(0, x);
        r.lineTo(256, x);
        r.stroke();
      }
    }
    surface.update();
    surface.wrapU = surface.wrapV = Texture.WRAP_ADDRESSMODE;
    surface.uScale = surface.vScale = 0.25;
    surface.anisotropicFilteringLevel = 4;
    roof.diffuseTexture = surface;
    return { frame, trim, metal, accent, glass, roof };
  });
}

// Metre-scaled UVs keep roof seams readable without stretching across each lot.
export function createRoofDeck(
  name: string,
  x: number,
  z: number,
  halfX: number,
  halfZ: number,
  height: number,
  material: StandardMaterial,
  scene: Scene,
) {
  const roof = MeshBuilder.CreateBox(
    name,
    { width: halfX * 2 + 0.3, height: 0.28, depth: halfZ * 2 + 0.3 },
    scene,
  );
  const positions = roof.getVerticesData(VertexBuffer.PositionKind)!;
  const normals = roof.getVerticesData(VertexBuffer.NormalKind)!;
  const uvs: number[] = [];
  for (let v = 0; v < positions.length; v += 3) {
    const [px, py, pz] = positions.slice(v, v + 3);
    if (Math.abs(normals[v + 1]) > 0.5) uvs.push(px, pz);
    else if (Math.abs(normals[v]) > 0.5) uvs.push(pz, py);
    else uvs.push(px, py);
  }
  roof.setVerticesData(VertexBuffer.UVKind, uvs);
  roof.position = new Vector3(x, height + 0.14, z);
  roof.material = material;
  roof.isPickable = false;
  roof.receiveShadows = true;
  return roof;
}
