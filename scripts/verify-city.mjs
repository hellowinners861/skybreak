import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Mesh,
  MeshBuilder,
  NullEngine,
  Scene,
  VertexBuffer,
} from "@babylonjs/core";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".artifacts", "city-check");
const require = createRequire(import.meta.url);
mkdirSync(output, { recursive: true });
execFileSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    resolve(root, "src/city-environment.ts"),
    resolve(root, "src/chamfered-trim.ts"),
    resolve(root, "src/city-landscape-plan.ts"),
    "--target",
    "ES2020",
    "--module",
    "ES2020",
    "--moduleResolution",
    "Bundler",
    "--outDir",
    output,
    "--skipLibCheck",
    "--pretty",
    "false",
  ],
  { cwd: root, stdio: "inherit" },
);
const { createBuildingShell } = await import(
  pathToFileURL(resolve(output, "city-environment.js")).href
);
const { createChamferedTrim } = await import(
  pathToFileURL(resolve(output, "chamfered-trim.js")).href
);
const { planCityLandscape, subtractGround, GROUND_BOUNDS } = await import(
  pathToFileURL(resolve(output, "city-landscape-plan.js")).href
);
// Independent area accounting catches holes and double-covered parcels, even
// when exclusions overlap or cross the city boundary.
const area = r => (r[2]-r[0])*(r[3]-r[1]);
const overlap = (a,b) => Math.min(a[2],b[2])-Math.max(a[0],b[0])>1e-7 && Math.min(a[3],b[3])-Math.max(a[1],b[1])>1e-7;
for (const occupied of [[], [[-4,-120,4,120],[-120,-4,120,4]], [[-22,-96,22,-80],[-4,-120,4,120],[-28,-41,-24,-35],[24,-65,28,-59],[-130,50,-85,130]]]) {
  const {patches,benches}=planCityLandscape(occupied);
  for(let i=0;i<patches.length;i++) {
    const r=patches[i].rect;
    assert.ok(r.every(Number.isFinite) && area(r)>0,"valid parcel");
    assert.ok(r[0]>=-120 && r[1]>=-120 && r[2]<=120 && r[3]<=120,"inside city");
    assert.ok(occupied.every(o=>!overlap(r,o)),"no paving or lawn inside reserved areas");
    for(let j=0;j<i;j++) assert.ok(!overlap(r,patches[j].rect),"no coplanar overlaps");
  }
  const xs=[...new Set([-120,120,...occupied.flatMap(r=>[r[0],r[2]]).map(x=>Math.max(-120,Math.min(120,x)))])].sort((a,b)=>a-b);
  const zs=[...new Set([-120,120,...occupied.flatMap(r=>[r[1],r[3]]).map(z=>Math.max(-120,Math.min(120,z)))])].sort((a,b)=>a-b);
  let free=0;
  for(let i=0;i<xs.length-1;i++)for(let j=0;j<zs.length-1;j++) {
    const x=(xs[i]+xs[i+1])/2,z=(zs[j]+zs[j+1])/2;
    if(!occupied.some(r=>x>r[0]&&x<r[2]&&z>r[1]&&z<r[3])) free+=(xs[i+1]-xs[i])*(zs[j+1]-zs[j]);
  }
  assert.ok(Math.abs(patches.reduce((sum,p)=>sum+area(p.rect),0)-free)<1e-5,"all uncovered land has a finish");
  assert.equal(benches.length,4,"bounded furnishing count");
}
assert.deepEqual(subtractGround(GROUND_BOUNDS,GROUND_BOUNDS),[],"fully covered parcel disappears");
console.log("landscape verification: PASS (coverage, reserved footprints, overlaps, bounds, overlapping exclusions)");
const engine = new NullEngine();
const scene = new Scene(engine);
try {
  for (const [halfX, halfZ, height] of [
    [2, 3, 52],
    [9, 8, 14],
    [13, 12, 28],
  ]) {
    for (let style = 0; style < 3; style++) {
      const shell = createBuildingShell(
        "fixture",
        halfX,
        halfZ,
        height,
        style,
        scene,
      );
      const positions = shell.getVerticesData(VertexBuffer.PositionKind);
      const normals = shell.getVerticesData(VertexBuffer.NormalKind);
      const uvs = shell.getVerticesData(VertexBuffer.UVKind);
      const indices = shell.getIndices();
      assert.ok(
        positions.every(Number.isFinite) && normals.every(Number.isFinite),
      );
      assert.equal(uvs.length, (positions.length / 3) * 2);
      assert.ok(uvs.every(Number.isFinite), "finite texture coordinates");
      for (let face = 0; face < 8; face++) {
        const vertex = face * 4;
        const a = positions.slice(vertex * 3, vertex * 3 + 3);
        const b = positions.slice((vertex + 1) * 3, (vertex + 1) * 3 + 3);
        const edgeLength = Math.hypot(b[0] - a[0], b[2] - a[2]);
        assert.ok(
          Math.abs(uvs[(vertex + 1) * 2] - uvs[vertex * 2] - edgeLength) < 1e-4,
          "horizontal texel density follows physical distance",
        );
        assert.equal(
          uvs[(vertex + 2) * 2 + 1] - uvs[vertex * 2 + 1],
          height,
          "vertical texel density follows physical height",
        );
        if (face > 0)
          assert.equal(
            uvs[vertex * 2],
            uvs[(vertex - 3) * 2],
            "UVs continue across adjacent corners",
          );
      }
      for (let i = 0; i < positions.length; i += 3) {
        const [x, y, z] = positions.slice(i, i + 3);
        const [nx, ny, nz] = normals.slice(i, i + 3);
        assert.ok(
          Math.abs(x) <= halfX && y >= 0 && y <= height && Math.abs(z) <= halfZ,
          "shell stays inside collision lot",
        );
        assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-5, "unit normals");
        assert.ok(
          x * nx + (y - height / 2) * ny + z * nz > 0,
          "outward normals",
        );
      }
      const edges = new Map();
      const pointKey = (index) =>
        positions.slice(index * 3, index * 3 + 3).join(",");
      for (let i = 0; i < indices.length; i += 3) {
        const corners = indices.slice(i, i + 3).map(pointKey);
        assert.equal(new Set(corners).size, 3, "nondegenerate triangle");
        for (let edge = 0; edge < 3; edge++) {
          const key = [corners[edge], corners[(edge + 1) % 3]].sort().join("|");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      assert.ok(
        [...edges.values()].every((count) => count === 2),
        "closed manifold shell",
      );
      const batch = Mesh.MergeMeshes(
        [shell, MeshBuilder.CreateBox("legacy-box", {}, scene)],
        true,
        true,
      );
      assert.ok(batch, "new shell batches with existing Babylon primitives");
      batch.dispose();
    }
  }
  for (const [width, height, depth] of [
    [0.5, 3.78, 0.22],
    [0.055, 15, 0.25],
    [0.86, 0.12, 0.38],
    [0.32, 0.16, 0.07],
  ]) {
    const trim = createChamferedTrim(
      "trim-fixture",
      width,
      height,
      depth,
      scene,
    );
    const p = trim.getVerticesData(VertexBuffer.PositionKind),
      n = trim.getVerticesData(VertexBuffer.NormalKind),
      uv = trim.getVerticesData(VertexBuffer.UVKind),
      triangles = trim.getIndices();
    assert.ok(
      [...p, ...n, ...uv].every(Number.isFinite),
      "finite trim attributes",
    );
    const edges = new Map();
    const key = (i) => p.slice(i * 3, i * 3 + 3).join(",");
    for (let i = 0; i < p.length; i += 3) {
      assert.ok(
        Math.abs(p[i]) <= width / 2 + 1e-6 &&
          Math.abs(p[i + 1]) <= height / 2 + 1e-6 &&
          Math.abs(p[i + 2]) <= depth / 2 + 1e-6,
        "trim bounds",
      );
      assert.ok(
        Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-5,
        "unit trim normal",
      );
      assert.ok(
        p[i] * n[i] + p[i + 1] * n[i + 1] + p[i + 2] * n[i + 2] > 0,
        "outward trim normal",
      );
    }
    for (let i = 0; i < triangles.length; i += 3) {
      const keys = triangles.slice(i, i + 3).map(key);
      assert.equal(new Set(keys).size, 3, "nondegenerate trim triangle");
      for (let j = 0; j < 3; j++) {
        const edge = [keys[j], keys[(j + 1) % 3]].sort().join("|");
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    assert.ok(
      [...edges.values()].every((count) => count === 2),
      "closed trim surface",
    );
    assert.ok(
      Mesh.MergeMeshes(
        [trim, MeshBuilder.CreateBox("trim-box", {}, scene)],
        true,
        true,
      ),
      "trim batches with boxes",
    );
  }
  console.log(
    "city verification: PASS (9 shells, collision bounds, outward normals, closed surfaces, metre-scaled UVs, mixed batches, 4 chamfered trim shapes)",
  );
} finally {
  scene.dispose();
  engine.dispose();
}
