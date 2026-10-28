import * as THREE from 'three';

/** An intimate, theatre-style snooker arena in the spirit of the Crucible:
 * steeply raked seating wraps tightly around a sunken blue-carpeted stage on
 * all four sides, under a dark ceiling with a lighting gantry and a hanging
 * scoreboard. Original geometry, not a replica. y=0 is the playing surface.
 */
const FLOOR = -.86, STAGE_X = 2.45, STAGE_Z = 3.15, ROWS = 9, ROW_DEPTH = .62, ROW_RISE = .36, SEAT_PITCH = .5;
const AISLE_X = 1.5, AISLE_Z = 1.9;

export function buildCrucibleArena(scene:THREE.Scene) {
  const material = (color:string, roughness = .9, extra:THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({color, roughness, envMapIntensity:.15, ...extra});
  function box(w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material,shadow=true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m);mesh.position.set(x,y,z);mesh.receiveShadow = shadow;mesh.castShadow = shadow;scene.add(mesh);return mesh;
  }
  // Stage: deep blue carpet with a darker border, set below a low black fascia.
  const carpet = document.createElement('canvas');carpet.width = carpet.height = 256;
  const c = carpet.getContext('2d')!;c.fillStyle = '#16264d';c.fillRect(0,0,256,256);
  for(let i = 0;i < 5000;i++){c.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random()*.06})`;c.fillRect(Math.random()*256,Math.random()*256,1.5,1.5);}
  const carpetTexture = new THREE.CanvasTexture(carpet);carpetTexture.colorSpace = THREE.SRGBColorSpace;carpetTexture.wrapS = carpetTexture.wrapT = THREE.RepeatWrapping;carpetTexture.repeat.set(5,6);
  box(STAGE_X*2+.3,.06,STAGE_Z*2+.3,0,FLOOR-.03,0,material('#0d1530',1));
  box(STAGE_X*2-.2,.012,STAGE_Z*2-.2,0,FLOOR+.006,0,material('#ffffff',1,{map:carpetTexture}));
  const fascia = material('#0b0b10',.7);
  for(const s of [-1,1]){box(.08,.42,STAGE_Z*2+.3,s*(STAGE_X+.15),FLOOR+.21,0,fascia);box(STAGE_X*2+.3,.42,.08,0,FLOOR+.21,s*(STAGE_Z+.15),fascia);}

  // Raked tiers on four sides; seat rows are instanced so the full house stays cheap.
  // The house sits in the dark: dim, non-reflective audience materials so only the table glows.
  const house = (color:string) => {const m = material(color,1,{envMapIntensity:.03});m.color.multiplyScalar(.38);return m;};
  const tier = material('#15141b',1), aisle = material('#24222c',1);
  const seat = house('#7a1526'), seatBack = house('#5e0f1d');
  const clothes = ['#14161c','#2a2d36','#3b2a22','#1d2a3f','#4a4b52','#5a1f24','#bdb8ad','#263b2c'].map(house);
  const skin = ['#e2b796','#c89272','#8d5a3c','#f0c8a8','#5a3a28'].map(house);
  const seatGeometry = new THREE.BoxGeometry(SEAT_PITCH*.82,.1,.42), backGeometry = new THREE.BoxGeometry(SEAT_PITCH*.82,.42,.07);
  const bodyGeometry = new THREE.CapsuleGeometry(.13,.3,3,8), headGeometry = new THREE.SphereGeometry(.085,10,8);
  type Place = {x:number;y:number;z:number;fx:number;fz:number};
  const places:Place[] = [];
  let seed = 11;const random = () => (seed = (seed*1664525+1013904223)>>>0)/4294967296;
  for(let row = 0;row < ROWS;row++){
    const inset = .45+row*ROW_DEPTH, y = FLOOR+.28+row*ROW_RISE, top = y+ROW_RISE/2;
    const hx = STAGE_X+inset, hz = STAGE_Z+inset;
    // Each step is a solid riser so the rake reads as one continuous bank.
    for(const s of [-1,1]){
      box(ROW_DEPTH,top-FLOOR,hz*2+ROW_DEPTH,s*(hx+ROW_DEPTH/2),(top+FLOOR)/2,0,tier,false);
      box(hx*2,top-FLOOR,ROW_DEPTH,0,(top+FLOOR)/2,s*(hz+ROW_DEPTH/2),tier,false);
    }
    const side = (from:number,to:number,fixed:number,alongX:boolean,fx:number,fz:number) => {
      for(let a = from+SEAT_PITCH/2;a < to;a += SEAT_PITCH){
        if(Math.abs(Math.abs(a)-(alongX ? AISLE_X : AISLE_Z)) < SEAT_PITCH*.7)continue; // vomitory aisles
        places.push(alongX ? {x:a,y:top,z:fixed,fx,fz} : {x:fixed,y:top,z:a,fx,fz});
      }
    };
    side(-hx,hx,-(hz+ROW_DEPTH*.55),true,0,1);side(-hx,hx,hz+ROW_DEPTH*.55,true,0,-1);
    side(-hz,hz,-(hx+ROW_DEPTH*.55),false,1,0);side(-hz,hz,hx+ROW_DEPTH*.55,false,-1,0);
  }
  // Aisle stair strips down each bank, on the fixed vomitory lines.
  const span = ROWS*ROW_DEPTH, rise = ROWS*ROW_RISE, lean = Math.atan2(rise,span), run = Math.hypot(span,rise), mid = FLOOR+.3+rise/2;
  for(const s of [-1,1])for(const t of [-1,1]){
    box(SEAT_PITCH*.9,.02,run,t*AISLE_X,mid,s*(STAGE_Z+.45+span/2),aisle,false).rotation.x = -s*lean;
    box(run,.02,SEAT_PITCH*.9,s*(STAGE_X+.45+span/2),mid,t*AISLE_Z,aisle,false).rotation.z = s*lean;
  }
  const count = places.length, dummy = new THREE.Object3D();
  const seats = new THREE.InstancedMesh(seatGeometry,seat,count), backs = new THREE.InstancedMesh(backGeometry,seatBack,count);
  const bodies = clothes.map(m => new THREE.InstancedMesh(bodyGeometry,m,count)), heads = skin.map(m => new THREE.InstancedMesh(headGeometry,m,count));
  const used = new Array(clothes.length).fill(0), usedHeads = new Array(skin.length).fill(0);
  places.forEach((p,i) => {
    const {fx,fz} = p, yaw = Math.atan2(fx,fz); // facing the table
    dummy.rotation.set(0,yaw,0);
    dummy.position.set(p.x,p.y+.2,p.z);dummy.updateMatrix();seats.setMatrixAt(i,dummy.matrix);
    dummy.position.set(p.x-fx*.2,p.y+.42,p.z-fz*.2);dummy.updateMatrix();backs.setMatrixAt(i,dummy.matrix);
    if(random() < .06)return; // the odd empty seat
    const lean = (random()-.5)*.14, k = Math.floor(random()*clothes.length), h = Math.floor(random()*skin.length);
    dummy.rotation.set(lean,yaw+(random()-.5)*.3,lean*.5);
    dummy.position.set(p.x-fx*.06,p.y+.47,p.z-fz*.06);dummy.updateMatrix();bodies[k].setMatrixAt(used[k]++,dummy.matrix);
    dummy.position.set(p.x-fx*.03+lean*.1,p.y+.8+random()*.04,p.z-fz*.03);dummy.updateMatrix();heads[h].setMatrixAt(usedHeads[h]++,dummy.matrix);
  });
  bodies.forEach((m,i) => {m.count = used[i];});heads.forEach((m,i) => {m.count = usedHeads[i];});
  seats.receiveShadow = backs.receiveShadow = true;
  scene.add(seats,backs,...bodies,...heads);

  // Theatre shell: black walls and ceiling, with the lighting gantry overhead.
  const outerX = STAGE_X+.45+ROWS*ROW_DEPTH+.3, outerZ = STAGE_Z+.45+ROWS*ROW_DEPTH+.3, wallTop = 5.2;
  const wall = material('#0a090d',1);
  for(const s of [-1,1]){box(.2,wallTop-FLOOR,outerZ*2,s*outerX,(wallTop+FLOOR)/2,0,wall,false);box(outerX*2,wallTop-FLOOR,.2,0,(wallTop+FLOOR)/2,s*outerZ,wall,false);}
  const truss = material('#1b1c22',.5,{metalness:.7});
  for(const s of [-1,1]){box(.08,.08,STAGE_Z*2,s*1.35,3.9,0,truss,false);box(2.78,.08,.08,0,3.9,s*STAGE_Z,truss,false);}
  // Theatre lanterns pointing in at the stage; emissive lenses only, the key light does the work.
  const lens = new THREE.MeshBasicMaterial({color:'#fff1d6'}), can = material('#111114',.6,{metalness:.5});
  for(const s of [-1,1])for(let i = -3;i <= 3;i++){
    const lamp = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,.24,12),can), glow = new THREE.Mesh(new THREE.CircleGeometry(.065,12),lens);
    glow.position.y = -.121;glow.rotation.x = Math.PI/2;lamp.add(body,glow);lamp.position.set(s*1.35,3.75,i*.85);lamp.rotation.z = s*.5;scene.add(lamp);
  }
  // Scoreboard hung above the far bank and a second above the near bank.
  const board = document.createElement('canvas');board.width = 1024;board.height = 256;
  const b = board.getContext('2d')!;b.fillStyle = '#05070c';b.fillRect(0,0,1024,256);b.strokeStyle = '#e5c681';b.lineWidth = 6;b.strokeRect(8,8,1008,240);
  b.fillStyle = '#e5c681';b.font = '500 54px Georgia';b.textAlign = 'center';b.fillText('S N O O K E R   E L O',512,100);
  b.fillStyle = '#9fb3d9';b.font = '400 40px Georgia';b.fillText('WORLD CHAMPIONSHIP · FINAL',512,180);
  const boardMaterial = new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(board)});boardMaterial.map!.colorSpace = THREE.SRGBColorSpace;
  // Only the far board: a near one would hang across the broadcast camera's view.
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2,.8),boardMaterial);face.position.set(0,2.9,-(STAGE_Z+1.4));face.rotation.x = .12;scene.add(face);
  // Fascia sponsor boards ring the stage.
  const signCanvas = document.createElement('canvas');signCanvas.width = 1024;signCanvas.height = 96;
  const ctx = signCanvas.getContext('2d')!;ctx.fillStyle = '#0b0b10';ctx.fillRect(0,0,1024,96);ctx.fillStyle = '#d7dbe6';ctx.font = '500 42px Georgia';ctx.textAlign = 'center';ctx.fillText('SNOOKER ELO   ·   SHEFFIELD',512,62);
  const signMaterial = new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(signCanvas),color:'#9a9aa8'});signMaterial.map!.colorSpace = THREE.SRGBColorSpace;
  for(const s of [-1,1]){
    const front = new THREE.Mesh(new THREE.PlaneGeometry(STAGE_X*1.6,.3),signMaterial);front.position.set(0,FLOOR+.24,s*(STAGE_Z+.1));front.rotation.y = s < 0 ? 0 : Math.PI;scene.add(front);
  }
  // Players' chairs with a small table and water glasses beside each.
  const chair = material('#1a1a1f',.55), wood = material('#3b2418',.5), glass = new THREE.MeshPhysicalMaterial({color:'#dfefff',roughness:.05,transmission:.9,thickness:.02,transparent:true,opacity:.5});
  for(const s of [-1,1]){
    const x = s*1.75, z = s*.9;
    box(.5,.08,.5,x,FLOOR+.45,z,chair);box(.08,.55,.5,x+s*.24,FLOOR+.78,z,chair);
    for(const dx of [-.2,.2])for(const dz of [-.2,.2])box(.03,.45,.03,x+dx,FLOOR+.22,z+dz,chair);
    box(.38,.03,.38,x,FLOOR+.58,z-.55,wood);box(.04,.56,.04,x,FLOOR+.29,z-.55,wood);
    for(const dx of [-.07,.07]){const g = new THREE.Mesh(new THREE.CylinderGeometry(.03,.026,.11,14),glass);g.position.set(x+dx,FLOOR+.65,z-.55);scene.add(g);}
  }
}
