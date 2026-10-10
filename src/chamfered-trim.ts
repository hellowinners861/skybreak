import { Mesh, Scene, VertexData } from "@babylonjs/core";

// Closed prism with chamfered corners and beveled top / bottom rims.
export function createChamferedTrim(
  name: string,
  width: number,
  height: number,
  depth: number,
  scene: Scene,
) {
  const bevel = Math.min(0.035, width * 0.16, depth * 0.16, height * 0.16);
  const ring = (inset: number) => {
    const x = width / 2 - inset,
      z = depth / 2 - inset;
    const b = Math.min(bevel, x * 0.4, z * 0.4);
    return [
      [-x + b, -z],
      [x - b, -z],
      [x, -z + b],
      [x, z - b],
      [x - b, z],
      [-x + b, z],
      [-x, z - b],
      [-x, -z + b],
    ];
  };
  const rings = [ring(bevel), ring(0), ring(0), ring(bevel)];
  const ys = [-height / 2, -height / 2 + bevel, height / 2 - bevel, height / 2];
  const positions: number[] = [],
    indices: number[] = [],
    uvs: number[] = [];
  const face = (points: number[][], coordinates: number[][]) => {
    const base = positions.length / 3;
    points.forEach((p) => positions.push(...p));
    coordinates.forEach((uv) => uvs.push(...uv));
    for (let i = 1; i < points.length - 1; i++)
      indices.push(base, base + i, base + i + 1);
  };
  for (let level = 0; level < 3; level++) {
    let perimeter = 0;
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8,
        a = rings[level][i],
        b = rings[level][j],
        c = rings[level + 1][j],
        d = rings[level + 1][i];
      const next = perimeter + Math.hypot(b[0] - a[0], b[1] - a[1]);
      face(
        [
          [a[0], ys[level], a[1]],
          [b[0], ys[level], b[1]],
          [c[0], ys[level + 1], c[1]],
          [d[0], ys[level + 1], d[1]],
        ],
        [
          [perimeter, ys[level]],
          [next, ys[level]],
          [next, ys[level + 1]],
          [perimeter, ys[level + 1]],
        ],
      );
      perimeter = next;
    }
  }
  face(
    rings[3].map(([x, z]) => [x, ys[3], z]),
    rings[3],
  );
  face(
    [...rings[0]].reverse().map(([x, z]) => [x, ys[0], z]),
    [...rings[0]].reverse(),
  );
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}
