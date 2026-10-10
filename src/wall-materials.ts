import { Color3, Scene, StandardMaterial, Texture } from "@babylonjs/core";
import brickUrl from "./assets/walls/terracotta-brick.webp";
import tileUrl from "./assets/walls/cobalt-tile.webp";
import plasterUrl from "./assets/walls/cream-plaster.webp";

// Each image covers a fixed distance in metres, independent of building dimensions.
// Mirror wrapping joins the generated edges without a visible color discontinuity.
export function createWallMaterials(scene: Scene) {
  return [
    { name: "terracotta-brick", url: brickUrl, width: 2.4, height: 1.8 },
    { name: "cobalt-tile", url: tileUrl, width: 4, height: 4 },
    { name: "cream-plaster", url: plasterUrl, width: 6, height: 6 },
  ].map(({ name, url, width, height }) => {
    const texture = new Texture(
      url,
      scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = `wall-texture-${name}`;
    texture.uScale = 1 / width;
    texture.vScale = 1 / height;
    texture.wrapU = Texture.MIRROR_ADDRESSMODE;
    texture.wrapV = Texture.MIRROR_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    const material = new StandardMaterial(`wall-${name}`, scene);
    material.diffuseColor = Color3.White();
    material.diffuseTexture = texture;
    material.specularColor = Color3.Black();
    material.maxSimultaneousLights = 2;
    return material;
  });
}
