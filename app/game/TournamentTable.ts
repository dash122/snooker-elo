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
  const wood=new THREE.MeshPhysicalMaterial({map:woodTexture,roughness:.3,clearcoat:.48,clearcoatRoughness:.22});
  const gold=new THREE.MeshStandardMaterial({color:'#b39860',metalness:.78,roughness:.36});
  const leather=new THREE.MeshStandardMaterial({color:'#ad9068',roughness:.88});
  const dark=new THREE.MeshStandardMaterial({color:'#14110e',roughness:1,side:THREE.DoubleSide});
  function mesh(geometry:THREE.BufferGeometry,material:THREE.Material,x=0,y=0,z=0) {
    const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;scene.add(m);return m;
  }
  function box(a:number,b:number,c:number,x:number,y:number,z:number,material:THREE.Material) {return mesh(new RoundedBoxGeometry(a,b,c,2,Math.min(.003,b/5)),material,x,y,z);}
  function extrude(shape:THREE.Shape,depth:number,y:number,material:THREE.Material,bevel=0) {
    const m=mesh(new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:3,steps:1,curveSegments:32}),material,0,y,0);m.rotation.x=Math.PI/2;return m;
  }
  function rectangle(x:number,z:number) {const shape=new THREE.Shape();shape.moveTo(-x,-z);shape.lineTo(x,-z);shape.lineTo(x,z);shape.lineTo(-x,z);shape.closePath();return shape;}
  function perforated(x:number,z:number) {
    const shape=rectangle(x,z);
    for(const [px,pz] of POCKETS){const hole=new THREE.Path();hole.absarc(px,pz,pocketCut(pz),0,Math.PI*2,true);shape.holes.push(hole);}
    return shape;
  }
  // A continuous scalloped perimeter gives the bed six physical cut-outs.
  const bed=new THREE.Shape(),r=TABLE_POCKETS.cornerCut,middle=TABLE_POCKETS.middleCut;
  bed.moveTo(-w+r,-l);bed.lineTo(w-r,-l);bed.absarc(w,-l,r,Math.PI,Math.PI/2,true);
  bed.lineTo(w,-middle);bed.absarc(w,0,middle,-Math.PI/2,-Math.PI*1.5,true);
  bed.lineTo(w,l-r);bed.absarc(w,l,r,-Math.PI/2,-Math.PI,true);
  bed.lineTo(-w+r,l);bed.absarc(-w,l,r,0,-Math.PI/2,true);
  bed.lineTo(-w,middle);bed.absarc(-w,0,middle,Math.PI/2,-Math.PI/2,true);
  bed.lineTo(-w,-l+r);bed.absarc(-w,-l,r,Math.PI/2,0,true);bed.closePath();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(256,256);let seed=19;
  for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const n=(seed>>>24)/255;pixels.data[i]=8+n*3;pixels.data[i+1]=88+n*5;pixels.data[i+2]=31+n*3;pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(6,6);texture.anisotropy=anisotropy;
  const cloth=new THREE.MeshStandardMaterial({color:'#ffffff',map:texture,bumpMap:texture,bumpScale:.00012,roughness:.94});
  extrude(perforated(w+.195,l+.195),.055,-.035,wood,.004);
  extrude(bed,.04,0,cloth);
  // Six individually shaped steel-block cushions, with rounded cloth-covered noses.
  function cushion(length:number,x:number,z:number,rotation:number) {
    const s=new THREE.Shape();
    s.moveTo(-length/2-.019,.071);s.lineTo(length/2+.019,.071);s.lineTo(length/2+.019,.036);
    s.bezierCurveTo(length/2+.019,.012,length/2+.012,0,length/2,0);s.lineTo(-length/2,0);
    s.bezierCurveTo(-length/2-.012,0,-length/2-.019,.012,-length/2-.019,.036);s.closePath();
    const m=new THREE.Mesh(new THREE.ExtrudeGeometry(s,{depth:.028,bevelEnabled:true,bevelSize:.002,bevelThickness:.002,bevelSegments:3,curveSegments:16}),cloth);
    m.rotation.x=Math.PI/2;const group=new THREE.Group();group.add(m);group.rotation.y=rotation;group.position.set(x,.034,z);scene.add(group);m.castShadow=m.receiveShadow=true;
  }
  for(const sign of [-1,1]){
    for(const half of [-1,1])cushion(l-r-middle,sign*w,half*(l-r+middle)/2,sign*Math.PI/2);
    cushion(WIDTH-2*r,0,sign*l,sign===1?0:Math.PI);
    // Polished rail cappings stop short of the leather pocket irons.
    for(const half of [-1,1])box(.115,.054,l-r-middle,sign*(w+.12),.015,half*(l-r+middle)/2,wood);
    box(WIDTH-.13,.054,.115,0,.015,sign*(l+.12),wood);
    // Deep apron, broad gold fascia and fine mouldings.
    for(const half of [-1,1]){
      box(.10,.235,l-.17,sign*(w+.12),-.19,half*(l-r+middle)/2,wood);
      box(.105,.063,l-.17,sign*(w+.125),-.105,half*l/2,gold);
      box(.112,.012,l-.17,sign*(w+.127),-.285,half*l/2,gold);
    }
    box(WIDTH-.10,.235,.10,0,-.19,sign*(l+.12),wood);
    box(WIDTH-.10,.063,.105,0,-.105,sign*(l+.125),gold);
    box(WIDTH-.08,.012,.112,0,-.285,sign*(l+.127),gold);
  }
  // Eight substantial turned/fluted legs on tournament-style levelling feet.
  const profile=[new THREE.Vector2(.105,0),new THREE.Vector2(.11,.035),new THREE.Vector2(.075,.07),new THREE.Vector2(.075,.12),new THREE.Vector2(.10,.18),new THREE.Vector2(.11,.20),new THREE.Vector2(.09,.23),new THREE.Vector2(.075,.27),new THREE.Vector2(.08,.36),new THREE.Vector2(.12,.41)];
  for(const x of [-w-.04,w+.04])for(const z of [-l+.13,-.57,.57,l-.13]){
    mesh(new THREE.LatheGeometry(profile,40),gold,x,-.77,z);
    box(.20,.12,.20,x,-.30,z,wood);
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;mesh(new THREE.CylinderGeometry(.006,.006,.13,5),gold,x+Math.cos(a)*.079,-.47,z+Math.sin(a)*.079);}
  }
  const netMaterial=new THREE.LineBasicMaterial({color:'#8b8571',transparent:true,opacity:.38});
  const threadMaterial=new THREE.LineBasicMaterial({color:'#f0e1bc'});
  function tube(points:THREE.Vector3[],radius:number,material:THREE.Material){return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),32,radius,6,false),material);}
  for(const [x,z] of POCKETS){
    const corner=z!==0,sx=Math.sign(x),sz=Math.sign(z),out=new THREE.Vector2(sx,corner?sz:0).normalize();
    const centre=new THREE.Vector3(x,-.005,z),angle=Math.atan2(out.y,out.x),cut=pocketCut(z),outer=cut+TABLE_POCKETS.leatherWidth;
    // Leather follows only the OUTER arc; the incoming throat stays unobstructed.
    const iron=new THREE.Shape();const start=angle-Math.PI*.50,end=angle+Math.PI*.50;
    iron.absarc(x,z,outer,start,end,false);iron.absarc(x,z,cut,end,start,true);iron.closePath();
    extrude(iron,TABLE_POCKETS.leatherHeight,.035,leather,.0015);
    // Cowhide apron hangs from the iron; its tapered lower edge exposes the net.
    const skirtVertices:number[]=[],skirtIndices:number[]=[];
    for(let i=0;i<=40;i++){
      const a=start+(end-start)*i/40;
      for(const [radius,y] of [[outer,.030],[outer-.006,-.084]])skirtVertices.push(x+Math.cos(a)*radius,y,z+Math.sin(a)*radius);
      if(i<40){const n=i*2;skirtIndices.push(n,n+2,n+1,n+1,n+2,n+3);}
    }
    const skirt=new THREE.BufferGeometry();skirt.setAttribute('position',new THREE.Float32BufferAttribute(skirtVertices,3));skirt.setIndex(skirtIndices);skirt.computeVertexNormals();
    mesh(skirt,leather);
    const stitch:THREE.Vector3[]=[];
    for(let i=0;i<36;i+=2){for(const j of [i,i+.8]){const a=start+(end-start)*j/36;stitch.push(new THREE.Vector3(x+Math.cos(a)*(outer-.004),.037,z+Math.sin(a)*(outer-.004)));}}
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stitch),threadMaterial));
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
