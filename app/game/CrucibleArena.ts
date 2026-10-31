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
    // Build varies from seat to seat so the bank doesn't read as a cloned row.
    const broad = .88+random()*.26, tall = .92+random()*.16;
    dummy.rotation.set(lean,yaw+(random()-.5)*.3,lean*.5);dummy.scale.set(broad,tall,broad);
    dummy.position.set(p.x-fx*.06,p.y+.47*tall,p.z-fz*.06);dummy.updateMatrix();bodies[k].setMatrixAt(used[k]++,dummy.matrix);
    dummy.scale.setScalar(.94+random()*.12);
    dummy.position.set(p.x-fx*.03+lean*.1,p.y+.8*tall+random()*.04,p.z-fz*.03);dummy.updateMatrix();heads[h].setMatrixAt(usedHeads[h]++,dummy.matrix);
    dummy.scale.setScalar(1);
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
  // Final-night scoreboard hung above the far bank: event, round and match format.
  const board = document.createElement('canvas');board.width = 1024;board.height = 320;
  const b = board.getContext('2d')!;
  const boardGradient = b.createLinearGradient(0,0,0,320);boardGradient.addColorStop(0,'#0b1430');boardGradient.addColorStop(1,'#04070f');
  b.fillStyle = boardGradient;b.fillRect(0,0,1024,320);b.strokeStyle = '#e5c681';b.lineWidth = 6;b.strokeRect(10,10,1004,300);
  b.lineWidth = 2;b.strokeRect(22,22,980,276);b.textAlign = 'center';
  b.fillStyle = '#9fb3d9';b.font = '500 34px Georgia';b.fillText('W O R L D   S N O O K E R   C H A M P I O N S H I P',512,84);
  b.fillStyle = '#f2d790';b.font = '600 104px Georgia';b.fillText('THE FINAL',512,196);
  b.fillStyle = '#c9d2e6';b.font = '400 32px Georgia';b.fillText('BEST OF 35 FRAMES  ·  SHEFFIELD',512,262);
  const boardMaterial = new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(board),color:'#d8d8d8'});boardMaterial.map!.colorSpace = THREE.SRGBColorSpace;
  // Only the far board: a near one would hang across the broadcast camera's view.
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2,1),boardMaterial);face.position.set(0,2.95,-(STAGE_Z+1.4));face.rotation.x = .12;scene.add(face);
  box(3.32,1.1,.06,0,2.95,-(STAGE_Z+1.44),material('#0a0a0e',.6),false).rotation.x = .12;
  for(const s of [-1,1])box(.025,5.2-3.5,.025,s*1.4,3.5+(5.2-3.5)/2,-(STAGE_Z+1.47),truss,false);

  // Fascia sponsor boards ring the stage.
  const signCanvas = document.createElement('canvas');signCanvas.width = 1024;signCanvas.height = 96;
  const ctx = signCanvas.getContext('2d')!;ctx.fillStyle = '#0b0b10';ctx.fillRect(0,0,1024,96);ctx.fillStyle = '#d7dbe6';ctx.font = '500 42px Georgia';ctx.textAlign = 'center';ctx.fillText('WORLD CHAMPIONSHIP   ·   THE FINAL   ·   SHEFFIELD',512,62);
  const signMaterial = new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(signCanvas),color:'#9a9aa8'});signMaterial.map!.colorSpace = THREE.SRGBColorSpace;
  for(const s of [-1,1]){
    const front = new THREE.Mesh(new THREE.PlaneGeometry(STAGE_X*1.6,.3),signMaterial);front.position.set(0,FLOOR+.24,s*(STAGE_Z+.1));front.rotation.y = s < 0 ? 0 : Math.PI;scene.add(front);
    const flank = new THREE.Mesh(new THREE.PlaneGeometry(STAGE_Z*1.4,.3),signMaterial);flank.position.set(s*(STAGE_X+.1),FLOOR+.24,0);flank.rotation.y = -s*Math.PI/2;scene.add(flank);
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

  buildMatchOfficials(scene,material);
  buildFinalNightDetails(scene,material,box,outerX,outerZ);
}

