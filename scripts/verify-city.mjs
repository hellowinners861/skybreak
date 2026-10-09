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
      const indices = shell.getIndices();
      assert.ok(
        positions.every(Number.isFinite) && normals.every(Number.isFinite),
      );
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
  console.log(
    "city verification: PASS (9 shells, collision bounds, outward normals, closed surfaces, mixed batches)",
  );
} finally {
  scene.dispose();
  engine.dispose();
}
