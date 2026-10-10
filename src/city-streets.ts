import {
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  VertexBuffer,
} from "@babylonjs/core";
import type { CityLot } from "./comic-art";
import { planCityLandscape, type GroundRect } from "./city-landscape-plan";
import lawnUrl from "./assets/landscape/sage-lawn.webp";
import blueUrl from "./assets/streets/asphalt-blue.webp";
import warmUrl from "./assets/streets/asphalt-warm.webp";
import charcoalUrl from "./assets/streets/asphalt-charcoal.webp";
import creamUrl from "./assets/streets/sidewalk-cream.webp";
import slateUrl from "./assets/streets/sidewalk-slate.webp";
import brickUrl from "./assets/streets/sidewalk-brick.webp";

export function createCityStreets(scene: Scene, lots: CityLot[], extraFootprints: GroundRect[] = []) {
  const textured = (name: string, url: string, metres: number) => {
    const texture = new Texture(
      url,
      scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = `street-texture-${name}`;
    texture.uScale = texture.vScale = 1 / metres;
    texture.wrapU = texture.wrapV = Texture.MIRROR_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    const material = new StandardMaterial(`street-${name}`, scene);
    material.diffuseTexture = texture;
    material.diffuseColor = Color3.White();
    material.specularColor = Color3.Black();
    material.maxSimultaneousLights = 2;
    return material;
  };
  const asphalt = [
    textured("asphalt-warm", warmUrl, 1),
    textured("asphalt-blue", blueUrl, 1),
    textured("asphalt-charcoal", charcoalUrl, 1),
  ];
  const sidewalks = [
    textured("sidewalk-brick", brickUrl, 2.4),
    textured("sidewalk-slate", slateUrl, 2.4),
    textured("sidewalk-cream", creamUrl, 2.4),
  ];
  const solid = (name: string, color: string) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor = Color3.Black();
    material.maxSimultaneousLights = 2;
    return material;
  };
  const curb = solid("street-curb", "#b5b3a5");
  const marking = solid("street-marking", "#f3e9cf");
  const lawn = textured("sage-lawn", lawnUrl, 4);
  const batches = new Map<Material, Mesh[]>();
  const slab = (
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    top: number,
    height: number,
    material: Material,
  ) => {
    const mesh = MeshBuilder.CreateBox(name, { width, depth, height }, scene);
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const uvs: number[] = [];
    // World-space metre UVs align neighboring road cells, independent of mesh size.
    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i] + x,
        pz = positions[i + 2] + z,
        py = positions[i + 1] + top - height / 2;
      if (Math.abs(normals[i + 1]) > 0.5) uvs.push(px, pz);
      else if (Math.abs(normals[i]) > 0.5) uvs.push(pz, py);
      else uvs.push(px, py);
    }
    mesh.setVerticesData(VertexBuffer.UVKind, uvs);
    mesh.position.set(x, top - height / 2, z);
    mesh.material = material;
    mesh.isPickable = false;
    const group = batches.get(material) ?? [];
    group.push(mesh);
    batches.set(material, group);
  };
  // Partition the road grid into disjoint rectangles, including intersections.
  // This avoids coplanar overlapping asphalt and keeps grain continuous in a district.
  const xs = [-120, -100, -92, -4, 4, 92, 100, 120];
  const zs = [-120, -60, -52, -24, -16, -4, 4, 16, 24, 52, 60, 120];
  const vertical = [-96, 0, 96],
    horizontal = [-56, -20, 0, 20, 56];
  type Rect = [number, number, number, number]; // minX, minZ, maxX, maxZ
  const roadRects: Rect[] = [];
  const subtract = (a: Rect, b: Rect): Rect[] => {
    const left = Math.max(a[0], b[0]),
      bottom = Math.max(a[1], b[1]);
    const right = Math.min(a[2], b[2]),
      top = Math.min(a[3], b[3]);
    if (left >= right || bottom >= top) return [a];
    return [
      [a[0], a[1], left, a[3]],
      [right, a[1], a[2], a[3]],
      [left, a[1], right, bottom],
      [left, top, right, a[3]],
    ].filter((r) => r[2] - r[0] > 0.0001 && r[3] - r[1] > 0.0001) as Rect[];
  };
  for (let ix = 0; ix < xs.length - 1; ix++)
    for (let iz = 0; iz < zs.length - 1; iz++) {
      const x = (xs[ix] + xs[ix + 1]) / 2,
        z = (zs[iz] + zs[iz + 1]) / 2;
      if (
        !vertical.some((v) => Math.abs(x - v) < 4.01) &&
        !horizontal.some((v) => Math.abs(z - v) < 4.01)
      )
        continue;
      roadRects.push([xs[ix], zs[iz], xs[ix + 1], zs[iz + 1]]);
      const paint = Math.abs(x) < 4.01 ? asphalt[2] : asphalt[x < 0 ? 0 : 1];
      slab(
        "asphalt-cell",
        x,
        z,
        xs[ix + 1] - xs[ix],
        zs[iz + 1] - zs[iz],
        0.12,
        0.08,
        paint,
      );
    }
  const paved: Rect[] = [];
  const pave = (area: Rect, material: Material) => {
    const clipped: Rect = [
      Math.max(-120, area[0]),
      Math.max(-120, area[1]),
      Math.min(120, area[2]),
      Math.min(120, area[3]),
    ];
    if (clipped[0] >= clipped[2] || clipped[1] >= clipped[3]) return;
    let pieces = [clipped];
    // Different sidewalk styles cannot overlap each other or the carriageway.
    for (const mask of [...roadRects, ...paved])
      pieces = pieces.flatMap((piece) => subtract(piece, mask));
    for (const rect of pieces) {
      slab(
        "sidewalk-piece",
        (rect[0] + rect[2]) / 2,
        (rect[1] + rect[3]) / 2,
        rect[2] - rect[0],
        rect[3] - rect[1],
        0.18,
        0.12,
        material,
      );
      paved.push(rect);
    }
  };
  lots.forEach(([x, z, hx, hz], index) =>
    pave(
      [x - hx - 1.5, z - hz - 1.5, x + hx + 1.5, z + hz + 1.5],
      sidewalks[index % 3],
    ),
  );
  const isRoad = (x: number, z: number) =>
    x >= -120 &&
    x <= 120 &&
    z >= -120 &&
    z <= 120 &&
    (vertical.some((v) => Math.abs(x - v) < 4) ||
      horizontal.some((v) => Math.abs(z - v) < 4));
  // Extend footpaths to the building aprons and stop them cleanly at crossings.
  for (const rect of roadRects) {
    const [left, bottom, right, top] = rect,
      x = (left + right) / 2,
      z = (bottom + top) / 2;
    for (const side of [-1, 1]) {
      const edgeZ = side < 0 ? bottom : top;
      if (!isRoad(x, edgeZ + side * 0.01)) {
        pave(
          [
            left,
            side < 0 ? edgeZ - 2 : edgeZ,
            right,
            side < 0 ? edgeZ : edgeZ + 2,
          ],
          sidewalks[x < 0 ? 0 : 1],
        );
        slab(
          "street-edge-curb",
          x,
          edgeZ + side * 0.06,
          right - left,
          0.12,
          0.22,
          0.1,
          curb,
        );
      }
      const edgeX = side < 0 ? left : right;
      if (!isRoad(edgeX + side * 0.01, z)) {
        pave(
          [
            side < 0 ? edgeX - 2 : edgeX,
            bottom,
            side < 0 ? edgeX : edgeX + 2,
            top,
          ],
          sidewalks[edgeX < 0 ? 0 : 1],
        );
        slab(
          "street-edge-curb",
          edgeX + side * 0.06,
          z,
          0.12,
          top - bottom,
          0.22,
          0.1,
          curb,
        );
      }
    }
  }
  for (const x of vertical)
    for (const z of horizontal)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          pave(
            [
              x + (sx < 0 ? -6 : 4),
              z + (sz < 0 ? -6 : 4),
              x + (sx < 0 ? -4 : 6),
              z + (sz < 0 ? -4 : 6),
            ],
            sidewalks[x + sx * 5 < 0 ? 0 : 1],
          );
        }
  // Paint sits above road surfaces; omit dashes through junctions.
  for (let z = -114; z <= 114; z += 12) {
    if (horizontal.some((v) => Math.abs(z - v) < 7)) continue;
    slab("north-south-dash", 0, z, 0.2, 3, 0.142, 0.014, marking);
  }
  for (const z of horizontal)
    for (let x = -114; x <= 114; x += 12) {
      if (vertical.some((v) => Math.abs(x - v) < 7)) continue;
      slab("east-west-dash", x, z, 3, 0.2, 0.142, 0.014, marking);
    }
  for (const side of [-1, 1])
    for (let stripe = 0; stripe < 6; stripe++) {
      slab(
        "crosswalk",
        side * 8.4,
        -3 + stripe * 1.2,
        2.4,
        0.5,
        0.145,
        0.014,
        marking,
      );
      slab(
        "crosswalk",
        -3 + stripe * 1.2,
        side * 8.4,
        0.5,
        2.4,
        0.145,
        0.014,
        marking,
      );
    }
  const buildingRects: GroundRect[] = lots.map(([x,z,hx,hz]) => [x-hx,z-hz,x+hx,z+hz]);
  const landscape = planCityLandscape([...roadRects, ...paved, ...buildingRects, ...extraFootprints]);
  for (const {rect: [left,bottom,right,top],finish} of landscape.patches) {
    const material = finish === "grass" ? lawn : finish === "edge" ? curb : sidewalks[finish === "slate" ? 1 : 2];
    const surface = finish === "grass" ? .145 : finish === "edge" ? .205 : .18;
    slab(`landscape-${finish}`, (left+right)/2, (bottom+top)/2, right-left, top-bottom, surface, .08, material);
  }
  // Four quiet seating spots, at the edges rather than in the flight corridor.
  const benchSeat = scene.getMaterialByName("city-stone")!;
  const benchFrame = scene.getMaterialByName("comic-ink")!;
  for (const {x,z,alongZ} of landscape.benches) {
    const piece = (dx: number,dz: number,w: number,d: number,y: number,h: number,mat: Material) =>
      slab("garden-bench", x+(alongZ?dz:dx), z+(alongZ?dx:dz), alongZ?d:w, alongZ?w:d, y, h, mat);
    for (const side of [-1,1]) piece(side*.9,0,.16,.62,.59,.4,benchFrame);
    for (let i=0;i<3;i++) piece(0,-.23+i*.23,2.5,.18,.69,.12,benchSeat);
    piece(0,.33,2.5,.12,1.12,.28,benchSeat);
    for (const side of [-1,1]) piece(side*1.02,.31,.1,.1,1.12,.5,benchFrame);
  }
  const meshes: Mesh[] = [];
  for (const [material, group] of batches) {
    const merged = Mesh.MergeMeshes(group, true, true);
    if (!merged)
      throw new Error(`Could not merge street material ${material.name}`);
    merged.name = `city-street-batch-${material.name}`;
    merged.isPickable = false;
    merged.receiveShadows = true;
    merged.freezeWorldMatrix();
    meshes.push(merged);
  }
  return { meshes, asphalt, sidewalks, landscape };
}
