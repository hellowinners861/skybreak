import { Material, Mesh, MeshBuilder, Scene, TransformNode, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";

type Point = [number, number, number];
// Height, half width, half depth, forward offset. Profiles are model-space silhouettes.
type Ring = [number, number, number, number?];
type Paints = { ink: Material; blue: Material; cream: Material; red: Material; yellow: Material; glass: Material };

export function characterModels(scene: Scene, paint: Paints) {
  const { ink, blue, cream, red, yellow, glass } = paint;
  function surface(name: string, positions: number[], indices: number[], material: Material, parent: TransformNode, pos: Point = [0, 0, 0], updatable = false) {
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals;
    // Match the vertex layout of Babylon's tubes/rings so rigid pieces can be batched.
    data.uvs = new Array(positions.length / 3 * 2).fill(0);
    const mesh = new Mesh(name, scene); data.applyToMesh(mesh, updatable);
    mesh.parent = parent; mesh.position.set(...pos); mesh.material = material; mesh.isPickable = false;
    return mesh;
  }
  // Closed lofts replace rectangular body pieces. Shared vertices give continuous normals.
  function loft(name: string, rings: Ring[], material: Material, parent: TransformNode, pos: Point = [0, 0, 0], sides = 24) {
    const positions: number[] = [], indices: number[] = [];
    for (const [y, rx, rz, z = 0] of rings) for (let i = 0; i < sides; i++) {
      const angle = i / sides * Math.PI * 2;
      positions.push(Math.cos(angle) * rx, y, z + Math.sin(angle) * rz);
    }
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < sides; i++) {
      const a = j * sides + i, b = j * sides + (i + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
    for (const [j, top] of [[0, false], [rings.length - 1, true]] as const) {
      const center = positions.length / 3; positions.push(0, rings[j][0], rings[j][3] ?? 0);
      for (let i = 0; i < sides; i++) {
        const a = j * sides + i, b = j * sides + (i + 1) % sides;
        if (top) indices.push(center, a, b); else indices.push(center, b, a);
      }
    }
    return surface(name, positions, indices, material, parent, pos);
  }
  function oval(name: string, size: Point, pos: Point, material: Material, parent: TransformNode, sides = 24) {
    const rings: Ring[] = [];
    for (let i = 0; i <= 12; i++) {
      const angle = -.5 * Math.PI + i / 12 * Math.PI;
      rings.push([Math.sin(angle) * size[1] / 2, Math.max(.001, Math.cos(angle) * size[0] / 2), Math.max(.001, Math.cos(angle) * size[2] / 2)]);
    }
    return loft(name, rings, material, parent, pos, sides);
  }
  // A curved face patch follows an ellipsoid instead of sticking a flat box to a head.
  function visor(name: string, radii: Point, pos: Point, parent: TransformNode, material: Material, front: number, start = -.22, end = .3, span = 1.12) {
    const positions: number[] = [], indices: number[] = [], cols = 24, rows = 6;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const theta = -span + i / cols * span * 2, phi = start + j / rows * (end - start);
      positions.push(Math.sin(theta) * Math.cos(phi) * radii[0], Math.sin(phi) * radii[1], front * Math.cos(theta) * Math.cos(phi) * radii[2]);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + cols + 1;
      if (front > 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return surface(name, positions, indices, material, parent, pos);
  }
  function tube(name: string, path: Point[], radius: number, material: Material, parent: TransformNode) {
    const mesh = MeshBuilder.CreateTube(name, { path: path.map(p => new Vector3(...p)), radius, tessellation: 10, cap: Mesh.CAP_ALL }, scene);
    mesh.parent = parent; mesh.material = material; mesh.isPickable = false; return mesh;
  }
  function pivot(name: string, parent: TransformNode, pos: Point) {
    const node = new TransformNode(name, scene); node.parent = parent; node.position.set(...pos); return node;
  }
  // Bake rigid pieces by material *within* a joint. Elbows, knees and cloth stay articulated.
  function batchJoint(node: TransformNode) {
    const groups = new Map<Material, Mesh[]>();
    for (const mesh of node.getChildMeshes(true) as Mesh[]) {
      if (!mesh.material) continue;
      const group = groups.get(mesh.material) ?? []; group.push(mesh); groups.set(mesh.material, group);
    }
    for (const [material, pieces] of groups) {
      if (pieces.length < 2) continue;
      // MergeMeshes applies world transforms; detach the joint while baking local geometry.
      const parent = node.parent, position = node.position.clone(), rotation = node.rotation.clone();
      node.parent = null; node.position.setAll(0); node.rotation.setAll(0); node.computeWorldMatrix(true);
      pieces.forEach(mesh => mesh.computeWorldMatrix(true));
      const mesh = Mesh.MergeMeshes(pieces, true, true);
      if (mesh) { mesh.name = `${node.name}-${material.name}`; mesh.parent = node; mesh.isPickable = false; }
      node.parent = parent; node.position.copyFrom(position); node.rotation.copyFrom(rotation); node.computeWorldMatrix(true);
    }
  }

  function createHero(root: TransformNode) {
    const body = pivot("pilot-body", root, [0, 0, 0]);
    loft("pilot-tailored-jacket", [[-.3,.24,.16],[-.2,.27,.18],[0,.28,.19],[.25,.37,.2],[.42,.39,.18],[.5,.29,.15],[.54,.18,.13]], cream, body);
    loft("pilot-pelvis", [[-.49,.17,.14],[-.37,.29,.18],[-.24,.27,.18]], blue, body);
    loft("pilot-waist-belt", [[-.27,.274,.19],[-.18,.277,.192]], ink, body);
    oval("pilot-belt-clasp", [.13,.1,.05], [0,-.22,.192], yellow, body);
    // Shaped flight pack, inset spine and two wire reels.
    loft("pilot-pack", [[-.13,.18,.065],[0,.24,.095],[.3,.23,.105],[.4,.16,.06]], ink, body, [0,0,-.23]);
    loft("pilot-pack-cover", [[-.06,.16,.04],[.06,.21,.07],[.27,.19,.07],[.34,.12,.04]], blue, body, [0,0,-.31]);
    tube("pilot-pack-spine", [[0,-.02,-.387],[0,.16,-.407],[0,.3,-.37]], .025, yellow, body);
    for (const side of [-1,1]) {
      tube("pilot-harness", [[side*.19,-.17,.19],[side*.21,.12,.202],[side*.26,.39,.165],[side*.24,.48,-.08],[side*.19,.3,-.3]], .035, ink, body);
      oval("pilot-wire-reel", [.17,.24,.2], [side*.3,-.19,0], ink, body);
      oval("pilot-reel-cap", [.05,.13,.14], [side*.39,-.19,0], yellow, body);
    }
    loft("pilot-neck", [[.48,.1,.1],[.68,.095,.095]], ink, body);
    oval("pilot-helmet", [.46,.49,.46], [0,.85,0], cream, body, 32);
    visor("pilot-visor-seal", [.24,.26,.244], [0,.85,0], body, ink, 1, -.26,.3);
    visor("pilot-curved-glass", [.241,.261,.25], [0,.85,0], body, glass, 1, -.12,.23, .99);
    visor("pilot-glass-highlight", [.243,.263,.253], [0,.85,0], body, cream, 1, .14,.19,.76);
    for (const side of [-1,1]) oval("pilot-ear-comms", [.065,.18,.17], [side*.224,.84,-.005], blue, body);
    loft("pilot-scarf-wrap", [[.5,.16,.16],[.54,.2,.18],[.6,.17,.16],[.63,.12,.115]], red, body);
    const cloth = pivot("pilot-scarf-cloth", body, [.04,.58,-.14]);
    const clothMat = red.clone("pilot-cloth-double-sided")!; clothMat.backFaceCulling = false;
    const positions: number[] = [], indices: number[] = [], segments = 18;
    for (let i=0;i<=segments;i++) { positions.push(-.11,0,-i*.075,.11,0,-i*.075); if(i<segments) {const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);} }
    const scarf = surface("pilot-flowing-scarf",positions,indices,clothMat,cloth,[0,0,0],true);
    const normals: number[] = [];
    const limbs: {arm: TransformNode; elbow: TransformNode; leg: TransformNode; knee: TransformNode; side: number}[] = [];
    for (const side of [-1,1]) {
      const arm=pivot(`pilot-shoulder-${side}`,body,[side*.38,.39,0]);
      oval("pilot-sleeve-shoulder",[.29,.34,.3],[side*.018,-.07,0],blue,arm);
      loft("pilot-upper-arm",[[-.38,.093,.09],[-.31,.107,.105],[-.1,.13,.125],[.015,.1,.1]],blue,arm);
      const elbow=pivot(`pilot-elbow-${side}`,arm,[0,-.37,0]);
      oval("pilot-elbow-flex",[.17,.18,.18],[0,0,0],ink,elbow);
      loft("pilot-gauntlet",[[-.33,.076,.086],[-.27,.095,.10],[-.08,.108,.10],[0,.082,.083]],cream,elbow);
      loft("pilot-wrist-cuff",[[-.33,.083,.093],[-.28,.093,.106]],red,elbow);
      oval("pilot-glove",[.16,.21,.19],[0,-.4,.015],ink,elbow);
      oval("pilot-thumb",[.08,.13,.1],[-side*.072,-.375,.072],ink,elbow);
      const leg=pivot(`pilot-hip-${side}`,body,[side*.155,-.37,0]);
      loft("pilot-thigh",[[-.36,.10,.105],[-.26,.125,.13],[-.06,.145,.155],[.07,.12,.13]],blue,leg);
      const knee=pivot(`pilot-knee-${side}`,leg,[0,-.36,0]);
      oval("pilot-knee-pad",[.20,.18,.09],[0,0,.09],cream,knee);
      loft("pilot-calf",[[-.29,.073,.08],[-.16,.092,.102],[-.06,.095,.098],[.025,.089,.09]],blue,knee);
      loft("pilot-boot",[[-.4,.1,.18,.065],[-.36,.12,.2,.066],[-.29,.107,.18,.06],[-.24,.085,.09],[-.17,.086,.085]],ink,knee);
      loft("pilot-sole",[[-.405,.10,.18,.065],[-.383,.115,.195,.065]],cream,knee);
      limbs.push({arm,elbow,leg,knee,side});
      batchJoint(arm);batchJoint(elbow);batchJoint(leg);batchJoint(knee);
    }
    batchJoint(body);
    let phase=0;
    return (dt:number,speed:number,grounded:boolean,attached:boolean,wireLean=0) => {
      phase+=dt*(4+speed*.25);const stride=Math.min(.7,speed*.055);
      const lean=grounded?-.035:attached?Math.max(-.3,Math.min(.3,wireLean*.45)):-.15;
      body.rotation.x+=(lean-body.rotation.x)*(1-Math.exp(-6*dt));
      body.rotation.z=grounded?Math.sin(phase)*stride*.04:attached?0:Math.sin(phase*.45)*.02;
      for(const {arm,elbow,leg,knee,side} of limbs){
        const walk=Math.sin(phase+(side<0?0:Math.PI));
        arm.rotation.x=grounded?walk*stride:(attached?-2.35:-1.0);
        arm.rotation.z=-side*(grounded?.12:.28);
        elbow.rotation.x=grounded?-.22:-.6;
        leg.rotation.x=grounded?-walk*stride:(side<0?.15:-.4);
        knee.rotation.x=grounded?Math.max(0,walk)*stride:attached?.28+(side<0?.08:0):.75+(side<0?.2:0);
      }
      for(let i=0;i<=segments;i++) {
        const t=i/segments,w=.105*(1-t*.48),x=Math.sin(phase*.7-t*5)*t*.16,y=.1*Math.sin(t*4+phase)*t;
        positions[i*6]=x-w;positions[i*6+1]=y;positions[i*6+2]=-t*1.35;
        positions[i*6+3]=x+w;positions[i*6+4]=y+.045*Math.sin(phase+t*6)*t;positions[i*6+5]=-t*1.35+(i===segments?.09:0);
      }
      VertexData.ComputeNormals(positions,indices,normals);
      scarf.updateVerticesData(VertexBuffer.PositionKind,positions,true);
      scarf.updateVerticesData(VertexBuffer.NormalKind,normals);
    };
  }

  function createGiant(root: TransformNode) {
    const body=pivot("sentinel-body",root,[0,0,0]);
    loft("sentinel-pelvis",[[7.8,2.4,1.55],[8.7,3.25,1.9],[9.8,2.9,1.8],[10.3,2.35,1.55]],ink,body);
    loft("sentinel-torso-shell",[[9.3,2.45,1.65],[10.5,2.9,1.9],[12.2,4.1,2.3],[15.5,4.7,2.6],[17.5,4.3,2.3],[18.5,3.2,1.75],[18.9,1.8,1.45]],blue,body, [0,0,0],32);
    // Tapered pectoral plates wrap the central reactor, with an open dark socket.
    for(const side of [-1,1]) {
      const plate=loft("sentinel-pectoral-plate",[[12.7,.6,.19],[13.3,1.05,.42],[15.8,1.45,.55],[17.1,1.15,.43],[17.6,.6,.12]],cream,body,[side*2.25,0,-2.42]);
      plate.rotation.z=-side*.13;
      tube("sentinel-collar-trim",[[side*.9,18.4,-1.5],[side*2,18,-1.85],[side*3.6,17.3,-2.05]],.16,yellow,body);
    }
    for(let i=0;i<3;i++) loft("sentinel-abdominal-lamella",[[10.2+i*.75,2.2-i*.18,.22],[10.35+i*.75,2.5-i*.18,.34],[10.7+i*.75,2.4-i*.18,.3]],cream,body,[0,0,-2.05-i*.1]);
    const reactor=MeshBuilder.CreateTorus("sentinel-reactor-bezel",{diameter:3.45,thickness:.52,tessellation:40},scene);
    reactor.parent=body;reactor.position.set(0,14,-2.98);reactor.rotation.x=Math.PI/2;reactor.material=ink;reactor.isPickable=false;
    const trim=MeshBuilder.CreateTorus("sentinel-reactor-rim",{diameter:3.6,thickness:.13,tessellation:40},scene);
    trim.parent=body;trim.position.set(0,14,-3.2);trim.rotation.x=Math.PI/2;trim.material=yellow;trim.isPickable=false;
    loft("sentinel-neck",[[18,1.2,1.1],[20.1,1.1,.95]],ink,body);
    const head=pivot("sentinel-head",body,[0,21.15,0]);
    loft("sentinel-helmet",[[-1.65,1.45,1.1,-.05],[-1.1,2.05,1.65],[-.2,2.45,1.95],[1.0,2.3,1.85],[1.8,1.7,1.4],[2.15,.75,.7],[2.24,.06,.06]],blue,head,[0,0,0],32);
    visor("sentinel-face-inset",[2.5,2.2,2.02],[0,0,0],head,ink,-1,-.45,.28,1.12);
    visor("sentinel-eye-slit",[2.53,2.23,2.045],[0,0,0],head,red,-1,.02,.095,1.01);
    visor("sentinel-brow-rim",[2.56,2.25,2.08],[0,0,0],head,cream,-1,.23,.35,1.14);
    loft("sentinel-jaw-guard",[[-1.6,1.15,.24],[-1.25,1.5,.4],[-.65,1.45,.34]],cream,head,[0,0,-1.47]);
    tube("sentinel-helmet-ridge",[[0,2.06,1.1],[0,2.3,.5],[0,2.3,-.4],[0,1.9,-1.4]],.22,red,head);
    const arms: {shoulder:TransformNode;elbow:TransformNode;side:number}[]=[];
    for(const side of [-1,1]) {
      oval("sentinel-hip-joint",[2.6,2.6,2.7],[side*2.05,8.5,0],ink,body);
      loft("sentinel-thigh-armor",[[4.8,1.04,1.08],[5.5,1.45,1.48],[7.6,1.47,1.4],[8.4,1.05,1.06]],blue,body,[side*2.25,0,0]);
      oval("sentinel-knee-joint",[2.2,2.1,2.1],[side*2.3,4.9,0],ink,body);
      loft("sentinel-knee-shield",[[4.05,.65,.15],[4.4,1.1,.42],[5.3,1.12,.47],[5.8,.68,.22]],cream,body,[side*2.3,0,-1.03]);
      loft("sentinel-greave",[[1.05,1.03,1.15],[1.6,1.16,1.25],[3.3,1.37,1.4],[4.35,1.14,1.18]],blue,body,[side*2.3,0,0]);
      tube("sentinel-shin-ridge",[[side*2.3,1.5,-1.23],[side*2.3,3.2,-1.43],[side*2.3,4,-1.25]],.12,cream,body);
      loft("sentinel-foot",[[.02,1.24,2,-.7],[.28,1.62,2.4,-.8],[.8,1.6,2.4,-.8],[1.3,1.2,1.95,-.45],[1.75,1.02,1.2]],ink,body,[side*2.3,0,0]);
      loft("sentinel-boot-toe",[[.6,1.36,.7],[1.0,1.45,.85],[1.25,1.05,.5]],cream,body,[side*2.3,0,-2.2]);
      const shoulder=pivot(`sentinel-shoulder-${side}`,body,[side*5.3,16.5,0]);
      oval("sentinel-shoulder-bearing",[3,3.2,3.1],[0,0,0],ink,shoulder);
      const pauldron=loft("sentinel-domed-pauldron",[[-.8,1.8,1.55],[-.15,2.2,2.02],[.8,2.2,2.1],[1.65,1.8,1.7],[2.1,1.1,1.05],[2.28,.25,.3]],cream,shoulder,[side*1.1,.1,0]);pauldron.rotation.z=-side*.22;
      const band=loft("sentinel-pauldron-band",[[-.92,1.85,1.63],[-.65,1.98,1.76]],blue,shoulder,[side*1.1,.1,0]);band.rotation.z=pauldron.rotation.z;
      loft("sentinel-upper-arm",[[-4.6,1.0,1.1],[-3.5,1.22,1.28],[-1.3,1.35,1.4],[-.5,1.0,1.03]],blue,shoulder,[side*1.2,0,0]);
      const elbow=pivot(`sentinel-elbow-${side}`,shoulder,[side*1.2,-4.5,0]);
      oval("sentinel-elbow-bearing",[2.3,2.1,2.3],[0,0,0],ink,elbow);
      loft("sentinel-forearm",[[-4.1,.92,1.0],[-3.6,1.42,1.4],[-1.3,1.75,1.63],[-.55,1.4,1.25],[0,.9,.92]],blue,elbow);
      loft("sentinel-forearm-cuff",[[-3.85,1.3,1.37],[-3.45,1.62,1.63]],red,elbow);
      oval("sentinel-palm",[2.55,2.15,2.1],[0,-4.65,-.12],ink,elbow);
      for(let finger=0;finger<4;finger++) oval("sentinel-knuckle",[.55,.85,.65],[(finger-1.5)*.56,-4.84,-1.02],cream,elbow,16);
      oval("sentinel-thumb",[.85,1.6,1.0],[-side*1.15,-4.2,-.45],ink,elbow);
      arms.push({shoulder,elbow,side});batchJoint(shoulder);batchJoint(elbow);
    }
    batchJoint(head);batchJoint(body);
    return (time:number,hp:number,flash:number) => {
      // Visual secondary motion; gameplay hooks and reactor stay in their original positions.
      head.rotation.y=hp>0?Math.sin(time*.45)*.055:.15;
      head.rotation.x=hp>0?(flash>0?-.08:0):.2;
      for(const {shoulder,elbow,side} of arms){
        shoulder.rotation.z=-side*(.035+Math.sin(time*.8)*.014);
        elbow.rotation.x=hp>0?-.12+Math.sin(time*.65+side)*.025:.15;
      }
    };
  }
  return {createHero,createGiant};
}
