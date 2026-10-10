import { Material, Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import { createChamferedTrim } from "./chamfered-trim";
import type { createBuildingFinishes } from "./building-finishes";
import type { CityLot } from "./comic-art";

// Symmetric bays reserve space for corner pilasters; fins sit between the windows.
export function facadeColumns(halfWidth: number, margin: number) {
  const span = halfWidth * 2 - margin * 2;
  const count = Math.max(2, Math.floor(span / 3.5) + 1);
  return Array.from(
    { length: count },
    (_, i) => -halfWidth + margin + (span * i) / (count - 1),
  );
}

export function decorateFacadeColumns(
  scene: Scene,
  [x, z, hx, hz, h]: CityLot,
  index: number,
  finishes: ReturnType<typeof createBuildingFinishes>,
  batch: (mesh: Mesh, material: Material) => void,
) {
  const family = index % 3,
    finish = finishes[family],
    modern = family === 1;
  const piece = (
    name: string,
    width: number,
    height: number,
    depth: number,
    u: number,
    y: number,
    out: number,
    face: number,
    side = false,
    material: Material = finish.trim,
  ) => {
    const mesh =
      name === "fin-channel-back" || name === "fin-bracket"
        ? MeshBuilder.CreateBox(name, { width, height, depth }, scene)
        : createChamferedTrim(name, width, height, depth, scene);
    if (side) {
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set(x + face * (hx + out), y, z + u);
    } else mesh.position.set(x + u, y, z + face * (hz + out));
    mesh.material = material;
    batch(mesh, material);
  };
  for (const face of [-1, 1])
    for (const edge of [-1, 1]) {
      const u = edge * (hx - (modern ? 0.9 : 1.8));
      if (modern) {
        piece(
          "metal-corner-spine",
          0.24,
          h - 3.8,
          0.17,
          u,
          (h + 3.8) / 2,
          0.07,
          face,
          false,
          finish.metal,
        );
        piece(
          "metal-corner-shoe",
          0.34,
          0.25,
          0.24,
          u,
          3.9,
          0.09,
          face,
          false,
          finish.frame,
        );
        piece(
          "metal-corner-cap",
          0.34,
          0.2,
          0.24,
          u,
          h + 0.1,
          0.09,
          face,
          false,
          finish.metal,
        );
      } else {
        piece(
          "pilaster-plinth",
          0.78,
          0.25,
          0.32,
          u,
          0.345,
          0.13,
          face,
          false,
          finish.trim,
        );
        piece(
          "pilaster-base",
          0.63,
          0.32,
          0.27,
          u,
          0.63,
          0.11,
          face,
          false,
          finish.frame,
        );
        const start = 0.82,
          end = h - 0.55;
        // Real joints catch light on the beveled edges rather than painted black lines.
        for (let bottom = start; bottom < end; bottom += 3.8) {
          const top = Math.min(bottom + 3.78, end);
          piece(
            "stone-pilaster-block",
            family === 0 ? 0.5 : 0.54,
            top - bottom,
            0.22,
            u,
            (top + bottom) / 2,
            0.09,
            face,
          );
          if (family === 2)
            piece(
              "plaster-pilaster-step",
              0.32,
              top - bottom - 0.07,
              0.07,
              u,
              (top + bottom) / 2,
              0.23,
              face,
              false,
              finish.frame,
            );
        }
        piece(
          "pilaster-neck",
          0.6,
          0.18,
          0.27,
          u,
          h - 0.42,
          0.11,
          face,
          false,
          finish.frame,
        );
        piece(
          "pilaster-capital",
          0.74,
          0.22,
          0.33,
          u,
          h - 0.2,
          0.13,
          face,
          false,
          finish.trim,
        );
        piece(
          "pilaster-crown",
          0.86,
          0.12,
          0.38,
          u,
          h - 0.03,
          0.15,
          face,
          false,
          finish.frame,
        );
      }
    }
  if (modern)
    for (const side of [false, true]) {
      const columns = facadeColumns(side ? hz : hx, 2.5);
      for (let i = 0; i < columns.length - 1; i++)
        for (const face of [-1, 1]) {
          const u = (columns[i] + columns[i + 1]) / 2;
          const start = 3.9,
            end = h + 0.3;
          piece(
            "fin-channel-back",
            0.18,
            end - start,
            0.075,
            u,
            (start + end) / 2,
            0.045,
            face,
            side,
            finish.frame,
          );
          for (const offset of [-0.063, 0.063])
            piece(
              "fin-beveled-rib",
              0.055,
              end - start,
              0.25,
              u + offset,
              (start + end) / 2,
              0.14,
              face,
              side,
              finish.metal,
            );
          piece(
            "fin-foot-cap",
            0.22,
            0.16,
            0.29,
            u,
            start,
            0.15,
            face,
            side,
            finish.metal,
          );
          piece(
            "fin-roof-cap",
            0.22,
            0.16,
            0.29,
            u,
            end,
            0.15,
            face,
            side,
            finish.metal,
          );
          for (let y = 7.9; y < end - 0.4; y += 4)
            piece(
              "fin-bracket",
              0.21,
              0.09,
              0.27,
              u,
              y,
              0.14,
              face,
              side,
              finish.trim,
            );
        }
    }
}
