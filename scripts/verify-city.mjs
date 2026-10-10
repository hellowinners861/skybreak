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
