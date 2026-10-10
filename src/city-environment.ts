import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  ShaderMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";

// A local, art-directed atmosphere. One opaque sky draw; no ray marching or post-process.
export const HORIZON = new Color3(0.77, 0.86, 0.88);
export const SUN_DIRECTION = new Vector3(0.35, 1, -0.42).normalize();
export function createCitySky(scene: Scene) {
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 95;
  scene.fogEnd = 330;
  scene.fogColor = HORIZON;
  const sky = MeshBuilder.CreateBox("painted-sky", { size: 500 }, scene);
  const material = new ShaderMaterial(
    "painted-atmosphere",
    scene,
    {
      vertexSource: `precision highp float;
      attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 direction;
      void main(){ direction=position; gl_Position=worldViewProjection*vec4(position,1.); }`,
      fragmentSource: `precision highp float;
      varying vec3 direction; uniform float time; uniform vec3 sunDirection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float field(vec2 p){return .57*noise(p)+.28*noise(p*2.03+7.)+.15*noise(p*4.09+19.);}
      void main(){
        vec3 ray=normalize(direction);
        vec3 sky=mix(vec3(.77,.86,.88),vec3(.22,.53,.79),pow(max(ray.y,0.),.55));
        float sunlight=max(dot(ray,sunDirection),0.);
        sky+=vec3(.16,.10,.025)*pow(sunlight,10.);
        sky=mix(sky,vec3(1.,.95,.78),smoothstep(.9990,.9997,sunlight));
        if(ray.y>.035){
          vec2 uv=ray.xz/(ray.y+.2)*2.2+vec2(time*.009,time*.003);
          float cloud=field(uv);
          float density=smoothstep(.51,.67,cloud)*smoothstep(.035,.17,ray.y);
          vec3 puff=mix(vec3(.74,.83,.86),vec3(1.,.98,.91),smoothstep(.48,.72,cloud));
          sky=mix(sky,puff,density*.93);
        }
        gl_FragColor=vec4(sky,1.);
      }`,
    },
    {
      attributes: ["position"],
      uniforms: ["worldViewProjection", "sunDirection", "time"],
    },
  );
  material.backFaceCulling = false;
  material.fogEnabled = false;
  material.setVector3("sunDirection", SUN_DIRECTION);
  sky.material = material;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  let elapsed = 0;
  return (dt: number) => {
    elapsed += dt;
    material.setFloat("time", elapsed);
  };
}

// Closed eight-sided prism. Small chamfers stay inside the immutable collision lot.
export function createBuildingShell(
  name: string,
  halfX: number,
  halfZ: number,
  height: number,
  style: number,
  scene: Scene,
) {
  const bevel = style % 3 === 0 ? 1.4 : style % 3 === 1 ? 0.6 : 0.22;
  const ring = [
    [-halfX + bevel, -halfZ],
    [halfX - bevel, -halfZ],
    [halfX, -halfZ + bevel],
    [halfX, halfZ - bevel],
    [halfX - bevel, halfZ],
    [-halfX + bevel, halfZ],
    [-halfX, halfZ - bevel],
    [-halfX, -halfZ + bevel],
  ];
  const positions: number[] = [],
    indices: number[] = [],
    uvs: number[] = [];
  const face = (points: number[][], coordinates: number[][]) => {
    const base = positions.length / 3;
    points.forEach((p) => positions.push(...p));
    coordinates.forEach((uv) => uvs.push(...uv));
    for (let j = 1; j < points.length - 1; j++)
      indices.push(base, base + j, base + j + 1);
  };
  let perimeter = 0;
  for (let j = 0; j < 8; j++) {
    const a = ring[j],
      b = ring[(j + 1) % 8];
    const next = perimeter + Math.hypot(b[0] - a[0], b[1] - a[1]);
    face(
      [
        [a[0], 0, a[1]],
        [b[0], 0, b[1]],
        [b[0], height, b[1]],
        [a[0], height, a[1]],
      ],
      [
        [perimeter, 0],
        [next, 0],
        [next, height],
        [perimeter, height],
      ],
    );
    perimeter = next;
  }
  face(
    ring.map(([x, z]) => [x, height, z]),
    ring,
  );
  const bottom = [...ring].reverse();
  face(
    bottom.map(([x, z]) => [x, 0, z]),
    bottom,
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
