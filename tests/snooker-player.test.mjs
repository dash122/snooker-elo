import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {CUE_LENGTH,CUE_ADDRESS_GAP,STROKE_CONTACT_MS,STROKE_END_MS,cueContactOffset,cueFeather,CUE_HEIGHT,REST_HEAD_CENTRE_HEIGHT,restSupport,cueStroke} from '../lib/snooker-presentation.ts';
import {createCue} from '../app/game/Cue.ts';
import {rigSnookerPlayer} from '../app/game/PlayerAvatar.ts';

function player(){
  const manager=new THREE.LoadingManager();
  // Loading the actual skin/bones needs no browser images for positional validation.
  manager.addHandler(/\.(tga|png|jpg)$/i,{setPath(){return this;},load(){return new THREE.Texture();}});
  const bytes=readFileSync(new URL('../public/models/snooker-player/Male_Adult_08.fbx',import.meta.url));
  const model=new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  return rigSnookerPlayer(model);
}
function world(avatar,name){return avatar.root.getObjectByName(`Bip01_${name}`).getWorldPosition(new THREE.Vector3());}

test('off-centre contact follows the shooter view and moves the bridge and grip together',()=>{
  const avatar=player(),origin={x:0,z:1.22};
  for(const angle of [0,90,180,-90])for(const spin of [{top:1,side:0},{top:-1,side:0},{top:0,side:1},{top:.6,side:-.8}]){
    avatar.update(origin,angle,1,.04,0);
    const hands=['L_Hand','R_Hand'].map(name=>world(avatar,name));
    const offset=cueContactOffset(angle,spin),radians=angle*Math.PI/180;
    assert.ok(Math.abs(offset.x*Math.sin(radians)-offset.z*Math.cos(radians))<1e-10);
    assert.equal(Math.sign(offset.y),Math.sign(spin.top));
    avatar.update(origin,angle,1,.04,0,45,offset);
    for(const [i,name] of ['L_Hand','R_Hand'].entries()){
      const displacement=world(avatar,name).sub(hands[i]);
      assert.ok(displacement.distanceTo(new THREE.Vector3(offset.x,offset.y,offset.z))<1e-6);
    }
  }
});

test('cueing pose keeps a visible cervical segment and the head aligned over the cue',()=>{
  const avatar=player();
  const bindNeckLength=world(avatar,'Head').distanceTo(world(avatar,'Neck'));
  for(const angle of [0,90,180,-90]){
    const origin={x:0,z:1.22};avatar.update(origin,angle,1,.04,0);
    const neck=world(avatar,'Neck'),head=world(avatar,'Head');
    assert.ok(Math.abs(head.distanceTo(neck)-bindNeckLength)<1e-6,'head/neck segment must not be stretched');
    assert.ok(head.y>.12&&head.y<.17);
    const radians=angle*Math.PI/180;
    assert.ok(Math.abs((head.x-origin.x)*Math.cos(radians)+(head.z-origin.z)*Math.sin(radians))<.01);
  }
});
test('bridge and grip stay on the cue plane throughout backswing and follow-through',()=>{
  const avatar=player();
  for(const withdrawal of [-.07,0,.04,.15,.25]){
    const pose=avatar.update({x:0,z:1.22},0,1,withdrawal,0);
    assert.ok(Math.abs(world(avatar,'L_Hand').y-.025)<.005);
    assert.ok(Math.abs(pose.grip.y-.035)<.005);
    assert.ok(Math.abs(pose.grip.x)<.005,'thumb/index cradle remains on the cue plane');
  }
  avatar.update({x:0,z:1.22},0,1,.04,0);
  assert.ok(world(avatar,'R_Forearm').y-world(avatar,'R_Hand').y>.22);
});
test('bending the torso preserves hip anchors and plants both shoes on the floor',()=>{
  const avatar=player();avatar.update({x:0,z:1.22},0,1,.04,0);
  for(const side of ['L','R']){
    assert.ok(Math.abs(world(avatar,`${side}_Thigh`).y+.025)<.005);
    assert.ok(Math.abs(world(avatar,`${side}_Foot`).y+.75)<.005);
    assert.ok(Math.abs(world(avatar,`${side}_Toe0`).y+.85)<.01);
  }
});


