import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, VertexData, type Scene } from '@babylonjs/core';
export function createJet(scene: Scene) {
  const root=new TransformNode('fighter-jet',scene),groups=new Map<StandardMaterial,Mesh[]>();
  const paint=(name:string,color:string)=>{const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor=Color3.Black();return m;};
  const blue=paint('jet-cobalt','#416e8b'),ink=paint('jet-ink','#243546'),cream=paint('jet-cream','#e9dfc3'),yellow=paint('jet-yellow','#ffd34a');
  const add=(mesh:Mesh,m:StandardMaterial)=>{mesh.material=m;mesh.isPickable=false;const group=groups.get(m)??[];group.push(mesh);groups.set(m,group);return mesh;};
  const box=(name:string,x:number,y:number,z:number,w:number,h:number,d:number,m:StandardMaterial)=>{const mesh=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);mesh.position.set(x,y,z);return add(mesh,m);};
  const prism=(name:string,points:[number,number][],y:number,h:number,m:StandardMaterial)=>{
    const mesh=new Mesh(name,scene),positions:number[]=[],indices:number[]=[];
    for(const dy of [-h/2,h/2])for(const [x,z]of points)positions.push(x,y+dy,z);
    const n=points.length;
    for(let i=1;i<n-1;i++){indices.push(0,i+1,i,n,n+i,n+i+1);}
    for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,n+j,i,n+j,n+i);}
    const data=new VertexData();data.positions=positions;data.indices=indices;const normals:number[]=[];VertexData.ComputeNormals(positions,indices,normals);data.normals=normals;data.uvs=Array(positions.length/3*2).fill(0);data.applyToMesh(mesh);m.backFaceCulling=false;return add(mesh,m);
  };
  const fuselage=MeshBuilder.CreateCylinder('jet-fuselage',{height:11,diameterTop:.85,diameterBottom:1.8,tessellation:8},scene);fuselage.rotation.x=Math.PI/2;add(fuselage,blue);
  const nose=MeshBuilder.CreateCylinder('jet-nose',{height:3,diameterTop:0,diameterBottom:.85,tessellation:8},scene);nose.rotation.x=Math.PI/2;nose.position.z=7;add(nose,cream);
  const cockpit=MeshBuilder.CreateSphere('jet-canopy',{diameter:1.65,segments:8},scene);cockpit.position.set(0,.85,2.2);cockpit.scaling.set(1,.65,1.9);add(cockpit,ink);
  for(const side of [-1,1]) {
    prism('jet-swept-wing',[[side*.6,2],[side*8,-2.2],[side*7.7,-3.7],[side*.8,-2.8]],0,.18,blue);
    prism('jet-wing-tip',[[side*7,-1.64],[side*8,-2.2],[side*7.7,-3.7],[side*6.7,-3.57]],.11,.04,yellow);
    prism('jet-tailplane',[[side*.4,-3.2],[side*3.4,-5.2],[side*3.1,-6.2],[side*.4,-5.5]],.25,.15,cream);
    const exhaust=MeshBuilder.CreateCylinder('jet-exhaust',{height:1,diameter:1.05,tessellation:8},scene);exhaust.rotation.x=Math.PI/2;exhaust.position.set(side*.55,-.1,-5.7);add(exhaust,ink);
  }
  const fin=box('jet-tail-fin',0,1.6,-4.6,.15,2.6,2.4,blue);fin.rotation.x=-.25;
  box('jet-fin-stripe',0,2.4,-4.8,.18,.35,2,yellow);
  box('jet-belly-hook',0,-1.2,0,.22,1.8,.22,ink);
  // Four shared-material batches follow one transform; no dynamic shadow map.
  for(const [material,meshes]of groups){const mesh=Mesh.MergeMeshes(meshes,true,true)!;mesh.name=`fighter-${material.name}`;mesh.material=material;mesh.parent=root;mesh.isPickable=false;}
  return root;
}