type MaterialFactory = (color:string, roughness?:number, extra?:THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type BoxFactory = (w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material,shadow?:boolean) => THREE.Mesh;

/** A simple standing or seated figure built from capsules; origin at the floor between the feet. */
function figure(material:MaterialFactory, {suit,shirt,skin,hair,gloves,seated = false}:{suit:string;shirt:string;skin:string;hair:string;gloves?:string;seated?:boolean}) {
  const root = new THREE.Group(), suitMaterial = material(suit,.7), shirtMaterial = material(shirt,.8), skinMaterial = material(skin,.75);
  const part = (geometry:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,rx = 0,rz = 0) => {
    const mesh = new THREE.Mesh(geometry,m);mesh.position.set(x,y,z);mesh.rotation.set(rx,0,rz);mesh.castShadow = true;root.add(mesh);return mesh;
  };
  const hip = seated ? .46 : .9;
  for(const s of [-1,1]){
    if(seated){
      part(new THREE.CapsuleGeometry(.065,.36,4,8),suitMaterial,s*.1,hip,.2,Math.PI/2);
      part(new THREE.CapsuleGeometry(.06,.36,4,8),suitMaterial,s*.1,hip/2,.4);
    }else part(new THREE.CapsuleGeometry(.068,.72,4,8),suitMaterial,s*.1,hip/2,0);
    part(new THREE.BoxGeometry(.1,.06,.24),material('#060608',.3),s*.1,.03,seated ? .44 : .04);
  }
  part(new THREE.CapsuleGeometry(.17,.42,4,10),suitMaterial,0,hip+.33,0).scale.set(1,1,.72);
  // Shirt front and bow tie under the waistcoat.
  part(new THREE.PlaneGeometry(.12,.32),shirtMaterial,0,hip+.48,.125);
  part(new THREE.BoxGeometry(.09,.035,.02),material('#08080a',.5),0,hip+.66,.13);
  const arm = new THREE.CapsuleGeometry(.05,.44,4,8);
  for(const s of [-1,1]){
    part(arm,shirtMaterial,s*.22,hip+.36,seated ? .1 : .02,seated ? -.9 : -.15,s*.08);
    part(new THREE.SphereGeometry(.05,10,8),gloves ? material(gloves,.8) : skinMaterial,s*.235,hip+(seated ? .25 : .08),seated ? .32 : .08);
  }
  part(new THREE.CylinderGeometry(.05,.055,.08,10),skinMaterial,0,hip+.72,0);
  part(new THREE.SphereGeometry(.105,16,12),skinMaterial,0,hip+.86,0).scale.set(.92,1.08,1);
  part(new THREE.SphereGeometry(.108,16,12,0,Math.PI*2,0,Math.PI*.5),material(hair,.9),0,hip+.89,-.01);
  root.scale.setScalar(.9);
  return root;
}

/** The referee standing off the corner of the table, and the marker at a desk on the far side. */
function buildMatchOfficials(scene:THREE.Scene, material:MaterialFactory) {
  const referee = figure(material,{suit:'#101015',shirt:'#c9ccd2',skin:'#d9a989',hair:'#3a2a20',gloves:'#d6d6d6'});
  referee.position.set(-1.25,FLOOR,-2.55);referee.rotation.y = .35;scene.add(referee);
  const marker = figure(material,{suit:'#16161c',shirt:'#c4c7cd',skin:'#c99474',hair:'#1c1612',seated:true});
  marker.position.set(2.05,FLOOR,-2.75);marker.rotation.y = -Math.PI*.78;scene.add(marker);
  const desk = material('#0b0b10',.6);
  const top = new THREE.Mesh(new THREE.BoxGeometry(.6,.04,.4),desk);top.position.set(1.83,FLOOR+.72,-2.5);top.rotation.y = marker.rotation.y;scene.add(top);
  const front = new THREE.Mesh(new THREE.BoxGeometry(.6,.7,.03),desk);front.position.set(1.76,FLOOR+.36,-2.43);front.rotation.y = marker.rotation.y;scene.add(front);
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.44,16),desk);stool.position.set(2.08,FLOOR+.22,-2.78);scene.add(stool);
}