test('shoulder girdle follows the chest with a side-on stance and keeps its full width',()=>{
 const avatar=player();
 const width=world(avatar,'L_UpperArm').distanceTo(world(avatar,'R_UpperArm'));
 for(const angle of [0,45,90,180,-90])for(const withdrawal of [-.07,.04,.25]){
  const pose=avatar.update({x:0,z:1.22},angle,1,withdrawal,0);
  const left=world(avatar,'L_UpperArm'),right=world(avatar,'R_UpperArm');
  assert.ok(Math.abs(left.distanceTo(right)-width)<1e-6,'collarbones must not be pulled into the chest');
  const direction=new THREE.Vector3(Math.sin(angle*Math.PI/180),0,-Math.cos(angle*Math.PI/180));
  assert.ok(left.clone().sub(right).dot(direction)>.25,'bridge shoulder must lead the cueing shoulder');
  for(const side of ['L','R'])assert.equal(avatar.root.getObjectByName(`Bip01_${side}_Clavicle`).parent.name,'Bip01_Spine2');
  assert.ok(world(avatar,'L_Forearm').y>.01,'bridge elbow must clear the cloth');
  if(!pose.extended)assert.ok(Math.abs(world(avatar,'L_Finger4').y-world(avatar,'L_Finger1').y)<.02,'bridge fingers spread across the cloth');
 }
});
test('rest support stays on the cue line through the complete stroke and the hand holds its shaft',()=>{
 const avatar=player(),origin={x:0,z:1.22};
 for(const angle of [0,45,90,180,-90]){
  const a=angle*Math.PI/180,direction=new THREE.Vector3(Math.sin(a),0,-Math.cos(a)),support=restSupport(origin,angle);
  const delta=new THREE.Vector3(support.x-origin.x,0,support.z-origin.z);
  assert.ok(delta.clone().cross(direction).length()<1e-9);
  assert.ok(Math.abs(CUE_HEIGHT-.005-(REST_HEAD_CENTRE_HEIGHT+.003))<.002,'cross head saddle must meet the cue underside');
  for(const time of [0,530,910,1450,1540,STROKE_CONTACT_MS,STROKE_CONTACT_MS+180]){
   const withdrawal=cueStroke(time,100),pose=avatar.update(origin,angle,1,withdrawal,0);
   assert.ok(-delta.dot(direction)>.02625+withdrawal,'cue tip stays ahead of the fixed rest head');
   if(pose.extended){
    const hand=world(avatar,'L_Hand'),across=new THREE.Vector3(Math.cos(a),0,Math.sin(a));
    assert.ok(Math.abs(hand.clone().sub(new THREE.Vector3(origin.x,hand.y,origin.z)).dot(across))>.07,'rest hand holds the handle beside the cue');
    assert.ok(Math.abs(hand.y-.025)<.005);
   }
  }
 }
});


test('standard cue is a fixed 58 inches, with an explicitly attached extension',()=>{
 const cue=createCue();
 function bounds(){const box=new THREE.Box3();cue.root.updateMatrixWorld(true);cue.root.traverse(o=>{if(o instanceof THREE.Mesh&&o.visible){o.geometry.computeBoundingBox();box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}});return box;}
 const standard=bounds();assert.ok(Math.abs(standard.max.y)<1e-7);assert.ok(Math.abs(standard.min.y+CUE_LENGTH)<1e-7);
 cue.setExtension(.60);assert.ok(Math.abs(bounds().min.y+CUE_LENGTH+.60)<1e-7);
 cue.setExtension(0);assert.ok(Math.abs(bounds().min.y+CUE_LENGTH)<1e-7);assert.deepEqual(cue.root.scale.toArray(),[1,1,1]);
});
test('bridge is planted and grip stays at one point on the cue through feathering and delivery',()=>{
 const avatar=player(),origin={x:0,z:1.22};
 for(const angle of [0,90,180])for(const power of [5,45,100]){
  let planted,gripStation,extension,bridge;
  const a=angle*Math.PI/180,direction=new THREE.Vector3(Math.sin(a),0,-Math.cos(a));
  for(const time of [0,120,350,530,740,910,1090,1450,1540,STROKE_CONTACT_MS,STROKE_CONTACT_MS+180]){
   const withdrawal=cueStroke(time,power),pose=avatar.update(origin,angle,1,withdrawal,0,power),hand=world(avatar,'L_Hand');
   if(planted)assert.ok(hand.distanceTo(planted)<1e-6);else planted=hand;
   bridge=pose.bridgeDistance;
   const station=-(pose.grip.x-origin.x)*direction.x-(pose.grip.z-origin.z)*direction.z-.02625-withdrawal;
   if(gripStation!==undefined)assert.ok(Math.abs(station-gripStation)<.005);else gripStation=station;
   if(extension!==undefined)assert.equal(pose.extension,extension);else extension=pose.extension;
   assert.ok(station<CUE_LENGTH+pose.extension-.10,'grip leaves room behind the hand');
  }
  if(angle===0){const surfaceGap=-planted.clone().sub(new THREE.Vector3(origin.x,planted.y,origin.z)).dot(direction)-.02625-.060;assert.ok(Math.abs(surfaceGap-bridge)<.005);assert.ok(surfaceGap>.10&&surfaceGap<.30);}
 }
});

