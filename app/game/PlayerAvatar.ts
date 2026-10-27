import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { cueExtension } from '../../lib/snooker-presentation.ts';
import { RADIUS, WIDTH, LENGTH } from '../../lib/snooker-game.ts';

const ASSET_ROOT='/models/snooker-player/';
const v=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
const rotation=new THREE.Quaternion();
// Radians the hips open with the chest at address (the chest turns .68).
const HIP_TURN=-.5;

/** Microsoft Rocketbox's textured, skinned human. Bone posing is authored for cue sports. */
export async function loadPlayerAvatar(){
  const manager=new THREE.LoadingManager();
  manager.setURLModifier(url=>{
    if(!/\.tga$/i.test(url))return url;
    const name=url.split(/[\\/]/).pop()!;
    return ASSET_ROOT+(name.includes('_color')?name.replace(/\.tga$/i,'.webp'):name.includes('normal')?'normal.webp':'specular.webp');
  });
  manager.addHandler(/\.tga$/i,new THREE.TextureLoader(manager));
  let loaded:THREE.Group|undefined;
  const model=await new Promise<THREE.Group>((resolve,reject)=>{
    manager.onLoad=()=>{if(loaded)resolve(loaded);};
    manager.onError=url=>reject(new Error(`Player asset unavailable: ${url}`));
    new FBXLoader(manager).load(ASSET_ROOT+'Male_Adult_08.fbx',object=>{loaded=object;},undefined,reject);
  });
  return rigSnookerPlayer(model);
}

