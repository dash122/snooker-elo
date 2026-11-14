import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TABLE_POCKETS, pocketCut } from '../../lib/snooker-table';
import { WIDTH, LENGTH, POCKETS } from '../../lib/snooker-game';

/** Original geometry based on the Star XW101 construction, not a certified replica.
 * Cloth, slate and rail deck all have real openings; no black discs above the baize.
 * x/z use the gameplay coordinates. y=0 remains the playing surface.
 */
export function buildTournamentTable(scene:THREE.Scene,anisotropy:number) {
  const w=WIDTH/2,l=LENGTH/2;
  const grainCanvas=document.createElement('canvas');grainCanvas.width=512;grainCanvas.height=128;
  const grainCtx=grainCanvas.getContext('2d')!,grainPixels=grainCtx.createImageData(512,128);let grainSeed=73;
  for(let y=0;y<128;y++)for(let x=0;x<512;x++){
    grainSeed=(grainSeed*1664525+1013904223)>>>0;
    const grain=Math.sin(y*.91+Math.sin(x*.014)*1.8)*3+Math.sin(y*2.7+x*.003)*2+(grainSeed>>>24)/255*2;
    const i=(y*512+x)*4;grainPixels.data[i]=71+grain;grainPixels.data[i+1]=36+grain*.6;grainPixels.data[i+2]=27+grain*.4;grainPixels.data[i+3]=255;
  }
  grainCtx.putImageData(grainPixels,0,0);const woodTexture=new THREE.CanvasTexture(grainCanvas);woodTexture.colorSpace=THREE.SRGBColorSpace;woodTexture.anisotropy=anisotropy;
  // Deep French-polished mahogany: the clearcoat picks up a crisp reflection of the canopy.
  const wood=new THREE.MeshPhysicalMaterial({map:woodTexture,color:'#a5604a',roughness:.6,specularIntensity:.35,clearcoat:.45,clearcoatRoughness:.18,envMapIntensity:.35});
  const gold=new THREE.MeshStandardMaterial({color:'#b39860',metalness:.78,roughness:.36,envMapIntensity:.6});
  // Pocket shields: black hide stretched over cast irons, with a soft sheen.
  const leather=new THREE.MeshPhysicalMaterial({color:'#0e0a08',roughness:.72,specularIntensity:.3,clearcoat:.12,clearcoatRoughness:.4,envMapIntensity:.3});
  const dark=new THREE.MeshStandardMaterial({color:'#14110e',roughness:1,side:THREE.DoubleSide});
  function mesh(geometry:THREE.BufferGeometry,material:THREE.Material,x=0,y=0,z=0) {
    const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;scene.add(m);return m;
  }
  function box(a:number,b:number,c:number,x:number,y:number,z:number,material:THREE.Material) {return mesh(new RoundedBoxGeometry(a,b,c,2,Math.min(.003,b/5)),material,x,y,z);}
  function extrude(shape:THREE.Shape,depth:number,y:number,material:THREE.Material,bevel=0) {
    const m=mesh(new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:3,steps:1,curveSegments:32}),material,0,y,0);m.rotation.x=Math.PI/2;return m;
  }
  // A rounded rectangle, for the one-piece rail capping and apron.
  function rounded(x:number,z:number,radius:number) {
    const shape=new THREE.Shape();
    shape.moveTo(-x+radius,-z);shape.lineTo(x-radius,-z);shape.absarc(x-radius,-z+radius,radius,-Math.PI/2,0,false);
    shape.lineTo(x,z-radius);shape.absarc(x-radius,z-radius,radius,0,Math.PI/2,false);
    shape.lineTo(-x+radius,z);shape.absarc(-x+radius,z-radius,radius,Math.PI/2,Math.PI,false);
    shape.lineTo(-x,-z+radius);shape.absarc(-x+radius,-z+radius,radius,Math.PI,Math.PI*1.5,false);
    return shape;
  }
  // A continuous scalloped perimeter gives the bed six physical cut-outs.
  const bed=new THREE.Shape(),r=TABLE_POCKETS.cornerCut,middle=TABLE_POCKETS.middleCut,back=TABLE_POCKETS.middleSetback;
  // The middle falls are set back behind the nose line, as on a real table.
  const sweep=Math.acos(back/middle),mouth=middle*Math.sin(sweep);
  bed.moveTo(-w+r,-l);bed.lineTo(w-r,-l);bed.absarc(w,-l,r,Math.PI,Math.PI/2,true);
  bed.lineTo(w,-mouth);bed.absarc(w+back,0,middle,-Math.PI+sweep,-Math.PI-sweep,true);
  bed.lineTo(w,l-r);bed.absarc(w,l,r,-Math.PI/2,-Math.PI,true);
  bed.lineTo(-w+r,l);bed.absarc(-w,l,r,0,-Math.PI/2,true);
  bed.lineTo(-w,mouth);bed.absarc(-w-back,0,middle,sweep,-sweep,true);
  bed.lineTo(-w,-l+r);bed.absarc(-w,-l,r,Math.PI/2,0,true);bed.closePath();
  // Tournament cloth: a tight worsted weave with a directional nap. Paint fine
  // fibres (mostly lying along the table, from baulk to the top cushion) over
  // a faint mottle, then let sheen give it the soft, velvety edge highlight
  // that baize shows under a canopy, rather than a plastic gloss.
  const size=512,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d')!;let seed=19;
  const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  ctx.fillStyle='rgb(14,108,48)';ctx.fillRect(0,0,size,size);
  for(let i=0;i<70;i++){
    const x=random()*size,y=random()*size,radius=30+random()*90,light=random()<.5;
    const g=ctx.createRadialGradient(x,y,0,x,y,radius);
    g.addColorStop(0,light?'rgba(40,130,70,.022)':'rgba(0,30,12,.025)');g.addColorStop(1,'rgba(0,0,0,0)');
    for(const [dx,dy] of [[0,0],[size,0],[-size,0],[0,size],[0,-size]]){ctx.fillStyle=g;ctx.save();ctx.translate(dx,dy);ctx.fillRect(x-radius,y-radius,radius*2,radius*2);ctx.restore();}
  }
  ctx.lineCap='round';
  for(let i=0;i<26000;i++){
    const x=random()*size,y=random()*size,len=1.5+random()*4.5,angle=Math.PI/2+(random()-.5)*.9,light=random();
    ctx.strokeStyle=light<.45?`rgba(40,130,66,${.08+random()*.12})`:`rgba(0,34,12,${.10+random()*.18})`;
    ctx.lineWidth=.6+random()*.5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(angle)*len,y+Math.sin(angle)*len);ctx.stroke();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(3,6);texture.anisotropy=anisotropy;
  const nap=texture.clone();nap.colorSpace=THREE.NoColorSpace;nap.needsUpdate=true;
  const cloth=new THREE.MeshPhysicalMaterial({color:'#ffffff',map:texture,bumpMap:nap,bumpScale:.00025,roughness:.92,sheen:.3,sheenRoughness:.75,sheenColor:new THREE.Color('#1f6b38'),envMapIntensity:.15});
  // Cushion cloth is the same baize, a shade darker where it wraps the rubber.
  const cushionCloth=cloth.clone();cushionCloth.color=new THREE.Color('#d9e6dc');
  extrude(bed,.04,0,cloth);
  // Soft occlusion where the cushion rubber overhangs the bed: real cushions
  // always sit on a thin dark line, which is what makes them read as raised.
  const shade=document.createElement('canvas');shade.width=4;shade.height=64;
  const shadeCtx=shade.getContext('2d')!,shadeGradient=shadeCtx.createLinearGradient(0,64,0,0);
  shadeGradient.addColorStop(0,'rgba(0,0,0,.55)');shadeGradient.addColorStop(.35,'rgba(0,0,0,.18)');shadeGradient.addColorStop(1,'rgba(0,0,0,0)');
  shadeCtx.fillStyle=shadeGradient;shadeCtx.fillRect(0,0,4,64);
  const shadeMaterial=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shade),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  function cushionShade(length:number,x:number,z:number,rotation:number){
    // The plane's local +y points into the table; the dark edge sits on the nose line.
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(length,.045),shadeMaterial);
    plane.geometry.translate(0,.0225,0);plane.rotation.order='YXZ';plane.rotation.set(-Math.PI/2,rotation,0);plane.position.set(x,.0025,z);plane.renderOrder=1;scene.add(plane);
  }
  for(const sign of [-1,1]){
    for(const half of [-1,1])cushionShade(l-r-middle,sign*w,half*(l-r+middle)/2,sign*Math.PI/2);
    cushionShade(WIDTH-2*r,0,sign*l,sign===1?0:Math.PI);
  }
  // Six individually shaped steel-block cushions, with rounded cloth-covered noses.
  function cushion(length:number,x:number,z:number,rotation:number) {
    const s=new THREE.Shape();
    s.moveTo(-length/2-.019,.071);s.lineTo(length/2+.019,.071);s.lineTo(length/2+.019,.036);
    s.bezierCurveTo(length/2+.019,.012,length/2+.012,0,length/2,0);s.lineTo(-length/2,0);
    s.bezierCurveTo(-length/2-.012,0,-length/2-.019,.012,-length/2-.019,.036);s.closePath();
    const m=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.028,bevelEnabled:true,bevelSize:.002,bevelThickness:.002,bevelSegments:3,curveSegments:16}),cushionCloth);
    m.rotation.x=Math.PI/2;const group=new THREE.Group();group.add(m);group.rotation.y=rotation;group.position.set(x,.034,z);scene.add(group);m.castShadow=m.receiveShadow=true;
  }
  for(const sign of [-1,1]){
    for(const half of [-1,1])cushion(l-r-middle,sign*w,half*(l-r+middle)/2,sign*Math.PI/2);
    cushion(WIDTH-2*r,0,sign*l,sign===1?0:Math.PI);
  }
  // One-piece polished rail capping with rounded corners and bevelled edges,
  // as on a match table: the cushions butt against its inner edge, and each
  // pocket is cut from it in a round notch that the leather shield fills.
  const RAIL_IN=.068,CORNER_NOTCH=.11,MIDDLE_NOTCH=.085,RAIL_OUT=.19;
  const inner:THREE.Vector2[]=[];
  // Arcs run counter-clockwise (in x→z) from where the rail's inner edge meets
  // the notch circle, round the outside of the pocket, to where it meets again.
  const arc=(cx:number,cz:number,radius:number,from:number,to:number)=>{
    while(to<from)to+=360;
    for(let i=0;i<=24;i++){const a=(from+(to-from)*i/24)*Math.PI/180;inner.push(new THREE.Vector2(cx+Math.cos(a)*radius,cz+Math.sin(a)*radius));}
  };
  const deg=(z:number,x:number)=>Math.atan2(z,x)*180/Math.PI;
  const mz=Math.sqrt(MIDDLE_NOTCH**2-(RAIL_IN-back)**2),cz=Math.sqrt(CORNER_NOTCH**2-RAIL_IN**2),mid=deg(mz,RAIL_IN-back);
  arc(w+back,0,MIDDLE_NOTCH,-mid,mid);
  arc(w,l,CORNER_NOTCH,deg(-cz,RAIL_IN),deg(RAIL_IN,-cz));
  arc(-w,l,CORNER_NOTCH,deg(RAIL_IN,cz),deg(-cz,-RAIL_IN));
  arc(-w-back,0,MIDDLE_NOTCH,180-mid,180+mid);
  arc(-w,-l,CORNER_NOTCH,deg(cz,-RAIL_IN),deg(-RAIL_IN,cz));
  arc(w,-l,CORNER_NOTCH,deg(-RAIL_IN,-cz),deg(cz,RAIL_IN));
  const capping=rounded(w+RAIL_OUT,l+RAIL_OUT,.075);capping.holes.push(new THREE.Path(inner));
  extrude(capping,.064,.034,wood,.006);
  // Deep apron below the rail: one continuous frame, never split at the pockets.
  const apron=rounded(w+RAIL_OUT-.02,l+RAIL_OUT-.02,.06);
  const apronHole=new THREE.Path();apronHole.moveTo(-w-.075,-l-.075);apronHole.lineTo(w+.075,-l-.075);apronHole.lineTo(w+.075,l+.075);apronHole.lineTo(-w-.075,l+.075);apronHole.closePath();
  apron.holes.push(apronHole);extrude(apron,.25,-.036,wood,.004);
  // Fine brass beads under the rail and along the foot of the apron.
  for(const y of [-.036,-.282]){
    const bead=rounded(w+RAIL_OUT-.016,l+RAIL_OUT-.016,.064);
    const hole=new THREE.Path();hole.moveTo(-w-.1,-l-.1);hole.lineTo(w+.1,-l-.1);hole.lineTo(w+.1,l+.1);hole.lineTo(-w-.1,l+.1);hole.closePath();
    bead.holes.push(hole);extrude(bead,.006,y,gold,.0015);
  }
  // Eight substantial turned/fluted legs on tournament-style levelling feet.
  const profile=[new THREE.Vector2(.105,0),new THREE.Vector2(.11,.035),new THREE.Vector2(.075,.07),new THREE.Vector2(.075,.12),new THREE.Vector2(.10,.18),new THREE.Vector2(.11,.20),new THREE.Vector2(.09,.23),new THREE.Vector2(.075,.27),new THREE.Vector2(.08,.36),new THREE.Vector2(.12,.41)];
  for(const x of [-w-.08,w+.08])for(const z of [-l+.13,-.57,.57,l-.13]){
    // Turned mahogany legs on a brass collar and dark levelling foot.
    mesh(new THREE.LatheGeometry(profile,40),wood,x,-.77,z);
    box(.20,.12,.20,x,-.33,z,wood);
    mesh(new THREE.CylinderGeometry(.084,.084,.012,40),gold,x,-.41,z);
    mesh(new THREE.CylinderGeometry(.1,.11,.02,40),dark,x,-.78,z);
  }
  const netMaterial=new THREE.LineBasicMaterial({color:'#8b8571',transparent:true,opacity:.38});
  function tube(points:THREE.Vector3[],radius:number,material:THREE.Material){return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),32,radius,6,false),material);}
  for(const [px,z] of POCKETS){
    const corner=z!==0,sx=Math.sign(px),sz=Math.sign(z),x=corner?px:px+sx*back,out=new THREE.Vector2(sx,corner?sz:0).normalize();
    const centre=new THREE.Vector3(x,-.005,z),angle=Math.atan2(out.y,out.x),cut=pocketCut(z);
    // Leather shield over the iron: it fills the rail's round notch, wraps the
    // back of the pocket and leaves the throat between the cushion jaws open.
    const reach=corner?CORNER_NOTCH+.03:MIDDLE_NOTCH+.014,spread=corner?.56:.62;
    const shield=new THREE.Shape(),from=angle-Math.PI*spread,to=angle+Math.PI*spread;
    shield.absarc(x,z,reach,from,to,false);shield.absarc(x,z,cut,to,from,true);shield.closePath();
    extrude(shield,.05,.044,leather,.005);
    // The cast iron rim shows as a thin dark lip around the drop.
    mesh(new THREE.TorusGeometry(cut+.002,.0035,10,48,Math.PI*2*spread),dark,x,.046,z).rotation.set(Math.PI/2,0,from);
    // A dark, open-ended liner descends below the actual slate opening.
    mesh(new THREE.CylinderGeometry(cut-.001,cut-.006,.11,40,1,true),dark,x,-.075,z);
    const net:THREE.Vector3[]=[];
    const point=(t:number,a:number)=>new THREE.Vector3(x+out.x*.045*t+Math.cos(a)*(cut-.003-.014*t),-.06-.19*t,z+out.y*.045*t+Math.sin(a)*(cut-.003-.014*t));
    for(let row=0;row<8;row++)for(let col=0;col<20;col++){
      const t=row/8,a=col/20*Math.PI*2;
      for(const offset of [-.5,.5])net.push(point(t,a),point((row+1)/8,a+offset/20*Math.PI*2));
    }
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(net),netMaterial));
    // Twin black metal slides turn under the apron and retain potted balls.
    const tangent=new THREE.Vector3(-out.y,0,out.x),inward=new THREE.Vector3(-out.x,0,-out.y);
    for(const offset of [-.026,.026]){
      const startPoint=centre.clone().addScaledVector(tangent,offset);startPoint.y=-.24;
      const bend=startPoint.clone().addScaledVector(new THREE.Vector3(out.x,0,out.y),.07);bend.y=-.31;
      const finish=bend.clone().addScaledVector(inward,.42).addScaledVector(tangent,corner?.18:.12);finish.y=-.34;
      tube([startPoint,bend,finish],.005,dark);
    }
  }
}