test('address has a straight right leg, soft left knee and softly bent bridge elbow',()=>{
 const avatar=player();
 const flex=(a,b,c)=>180-THREE.MathUtils.radToDeg(world(avatar,a).sub(world(avatar,b)).angleTo(world(avatar,c).sub(world(avatar,b))));
 for(const angle of [0,45,90,180,-90])for(const power of [5,45,100])for(const withdrawal of [-.14,.004,.204]){
  const pose=avatar.update({x:0,z:1.22},angle,1,withdrawal,0,power);
  assert.ok(flex('R_Thigh','R_Calf','R_Foot')<5);
  assert.ok(Math.abs(flex('L_Thigh','L_Calf','L_Foot')-25)<1);
  const elbow=flex('L_UpperArm','L_Forearm','L_Hand');
  assert.ok(elbow>=19&&elbow<=31,`left elbow flex: ${elbow}`);
  const cradle=world(avatar,'R_Finger0').lerp(world(avatar,'R_Finger1'),.5);
  assert.ok(cradle.distanceTo(pose.grip)<1e-6,'cue anchor is inside the hand');
 }
});
test('feathering stays clear of the ball, varies its rhythm, and scales with power',()=>{
 let softMax=0,hardMax=0;
 for(let t=0;t<3500;t+=5){const soft=cueFeather(t,5),hard=cueFeather(t,100);assert.ok(soft>=CUE_ADDRESS_GAP-1e-9&&hard>=CUE_ADDRESS_GAP-1e-9);softMax=Math.max(softMax,soft);hardMax=Math.max(hardMax,hard);}
 assert.ok(hardMax>softMax+.025);assert.equal(cueFeather(1550,45),CUE_ADDRESS_GAP);
});
test('delivery is continuous, touches exactly at the physics clock, and holds its follow-through',()=>{
 for(const power of [5,45,100]){
  assert.equal(cueStroke(0,power,.052),.052);
  for(const t of [120,530,910,1090,1450,1540,STROKE_CONTACT_MS,STROKE_CONTACT_MS+180])assert.ok(Math.abs(cueStroke(t-.001,power)-cueStroke(t+.001,power))<.00001);
  for(let t=0;t<STROKE_CONTACT_MS;t+=5)assert.ok(cueStroke(t,power)>0);
  assert.ok(cueStroke(STROKE_CONTACT_MS,power)===0);
  const finish=cueStroke(STROKE_CONTACT_MS+180,power);assert.ok(finish<-.075);assert.equal(cueStroke(STROKE_END_MS,power),finish);
  const before=(cueStroke(STROKE_CONTACT_MS,power)-cueStroke(STROKE_CONTACT_MS-.01,power))/.01;
  const after=(cueStroke(STROKE_CONTACT_MS+.01,power)-cueStroke(STROKE_CONTACT_MS,power))/.01;
  assert.ok(Math.abs(before-after)<.000001,'cue velocity must not jump at contact');
 }
});