/** Broadcast cameras, the trophy, aisle lighting, exit signs, balcony rail and a commentary box. */
function buildFinalNightDetails(scene:THREE.Scene, material:MaterialFactory, box:BoxFactory, outerX:number, outerZ:number) {
  // Pedestal TV cameras with their operators at the far corner and on the side, pointed at the table.
  const camBody = material('#1c1d22',.45,{metalness:.4}), camDark = material('#0a0a0d',.6), lensGlass = material('#0c1830',.1,{metalness:.8});
  for(const [x,z] of [[-2.1,-2.85],[2.2,-.55]]){
    const rig = new THREE.Group(), yaw = Math.atan2(-x,-z);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,1.1,10),camDark);column.position.y = .55;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.28,.3,.08,16),camDark);base.position.y = .04;
    const head = new THREE.Mesh(new THREE.BoxGeometry(.2,.24,.5),camBody);head.position.set(0,1.24,.05);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(.075,.085,.28,16),lensGlass);lens.rotation.x = Math.PI/2;lens.position.set(0,1.22,.42);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(.2,.16,.12),camDark);hood.position.set(0,1.22,.6);
    const viewfinder = new THREE.Mesh(new THREE.BoxGeometry(.16,.12,.1),camDark);viewfinder.position.set(.14,1.36,-.18);
    const tally = new THREE.Mesh(new THREE.BoxGeometry(.03,.02,.02),new THREE.MeshBasicMaterial({color:'#ff2a1f'}));tally.position.set(0,1.38,.18);
    for(const m of [column,base,head,lens,hood,viewfinder])m.castShadow = true;
    rig.add(column,base,head,lens,hood,viewfinder,tally);
    const operator = figure(material,{suit:'#121216',shirt:'#1a1a20',skin:'#c99474',hair:'#20180f'});operator.position.set(.12,0,-.52);rig.add(operator);
    rig.position.set(x,FLOOR,z);rig.rotation.y = yaw;scene.add(rig);
  }
  // The trophy on a draped plinth by the near corner of the stage.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.22,.24,.95,24),material('#0a1024',.95));plinth.position.set(-2.12,FLOOR+.475,2.3);plinth.castShadow = true;scene.add(plinth);
  const silver = new THREE.MeshStandardMaterial({color:'#e6e8ee',metalness:1,roughness:.16,envMapIntensity:1.4});
  const profile = [[0,0],[.1,0],[.1,.03],[.06,.05],[.035,.11],[.03,.2],[.05,.24],[.11,.31],[.13,.4],[.12,.47],[.13,.49],[0,.49]].map(([x,y]) => new THREE.Vector2(x,y));
  const trophy = new THREE.Group(), cup = new THREE.Mesh(new THREE.LatheGeometry(profile,40),silver);cup.castShadow = true;trophy.add(cup);
  for(const s of [-1,1]){const handle = new THREE.Mesh(new THREE.TorusGeometry(.065,.012,8,20,Math.PI),silver);handle.position.set(s*.13,.37,0);handle.rotation.z = -s*Math.PI/2;trophy.add(handle);}
  const lid = new THREE.Mesh(new THREE.SphereGeometry(.12,24,10,0,Math.PI*2,0,Math.PI*.42),silver);lid.position.y = .43;trophy.add(lid);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(.03,12,10),silver);finial.position.y = .57;trophy.add(finial);
  trophy.position.set(-2.12,FLOOR+.95,2.3);scene.add(trophy);
  const trophyLight = new THREE.SpotLight('#fff3dc',3,3,.25,.6,2);trophyLight.position.set(-2.12,FLOOR+3,2.3);trophyLight.target = trophy;scene.add(trophyLight);

  // Warm step lights on each aisle, so the stairs read in the dark house.
  const stepLight = new THREE.MeshBasicMaterial({color:'#7a5a2a'}), stepGeometry = new THREE.BoxGeometry(.05,.025,.025);
  const steps = new THREE.InstancedMesh(stepGeometry,stepLight,ROWS*16), dummy = new THREE.Object3D();let n = 0;
  for(let row = 0;row < ROWS;row++){
    const inset = .45+row*ROW_DEPTH, y = FLOOR+.3+row*ROW_RISE, hx = STAGE_X+inset, hz = STAGE_Z+inset;
    for(const s of [-1,1])for(const t of [-1,1])for(const e of [-1,1]){
      dummy.rotation.set(0,0,0);dummy.position.set(t*AISLE_X+e*SEAT_PITCH*.4,y,s*(hz+.02));dummy.updateMatrix();steps.setMatrixAt(n++,dummy.matrix);
      dummy.rotation.set(0,Math.PI/2,0);dummy.position.set(s*(hx+.02),y,t*AISLE_Z+e*SEAT_PITCH*.4);dummy.updateMatrix();steps.setMatrixAt(n++,dummy.matrix);
    }
  }
  steps.count = n;scene.add(steps);

  // Green exit signs over the vomitories at the back of each bank.
  const exitCanvas = document.createElement('canvas');exitCanvas.width = 128;exitCanvas.height = 48;
  const e = exitCanvas.getContext('2d')!;e.fillStyle = '#0d7a3a';e.fillRect(0,0,128,48);e.fillStyle = '#e9fff0';e.font = '700 30px sans-serif';e.textAlign = 'center';e.fillText('EXIT',64,35);
  const exitMaterial = new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(exitCanvas),color:'#9fbfa8'});exitMaterial.map!.colorSpace = THREE.SRGBColorSpace;
  const top = FLOOR+.3+ROWS*ROW_RISE+1.2;
  for(const s of [-1,1])for(const t of [-1,1]){
    const a = new THREE.Mesh(new THREE.PlaneGeometry(.36,.135),exitMaterial);a.position.set(t*AISLE_X,top,s*(outerZ-.11));a.rotation.y = s < 0 ? 0 : Math.PI;scene.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(.36,.135),exitMaterial);b.position.set(s*(outerX-.11),top,t*AISLE_Z);b.rotation.y = -s*Math.PI/2;scene.add(b);
  }
  // Brass balcony rail along the back of the top row.
  const rail = material('#6b5532',.35,{metalness:.8}), railY = FLOOR+.3+ROWS*ROW_RISE+.75, backX = outerX-.25, backZ = outerZ-.25;
  for(const s of [-1,1]){box(.03,.03,backZ*2,s*backX,railY,0,rail,false);box(backX*2,.03,.03,0,railY,s*backZ,rail,false);}
  // Lit commentary box set into the right-hand wall, high above the bank.
  const glow = new THREE.MeshBasicMaterial({color:'#3a3428'});
  const booth = new THREE.Mesh(new THREE.PlaneGeometry(1.8,.55),glow);booth.position.set(outerX-.11,top+.2,0);booth.rotation.y = -Math.PI/2;scene.add(booth);
  const silhouette = new THREE.MeshBasicMaterial({color:'#0c0b0a'});
  for(const z of [-.35,.35]){
    const head = new THREE.Mesh(new THREE.CircleGeometry(.075,16),silhouette);head.position.set(outerX-.12,top+.12,z);head.rotation.y = -Math.PI/2;scene.add(head);
    const shoulders = new THREE.Mesh(new THREE.PlaneGeometry(.32,.16),silhouette);shoulders.position.set(outerX-.12,top-.02,z);shoulders.rotation.y = -Math.PI/2;scene.add(shoulders);
  }
  box(.12,.06,1.9,outerX-.16,top-.1,0,material('#0a0a0d',.6),false);
}