/** Pose in metres. Kept separate from loading so anatomical constraints can be verified offline. */
export function rigSnookerPlayer(model:THREE.Group){
  const root=new THREE.Group();root.add(model);model.scale.setScalar(.01);
  root.updateMatrixWorld(true);
  // Rocketbox parents the clavicles under the neck. Head counter-rotation must
  // not rotate the shoulders or shear the weighted shirt into the upper torso.
  const chest=model.getObjectByName('Bip01_Spine2')!;
  for(const side of ['L','R'])chest.attach(model.getObjectByName(`Bip01_${side}_Clavicle`)!);
  root.updateMatrixWorld(true);
  const bones=new Map<string,THREE.Bone>(),bind=new Map<THREE.Bone,THREE.Quaternion>(),bindPositions=new Map<THREE.Bone,THREE.Vector3>();
  model.traverse(object=>{
    if(object instanceof THREE.Bone){bones.set(object.name,object);bind.set(object,object.quaternion.clone());bindPositions.set(object,object.position.clone());}
    if(object instanceof THREE.Mesh){
      const source=Array.isArray(object.material)?object.material:[object.material];
      // Garment boundaries are authored in the original, unposed mesh coordinates.
      const positions=object.geometry.attributes.position;
      const garment=new Float32Array(positions.count*3),mask=new Float32Array(positions.count);
      for(let index=0;index<positions.count;index++){
        const point=new THREE.Vector3().fromBufferAttribute(positions,index).applyMatrix4(object.matrixWorld).multiplyScalar(100);
        const {x,y,z}=point;
        const hands=Math.abs(x)>54&&y<117;
        const neckSkin=y>150&&Math.abs(x)<7.5;
        const waistcoat=y>98&&y<146&&Math.abs(x)<(y>132?21:19);
        const opening=z>0&&y>126&&Math.abs(x)<(y-126)*.42;
        const colour=new THREE.Color(y<98?'#141419':waistcoat&&!opening?'#111116':'#f2f0e9');
        garment.set([colour.r,colour.g,colour.b],index*3);mask[index]=hands||neckSkin?0:1;
      }
      object.geometry.setAttribute('formalColour',new THREE.BufferAttribute(garment,3));
      object.geometry.setAttribute('formalMask',new THREE.BufferAttribute(mask,1));
      object.material=source.map(material=>{
        const original=material as THREE.MeshPhongMaterial;
        const skin=material.name.includes('head'),hair=material.name.includes('opacity');
        const next=new THREE.MeshStandardMaterial({name:material.name,map:original.map,color:0xffffff,roughness:skin?.63:.88,metalness:0,side:hair?THREE.DoubleSide:THREE.FrontSide,transparent:hair,alphaTest:hair?.45:0});
        if(original.map)original.map.colorSpace=THREE.SRGBColorSpace;
        if(material.name.includes('body')){
          next.onBeforeCompile=shader=>{
            shader.vertexShader='attribute vec3 formalColour; attribute float formalMask; varying vec3 vFormalColour; varying float vFormalMask;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFormalColour=formalColour; vFormalMask=formalMask;');
            shader.fragmentShader='varying vec3 vFormalColour; varying float vFormalMask;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nif(vFormalMask>0.5){float weave=clamp(dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722))*2.2,0.48,1.1); diffuseColor.rgb=vFormalColour*weave;}');
          };
          next.customProgramCacheKey=()=>'championship-formalwear-v1';
        }
        // The original Phong materials exaggerate skin highlights under stadium lights.
        original.dispose();return next;
      });
      object.castShadow=true;object.receiveShadow=true;object.frustumCulled=false;
    }
  });
  root.updateMatrixWorld(true);
  const bone=(name:string)=>bones.get('Bip01_'+name)!;
  // The cue passes through the thumb/index cradle, not the wrist joint.
  const gripAnchor=bone('R_Hand').worldToLocal(bone('R_Finger0').getWorldPosition(new THREE.Vector3())
    .lerp(bone('R_Finger1').getWorldPosition(new THREE.Vector3()),.5));
  // How far the wrist sits above the cue when the hand hangs from it.
  const gripDrop=bone('R_Hand').localToWorld(gripAnchor.clone()).distanceTo(bone('R_Hand').getWorldPosition(new THREE.Vector3()));
  const footRotations=new Map(['L','R'].map(side=>[side,bone(`${side}_Foot`).getWorldQuaternion(new THREE.Quaternion())]));
  const headRotation=bone('Head').getWorldQuaternion(new THREE.Quaternion());
  const neckRotation=bone('Neck').getWorldQuaternion(new THREE.Quaternion());
  const bowTie=new THREE.Group(),satin=new THREE.MeshStandardMaterial({color:'#111116',roughness:.42});
  for(const side of [-1,1]){const wing=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),satin);wing.scale.set(.027,.015,.009);wing.position.x=side*.022;wing.rotation.z=side*.22;bowTie.add(wing);}
  const knot=new THREE.Mesh(new THREE.SphereGeometry(.012,12,8),satin);knot.scale.set(.7,1,.7);bowTie.add(knot);
  bowTie.position.copy(bone('Neck').worldToLocal(v(0,1.495,.09)));
  bowTie.quaternion.copy(bone('Neck').getWorldQuaternion(new THREE.Quaternion()).invert());
  bone('Neck').add(bowTie);bowTie.scale.setScalar(100);
  const local=(point:THREE.Vector3)=>root.localToWorld(point.clone());
  function turnWorld(joint:THREE.Bone,delta:THREE.Quaternion){
    joint.parent!.getWorldQuaternion(rotation);const parent=rotation.clone();
    joint.quaternion.premultiply(parent.invert().multiply(delta).multiply(rotation));
    joint.updateWorldMatrix(false,true);
  }
  function pointBone(joint:THREE.Bone,child:THREE.Bone,target:THREE.Vector3){
    const origin=joint.getWorldPosition(new THREE.Vector3());
    const from=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const to=target.clone().sub(origin).normalize();
    turnWorld(joint,new THREE.Quaternion().setFromUnitVectors(from,to));
  }
  function limb(upper:THREE.Bone,lower:THREE.Bone,tip:THREE.Bone,target:THREE.Vector3,pole:THREE.Vector3){
    const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=tip.getWorldPosition(new THREE.Vector3());
    const first=a.distanceTo(b),second=b.distanceTo(c),direction=target.clone().sub(a);
    const distance=THREE.MathUtils.clamp(direction.length(),Math.abs(first-second)+.00001,first+second-.00001);direction.normalize();
    const along=(first*first-second*second+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,first*first-along*along));
    const bend=pole.clone().sub(a);bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const elbow=a.clone().addScaledVector(direction,along).addScaledVector(bend,height);
    pointBone(upper,lower,elbow);pointBone(lower,tip,target);
  }
  function update(origin:{x:number;z:number},angle:number,amount:number,withdrawal:number,player:number,power=45,offset={x:0,y:0,z:0}){
    const radians=angle*Math.PI/180,dx=Math.sin(radians),dz=-Math.cos(radians);
    const tx=Math.abs(dx)>.001?((dx>0?origin.x+WIDTH/2:WIDTH/2-origin.x)/Math.abs(dx)):Infinity;
    const tz=Math.abs(dz)>.001?((dz>0?origin.z+LENGTH/2:LENGTH/2-origin.z)/Math.abs(dz)):Infinity;
    const distance=Math.max(1.22,Math.min(tx,tz)+.32);
    // Stand to the left of the cue line so the cue clears the torso and the grip sits at the right hip.
    root.position.set(origin.x-dx*distance+dz*.20,-.85,origin.z-dz*distance-dx*.20);
    root.rotation.set(0,Math.atan2(dx,dz),0);
    for(const [joint,q] of bind){joint.quaternion.copy(q);joint.position.copy(bindPositions.get(joint)!);}
    model.position.y=-.07*amount;
    root.updateMatrixWorld(true);
    // Open the hips with the chest (most of its turn) so the torso does not
    // corkscrew above square hips; feet then stagger along the stance line.
    const pelvis=bone('Pelvis').getWorldPosition(new THREE.Vector3()),hipTurn=new THREE.Quaternion().setFromAxisAngle(v(0,1,0),HIP_TURN*amount);
    const hips=['L','R'].map(side=>bone(`${side}_Thigh`).getWorldPosition(new THREE.Vector3()).sub(pelvis).applyQuaternion(hipTurn).add(pelvis));
    const mix=(upright:THREE.Vector3,address:THREE.Vector3)=>local(upright.lerp(address,amount));
    // Bend from the pelvis with a continuous spine, rather than solving the
    // torso as a two-bone limb (which folds the chest and collapses the shirt).
    // Right-handed stance: left shoulder forward, right shoulder back.
    const torso=new THREE.Quaternion().setFromAxisAngle(v(0,1,0),-.68*amount)
      .multiply(new THREE.Quaternion().setFromAxisAngle(v(1,0,0),1.36*amount));
    turnWorld(bone('Pelvis'),root.quaternion.clone().multiply(torso).multiply(root.quaternion.clone().invert()));
    const desiredNeck=root.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v(1,0,0),.95*amount)).multiply(neckRotation);
    bone('Neck').quaternion.copy(bone('Neck').parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredNeck));
    const desiredHead=root.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(v(1,0,0),.38*amount)).multiply(headRotation);
    bone('Head').quaternion.copy(bone('Head').parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredHead));
    root.updateMatrixWorld(true);
    // This rig parents the thighs under Spine. Keep their anatomical hip anchors fixed when bending.
    for(const [index,side] of ['L','R'].entries()){
      const thigh=bone(`${side}_Thigh`);thigh.position.copy(thigh.parent!.worldToLocal(hips[index].clone()));
    }
    root.updateMatrixWorld(true);
    // Move the stance laterally so the eyes/chin stay over the cue, while the
    // chest remains turned away from it. Do not pull either shoulder inward.
    const head=bone('Head').getWorldPosition(new THREE.Vector3());
    const lateral=v(dz,0,-dx),error=head.clone().sub(v(origin.x,head.y,origin.z)).dot(lateral);
    root.position.addScaledVector(lateral,-error*amount);root.updateMatrixWorld(true);
    const cueX=root.worldToLocal(v(origin.x,.035,origin.z)).x;
    const extended=distance>1.4;
    const bridgeShoulder=root.worldToLocal(bone('L_UpperArm').getWorldPosition(new THREE.Vector3()));
    const upperLength=bone('L_UpperArm').getWorldPosition(new THREE.Vector3()).distanceTo(bone('L_Forearm').getWorldPosition(new THREE.Vector3()));
    const lowerLength=bone('L_Forearm').getWorldPosition(new THREE.Vector3()).distanceTo(bone('L_Hand').getWorldPosition(new THREE.Vector3()));
    // A soft elbow in both bridge and rest poses, with a little more flex for power.
    const reachSquared=upperLength**2+lowerLength**2+2*upperLength*lowerLength*Math.cos((20+10*THREE.MathUtils.clamp(power/100,0,1))*Math.PI/180);
    const leftX=cueX+(extended?.095:0);
    const bridgeZ=bridgeShoulder.z+Math.sqrt(Math.max(.001,reachSquared-(leftX-bridgeShoulder.x)**2-(.875-bridgeShoulder.y)**2));
    const shoulder=root.worldToLocal(bone('R_UpperArm').getWorldPosition(new THREE.Vector3()));
    const elbowLength=bone('R_UpperArm').getWorldPosition(new THREE.Vector3()).distanceTo(bone('R_Forearm').getWorldPosition(new THREE.Vector3()));
    const forearmLength=bone('R_Forearm').getWorldPosition(new THREE.Vector3()).distanceTo(bone('R_Hand').getWorldPosition(new THREE.Vector3()));
    const elbowY=.885+gripDrop+forearmLength;
    const gripBaseZ=shoulder.z-Math.sqrt(Math.max(.005,elbowLength**2-(elbowY-shoulder.y)**2-(cueX-shoulder.x)**2));
    const gripZ=gripBaseZ-withdrawal;
    // With a mechanical rest the left hand holds the handle beside the cue;
    // it does not stretch across the cloth pretending to form a hand bridge.
    const left=mix(v(.3,.78,.1),v(leftX,.875,bridgeZ));
    const right=mix(v(-.3,.77,.08),v(cueX,.885,gripZ));
    limb(bone('L_UpperArm'),bone('L_Forearm'),bone('L_Hand'),left,local(v(cueX+.30,1.02,.60)));
    limb(bone('R_UpperArm'),bone('R_Forearm'),bone('R_Hand'),right,local(v(cueX,elbowY,gripBaseZ)));
    const bridgeForward=v(0,-.008,.12).applyQuaternion(root.quaternion).normalize();
    pointBone(bone('L_Hand'),bone('L_Finger2'),left.clone().add(bridgeForward));
    // Aim alone leaves an arbitrary wrist roll. Keep the finger fan across the
    // cloth so the bridge is a palm-down hand, not a vertical waving hand.
    const fan=bone('L_Finger4').getWorldPosition(new THREE.Vector3()).sub(bone('L_Finger1').getWorldPosition(new THREE.Vector3()));
    fan.addScaledVector(bridgeForward,-fan.dot(bridgeForward)).normalize();
    const across=v(1,0,0).applyQuaternion(root.quaternion);across.addScaledVector(bridgeForward,-across.dot(bridgeForward)).normalize();
    const roll=Math.atan2(bridgeForward.dot(fan.clone().cross(across)),fan.dot(across));
    turnWorld(bone('L_Hand'),new THREE.Quaternion().setFromAxisAngle(bridgeForward,roll));
    // Hang the cueing hand straight down from a vertical forearm: no cocked wrist.
    pointBone(bone('R_Hand'),bone('R_Finger2'),bone('R_Hand').getWorldPosition(new THREE.Vector3()).add(v(0,-1,.12)));
    const hand=bone('R_Hand'),handRotation=hand.getWorldQuaternion(new THREE.Quaternion());
    const wrist=right.clone().sub(hand.localToWorld(gripAnchor.clone()).sub(hand.getWorldPosition(new THREE.Vector3())).multiplyScalar(amount));
    limb(bone('R_UpperArm'),bone('R_Forearm'),hand,wrist,local(v(cueX,elbowY,gripBaseZ)));
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handRotation));
    // The hand rig carries separate finger joints: leave the bridge open, curl the grip.
    for(const side of ['L','R']) for(let finger=1;finger<=4;finger++) for(const suffix of ['', '1','2']) {
      const joint=bone(`${side}_Finger${finger}${suffix}`);
      if(joint)joint.rotateZ((side==='R'||extended ? .7 : .10)*amount);
    }
    for(const side of ['L','R']){
      const thigh=bone(`${side}_Thigh`),calf=bone(`${side}_Calf`),foot=bone(`${side}_Foot`);
      const hip=root.worldToLocal(thigh.getWorldPosition(new THREE.Vector3()));
      const first=thigh.getWorldPosition(new THREE.Vector3()).distanceTo(calf.getWorldPosition(new THREE.Vector3()));
      const second=calf.getWorldPosition(new THREE.Vector3()).distanceTo(foot.getWorldPosition(new THREE.Vector3()));
      const bend=(side==='R'?3:25)*amount*Math.PI/180;
      const reachSquared=first**2+second**2+2*first*second*Math.cos(bend);
      const stride=Math.sqrt(Math.max(0,reachSquared-(hip.y-.10)**2));
      const target=v(hip.x,.10,hip.z+(side==='R'?-1:1)*stride);
      limb(thigh,calf,foot,local(target),local(v(hip.x,.48,hip.z+.5)));
    }
    for(const side of ['L','R']){
      const foot=bone(`${side}_Foot`),parent=foot.parent!.getWorldQuaternion(new THREE.Quaternion());
      foot.quaternion.copy(parent.invert().multiply(root.quaternion).multiply(footRotations.get(side)!));
    }
    root.updateMatrixWorld(true);
    // Keep the stance on the floor; lift/lower both arm chains to follow the cue line.
    root.position.x+=offset.x*amount;root.position.z+=offset.z*amount;
    for(const side of ['L','R']){
      const arm=bone(`${side}_UpperArm`),position=arm.getWorldPosition(new THREE.Vector3());
      position.y+=offset.y*amount;arm.position.copy(arm.parent!.worldToLocal(position));
    }
    root.updateMatrixWorld(true);
    bowTie.visible=true;root.userData.player=player;
    return {distance,extension:cueExtension(distance-gripBaseZ-RADIUS),bridgeDistance:distance-bridgeZ-RADIUS-.060,grip:hand.localToWorld(gripAnchor.clone()),restHandle:bone('L_Hand').getWorldPosition(new THREE.Vector3()),extended};
  }
  return {root,update};
}

export type PlayerAvatar=Awaited<ReturnType<typeof loadPlayerAvatar>>;
