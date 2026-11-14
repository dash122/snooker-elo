"use client";
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { rack, type Prediction, type Spin, BAULK_Z, COLOURS, D_RADIUS, LENGTH, POCKETS, RADIUS, WIDTH, type Ball } from '../../lib/snooker-game';
import { TABLE_POCKETS } from '../../lib/snooker-table';
import { CUE_ADDRESS_GAP, CUE_HEIGHT, STROKE_CONTACT_MS, STROKE_END_MS, cueContactOffset, cueFeather, restSupport, cueStroke, type Stroke } from '../../lib/snooker-presentation';
import { createCue } from './Cue';
import { buildTournamentTable } from './TournamentTable';
import { buildCrucibleArena } from './CrucibleArena';
import { loadPlayerAvatar, type PlayerAvatar } from './PlayerAvatar';

export type TableView='aim'|'top'|'tv'|'player';
export type Assist='full'|'guide'|'off';
type Props={balls:Ball[];angle:number;power:number;spin:Spin;view:TableView;aiming:boolean;pulling:boolean;inHand:boolean;showD:boolean;turnKey:number;stroke:Stroke|null;
  prediction:Prediction|null;assist:Assist;potOn:boolean;marker:{x:number;z:number}|null;
  onAim:(angle:number)=>void;onPickBall:(id:number)=>void;onPlace:(x:number,z:number)=>void};
type Point={x:number;z:number};
const wrap=(angle:number)=>((angle+180)%360+360)%360-180;
// Cut a sampled path into the part before `length` metres and the rest.
function splitPath(points:Point[],length:number):[Point[],Point[]]{
  let travelled=0;
  for(let i=1;i<points.length;i++){
    const step=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
    if(travelled+step>=length){
      const k=step?(length-travelled)/step:0,cut={x:points[i-1].x+(points[i].x-points[i-1].x)*k,z:points[i-1].z+(points[i].z-points[i-1].z)*k};
      return [[...points.slice(0,i),cut],[cut,...points.slice(i)]];
    }
    travelled+=step;
  }
  return [points,[]];
}

export default function Table(props:Props) {
  const {aiming,onAim}=props;
  const host=useRef<HTMLDivElement>(null),live=useRef(props);
  const [failed,setFailed]=useState(false);
  const [modelStatus,setModelStatus]=useState('loading');
  useEffect(()=>{live.current=props;});
  useEffect(()=>{
    const element=host.current!;
    let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch{queueMicrotask(()=>setFailed(true));return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;renderer.setClearColor('#100f16');element.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),view=new THREE.PerspectiveCamera(39,1,.01,30);
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scene.fog=new THREE.Fog('#100f16',9,20);
    scene.add(new THREE.HemisphereLight('#e5e8ee','#101018',.22));
    // A prefiltered room supplies real material reflections, especially on balls/rails.
    // Reflections come from what a match table actually sees: a dark arena and a
    // bright rectangular canopy of lights directly overhead. That canopy is the
    // crisp highlight on every ball and on the polished rails.
    const pmrem=new THREE.PMREMGenerator(renderer),room=new THREE.Scene();
    room.add(new THREE.Mesh(new THREE.BoxGeometry(14,7,14),new THREE.MeshBasicMaterial({color:'#17141a',side:THREE.BackSide})));
    const canopy=new THREE.MeshBasicMaterial({color:new THREE.Color(14,13.4,12.4)});
    for(const z of [-.95,.95]){const panel=new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.6),canopy);panel.rotation.x=Math.PI/2;panel.position.set(0,2.6,z);room.add(panel);}
    const rim=new THREE.Mesh(new THREE.BoxGeometry(2.1,.08,4.3),new THREE.MeshBasicMaterial({color:'#060606'}));rim.position.y=2.7;room.add(rim);
    const glow=new THREE.MeshBasicMaterial({color:new THREE.Color(.5,.42,.36)});
    for(const x of [-6.9,6.9]){const wall=new THREE.Mesh(new THREE.PlaneGeometry(12,1.2),glow);wall.rotation.y=x<0?Math.PI/2:-Math.PI/2;wall.position.set(x,1,0);room.add(wall);}
    const environment=pmrem.fromScene(room,.02);
    // Assigned per material, because three.js replaces each material's own
    // envMapIntensity with one scene-wide value when scene.environment is used.
    // Each material's value is read relative to this base: polished balls
    // reflect the canopy strongly, rails and baize barely.
    const ENVIRONMENT=.42,reflective=new WeakSet<THREE.Material>();
    function applyEnvironment(object:THREE.Object3D){
      object.traverse(o=>{
        if(!(o instanceof THREE.Mesh))return;
        for(const m of Array.isArray(o.material)?o.material:[o.material]){
          if(!(m instanceof THREE.MeshStandardMaterial)||m.envMap||reflective.has(m))continue;
          reflective.add(m);m.envMap=environment.texture;m.envMapIntensity*=ENVIRONMENT;m.needsUpdate=true;
        }
      });
    }
    room.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});pmrem.dispose();
    RectAreaLightUniformsLib.init();
    for(const z of [-.95,.95]){
      const panel=new THREE.RectAreaLight('#fff5e4',2.6,1.6,1.5);panel.position.set(0,2.7,z);panel.lookAt(0,0,z);scene.add(panel);
    }
    const light=new THREE.SpotLight('#fff7e8',42,12,.60,.7,2);light.position.set(-.2,4.7,.4);light.target.position.set(0,0,0);
    light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.bias=-.00015;light.shadow.normalBias=.008;light.shadow.radius=3;light.shadow.camera.near=.3;light.shadow.camera.far=9;scene.add(light,light.target);
    const fill=new THREE.DirectionalLight('#d5e2ff',.28);fill.position.set(3,2,4);scene.add(fill);
    let avatar:PlayerAvatar|undefined,cancelled=false;
    function dispose(object:THREE.Object3D){
      const textures=new Set<THREE.Texture>();
      object.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>{Object.values(m).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value);});m.dispose();});}});
      textures.forEach(texture=>texture.dispose());
    }
    loadPlayerAvatar().then(player=>{if(cancelled){dispose(player.root);return;}avatar=player;applyEnvironment(player.root);scene.add(player.root);setModelStatus('ready');}).catch(()=>{if(!cancelled)setModelStatus('error');});
    buildCrucibleArena(scene);
    buildTournamentTable(scene,renderer.capabilities.getMaxAnisotropy());
    const marking=new THREE.LineBasicMaterial({color:'#d9e6cb',transparent:true,opacity:.65});
    function line(points:THREE.Vector3[]){const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),marking);scene.add(l);}
    line([new THREE.Vector3(-WIDTH/2,.004,1.047),new THREE.Vector3(WIDTH/2,.004,1.047)]);
    line(Array.from({length:65},(_,i)=>{const a=i/64*Math.PI;return new THREE.Vector3(Math.cos(a)*.292,.004,1.047+Math.sin(a)*.292);}));
    // Fixed cloth spots remain visible after a colour leaves its home position.
    const spotGeometry=new THREE.CircleGeometry(.006,24);
    const spotMaterial=new THREE.MeshBasicMaterial({color:'#ffffff'});
    for(const ball of rack().filter(ball=>ball.value>=2)){
      const spot=new THREE.Mesh(spotGeometry,spotMaterial);
      spot.rotation.x=-Math.PI/2;spot.position.set(ball.x,.004,ball.z);scene.add(spot);
    }
    // Tight soft contact occlusion anchors each ball to the cloth at every camera angle.
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;
    const shadowCtx=shadowCanvas.getContext('2d')!,shadowGradient=shadowCtx.createRadialGradient(32,32,2,32,32,32);
    shadowGradient.addColorStop(0,'rgba(0,0,0,.44)');shadowGradient.addColorStop(.4,'rgba(0,0,0,.20)');shadowGradient.addColorStop(1,'rgba(0,0,0,0)');shadowCtx.fillStyle=shadowGradient;shadowCtx.fillRect(0,0,64,64);
    const contactMaterial=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false});
    const contacts=live.current.balls.map(()=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(RADIUS*3.6,RADIUS*3.6),contactMaterial);m.rotation.x=-Math.PI/2;scene.add(m);return m;});
    // Phenolic resin balls: hard, mirror-polished, a crisp reflection of the canopy.
    const meshes=live.current.balls.map(b=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(RADIUS,48,32),new THREE.MeshPhysicalMaterial({color:COLOURS[b.value],roughness:.1,metalness:0,clearcoat:1,clearcoatRoughness:.03,envMapIntensity:2.2,ior:1.55}));mesh.castShadow=true;scene.add(mesh);return mesh;});
    // Aiming aids, drawn flat on the cloth: the line to the ghost ball, where the
    // object ball goes, and where the cue ball travels and comes to rest.
    function overlay(color:string,opacity:number,geometry:THREE.BufferGeometry=new THREE.BufferGeometry()){
      const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false}));
      mesh.visible=false;mesh.renderOrder=2;scene.add(mesh);return mesh;
    }
    const flat=(geometry:THREE.BufferGeometry)=>geometry.rotateX(-Math.PI/2);
    const aimLine=overlay('#ffffff',.62),objectLine=overlay('#f6d57a',.9),cueLine=overlay('#ffffff',.34);
    const ghost=overlay('#ffffff',.26,new THREE.SphereGeometry(RADIUS,32,20));
    const ghostRing=overlay('#ffffff',.85,flat(new THREE.RingGeometry(RADIUS*.9,RADIUS,48)));
    const restRing=overlay('#ffffff',.8,flat(new THREE.RingGeometry(RADIUS*.8,RADIUS,48)));
    const restDot=overlay('#ffffff',.22,flat(new THREE.CircleGeometry(RADIUS*.8,32)));
    const pocketGlow=overlay('#ffd96b',.6,flat(new THREE.RingGeometry(.048,.066,48)));
    const coachRing=overlay('#6fe3d2',.9,flat(new THREE.RingGeometry(RADIUS*1.25,RADIUS*1.55,48)));
    const baulkD=overlay('#ffffff',.12,flat(new THREE.CircleGeometry(D_RADIUS,48,Math.PI,Math.PI)));
    baulkD.position.set(0,.0045,BAULK_Z);
    let drawn:Prediction|null=null,drawnAssist='';
    function ribbon(mesh:THREE.Mesh,points:Point[],half:number){
      mesh.visible=points.length>1;if(!mesh.visible)return;
      const vertices:number[]=[],indices:number[]=[];
      points.forEach((p,i)=>{
        const previous=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)];
        const dx=next.x-previous.x,dz=next.z-previous.z,length=Math.hypot(dx,dz)||1;
        for(const side of [-1,1])vertices.push(p.x+side*dz/length*half,.0055,p.z-side*dx/length*half);
        if(i){const n=i*2;indices.push(n-2,n-1,n,n-1,n+1,n);}
      });
      mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();
      mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));mesh.geometry.setIndex(indices);mesh.geometry.computeBoundingSphere();
    }
    function drawGuides(p:Prediction,assist:Assist){
      const [approach,after]=splitPath(p.cuePath,Math.max(0,p.approach-.0005));
      // Start the line at the cue ball's edge so it never hides the ball.
      ribbon(aimLine,splitPath(approach,RADIUS*1.15)[1],.0022);
      ghost.visible=ghostRing.visible=!!p.object;
      ghost.position.set(p.contact.x,RADIUS,p.contact.z);ghostRing.position.set(p.contact.x,.006,p.contact.z);
      ribbon(objectLine,assist==='off'?[]:assist==='guide'?splitPath(p.objectPath,.45)[0]:p.objectPath,.003);
      ribbon(cueLine,assist==='off'?[]:assist==='guide'?splitPath(after,.3)[0]:after,.0022);
      restRing.visible=restDot.visible=assist==='full'&&!p.cueEnd.potted;
      restRing.position.set(p.cueEnd.x,.006,p.cueEnd.z);restDot.position.copy(restRing.position);
    }
    const pocketCentre=(index:number)=>{const [x,z]=POCKETS[index];return {x:z===0?x+Math.sign(x)*TABLE_POCKETS.middleSetback:x,z};};
    const cueModel=createCue(),cue=cueModel.root;scene.add(cue);
    const rest=new THREE.Group();
    const restPole=new THREE.Mesh(new THREE.CylinderGeometry(.005,.008,1,10),new THREE.MeshStandardMaterial({color:'#8a6540'}));rest.add(restPole);
    const restMetal=new THREE.MeshStandardMaterial({color:'#b5a46c',metalness:.7,roughness:.3});
    // Cross-head feet sit on the cloth; the centre saddle touches the cue's underside.
    for(const slope of [-1,1]){
      const start=new THREE.Vector3(-.020,.026-slope*.020,0),end=new THREE.Vector3(.020,.026+slope*.020,0);
      const cross=new THREE.Mesh(new THREE.CylinderGeometry(.003,.003,start.distanceTo(end),10),restMetal);
      cross.position.copy(start).add(end).multiplyScalar(.5);cross.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.clone().sub(start).normalize());rest.add(cross);
    }
    scene.add(rest);
    const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-RADIUS);
    const canvas=renderer.domElement;
    function tablePoint(event:PointerEvent){
      const rect=element.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),view);
      return ray.ray.intersectPlane(plane,new THREE.Vector3());
    }
    function screenPoint(x:number,z:number){
      const p=new THREE.Vector3(x,RADIUS,z),depth=p.distanceTo(view.position);p.project(view);
      return {x:(p.x+1)/2*element.clientWidth,y:(1-p.y)/2*element.clientHeight,visible:p.z<1,
        radius:RADIUS*element.clientHeight/(2*Math.tan(THREE.MathUtils.degToRad(view.fov/2))*depth)};
    }
    function nearBall(event:PointerEvent,ball:Ball,slack:number){
      const rect=element.getBoundingClientRect(),p=screenPoint(ball.x,ball.z);
      return p.visible&&Math.hypot(event.clientX-rect.left-p.x,event.clientY-rect.top-p.y)<Math.max(slack,p.radius*1.5);
    }
    // One gesture model for every camera. Tap a ball to line up its pot; tap
    // the cloth to point there; drag to turn the cue. Drag speed sets the
    // gearing, so a slow drag moves the ghost ball a quarter-millimetre per
    // pixel however far away it is, and a flick swings the cue across the table.
    let drag:{id:number;x:number;y:number;lastX:number;lastY:number;lastTime:number;moved:boolean;placing:boolean}|null=null;
    let frozen:Pose|null=null;
    const down=(event:PointerEvent)=>{
      const state=live.current;
      if(!state.aiming||!event.isPrimary||event.button!==0||drag)return;
      element.focus({preventScroll:true});
      const placing=state.inHand&&nearBall(event,state.balls[0],30);
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,lastTime:event.timeStamp,moved:false,placing};
      canvas.setPointerCapture(event.pointerId);
    };
    const move=(event:PointerEvent)=>{
      const state=live.current;
      if(!drag||drag.id!==event.pointerId||!state.aiming)return;
      if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
      // Hold the camera still while dragging in any view it does not own.
      if(!drag.moved){drag.moved=true;if((drag.placing||mode!=='aim')&&current)frozen=clonePose(current);drag.lastX=event.clientX;drag.lastY=event.clientY;drag.lastTime=event.timeStamp;}
      const dx=event.clientX-drag.lastX,dy=event.clientY-drag.lastY,dt=Math.max(4,event.timeStamp-drag.lastTime);
      drag.lastX=event.clientX;drag.lastY=event.clientY;drag.lastTime=event.timeStamp;
      if(drag.placing){const hit=tablePoint(event);if(hit)state.onPlace(hit.x,hit.z);return;}
      let pixels=dx;
      if(mode!=='aim'){
        // Follow the on-screen direction in which the aim line swings.
        const b=state.balls[0],a=state.angle*Math.PI/180,reach=Math.max(.3,state.prediction?.approach??1);
        const tip=screenPoint(b.x+Math.sin(a)*reach,b.z-Math.cos(a)*reach),swing=screenPoint(b.x+Math.sin(a)*reach+Math.cos(a)*.1,b.z-Math.cos(a)*reach+Math.sin(a)*.1);
        const tx=swing.x-tip.x,ty=swing.y-tip.y,length=Math.hypot(tx,ty);
        pixels=length>0?(dx*tx+dy*ty)/length:dx;
      }
      const speed=Math.hypot(dx,dy)/dt,gear=event.shiftKey?1:Math.max(1,Math.min(16,1+(speed-.12)*26));
      const reach=Math.max(.2,Math.min(3,state.prediction?.approach??1));
      state.onAim(wrap(state.angle+pixels*gear*.00025/reach*180/Math.PI));
    };
    const up=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      const state=live.current,tapped=!drag.moved;
      drag=null;if(frozen){frozen=null;restart();}
      if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      if(!tapped||!state.aiming)return;
      const cueBall=state.balls[0],picked=state.balls.filter(b=>b!==cueBall&&!b.potted&&nearBall(event,b,22))
        .sort((a,b)=>{const rect=element.getBoundingClientRect(),pa=screenPoint(a.x,a.z),pb=screenPoint(b.x,b.z);
          return Math.hypot(event.clientX-rect.left-pa.x,event.clientY-rect.top-pa.y)-Math.hypot(event.clientX-rect.left-pb.x,event.clientY-rect.top-pb.y);})[0];
      if(picked){state.onPickBall(picked.id);return;}
      const hit=tablePoint(event);
      if(hit&&Math.abs(hit.x)<=WIDTH/2&&Math.abs(hit.z)<=LENGTH/2&&Math.hypot(hit.x-cueBall.x,hit.z-cueBall.z)>RADIUS*1.5)
        state.onAim(Math.atan2(hit.x-cueBall.x,cueBall.z-hit.z)*180/Math.PI);
    };
    const cancel=()=>{drag=null;if(frozen){frozen=null;restart();}};
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);
    canvas.addEventListener('pointercancel',cancel);
    canvas.addEventListener('lostpointercapture',cancel);
    let resizeFrame=0;
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);view.aspect=w/h;view.updateProjectionMatrix();});});observer.observe(element);
    // Cameras are poses that glide into one another instead of cutting.
    type Pose={position:THREE.Vector3;quaternion:THREE.Quaternion;fov:number};
    const clonePose=(p:Pose):Pose=>({position:p.position.clone(),quaternion:p.quaternion.clone(),fov:p.fov});
    const probe=new THREE.PerspectiveCamera();
    function pose(position:THREE.Vector3,target:THREE.Vector3,fov:number,up=new THREE.Vector3(0,1,0)):Pose{
      probe.position.copy(position);probe.up.copy(up);probe.lookAt(target);probe.updateMatrixWorld();
      return {position,quaternion:probe.quaternion.clone(),fov};
    }
    // Widen the lens until the whole table, rails included, is in shot.
    function fitted(p:Pose,margin:number):Pose{
      probe.position.copy(p.position);probe.quaternion.copy(p.quaternion);probe.updateMatrixWorld();
      let tangent=0;
      for(const x of [-WIDTH/2-.2,WIDTH/2+.2])for(const z of [-LENGTH/2-.2,LENGTH/2+.2])for(const y of [0,.08]){
        const c=new THREE.Vector3(x,y,z).applyMatrix4(probe.matrixWorldInverse);
        tangent=Math.max(tangent,Math.abs(c.y)/-c.z,Math.abs(c.x)/(-c.z*view.aspect));
      }
      return {...p,fov:THREE.MathUtils.radToDeg(2*Math.atan(tangent*margin))};
    }
    let mode:TableView='tv',current:Pose|null=null as Pose|null,from:Pose|null=null,changed=0,modeKey='',reachSmooth=1;
    const restart=()=>{if(current){from=clonePose(current);changed=performance.now();}};
    let frame=0,previousRender=performance.now();
    let featherStarted=performance.now(),wasAiming=false,lastStroke=-1,strokeSeen=0,initialWithdrawal=CUE_ADDRESS_GAP,lastWithdrawal=CUE_ADDRESS_GAP;
    const sinking=new Map<number,{at:number;x:number;z:number}>(),wasPotted=live.current.balls.map(b=>b.potted);
    function render(){
      const now=performance.now(),renderDt=Math.min((now-previousRender)/1000,.05);previousRender=now;
      const state=live.current,portrait=view.aspect<1;
      const elapsed=state.stroke?now-state.stroke.startedAt:Infinity;
      const performing=!state.aiming&&state.stroke!==null&&elapsed<STROKE_END_MS;
      const origin=state.aiming?state.balls[0]:state.stroke?.origin??state.balls[0];
      const angle=state.aiming?state.angle:state.stroke?.angle??state.angle;
      const b=origin,a=angle*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a);
      // Stay behind the cue through your own delivery, then pull out to watch.
      mode=state.view==='tv'&&state.stroke?.player===0&&elapsed<STROKE_CONTACT_MS+140?'aim':state.view;
      const reach=Math.max(.3,Math.min(2.4,state.prediction?.approach??reachSmooth));
      reachSmooth+=(reach-reachSmooth)*(reducedMotion?1:1-Math.exp(-renderDt*4));
      let target:Pose;
      if(mode==='aim'){
        // Over the cue, high enough to read the angle into the pocket; the
        // further the object ball, the higher and further back we sit.
        // The cue ball sits low in frame (clear of the controls), the pocket high.
        const d=reachSmooth,back=portrait?.63+.3*d:.62+.18*d,height=portrait?.45+.25*d:.34+.2*d,ahead=portrait?.25+.32*d:.2+.17*d;
        target=pose(new THREE.Vector3(b.x-dx*back,height,b.z-dz*back),new THREE.Vector3(b.x+dx*ahead,0,b.z+dz*ahead),portrait?50:36);
      }else if(mode==='player'){
        const playerFov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(21))/Math.min(1,view.aspect)));
        target=pose(new THREE.Vector3(b.x-dx*1.7-dz*2.5,1.35,b.z-dz*1.7+dx*2.5),new THREE.Vector3(b.x-dx*.65,-.03,b.z-dz*.65),playerFov);
      }else if(mode==='top'){
        target=fitted(pose(new THREE.Vector3(0,7.5,0),new THREE.Vector3(0,0,0),30,portrait?new THREE.Vector3(0,0,-1):new THREE.Vector3(-1,0,0)),portrait?1.16:1.3);
      }else{
        target=portrait?fitted(pose(new THREE.Vector3(0,6.6,1.9),new THREE.Vector3(0,0,-.12),40),1.1)
          :fitted(pose(new THREE.Vector3(0,3.3,4.7),new THREE.Vector3(0,0,.3),39),1.12);
      }
      const key=mode+'|'+state.turnKey;
      if(key!==modeKey){modeKey=key;restart();}
      if(!current){current=clonePose(target);from=null;}
      const k=from&&!reducedMotion?Math.min(1,(now-changed)/850):1,ease=k*k*(3-2*k);
      if(frozen)current=clonePose(frozen);
      else if(k>=1||!from){current=clonePose(target);from=null;}
      else current={position:from.position.clone().lerp(target.position,ease),quaternion:from.quaternion.clone().slerp(target.quaternion,ease),fov:from.fov+(target.fov-from.fov)*ease};
      view.position.copy(current.position);view.quaternion.copy(current.quaternion);view.fov=current.fov;view.updateProjectionMatrix();view.updateMatrixWorld();
      state.balls.forEach((ball,i)=>{
        const mesh=meshes[i];
        if(ball.potted&&!wasPotted[i])sinking.set(i,{at:now,x:ball.x,z:ball.z});
        wasPotted[i]=ball.potted;
        const sink=ball.potted?sinking.get(i):undefined,fall=sink?(now-sink.at)/260:1;
        contacts[i].visible=!ball.potted;contacts[i].position.set(ball.x,.001,ball.z);
        if(sink&&fall<1&&ball.pocket!==undefined&&ball.pocket>=0){
          // Roll over the lip and drop, rather than vanishing.
          const centre=pocketCentre(ball.pocket);
          mesh.visible=true;mesh.position.set(sink.x+(centre.x-sink.x)*fall,RADIUS-fall*fall*.1,sink.z+(centre.z-sink.z)*fall);
        }else{
          mesh.visible=!ball.potted;mesh.position.set(ball.x,RADIUS,ball.z);
          mesh.rotation.x+=(ball.wx??ball.vz/RADIUS)*renderDt;mesh.rotation.z+=(ball.wz??-ball.vx/RADIUS)*renderDt;mesh.rotation.y+=(ball.wy??0)*renderDt;
        }
      });
      if(state.aiming&&!wasAiming)featherStarted=now;
      wasAiming=state.aiming;
      if(state.stroke&&state.stroke.id!==lastStroke){lastStroke=state.stroke.id;initialWithdrawal=lastWithdrawal;strokeSeen=now;}
      const shotPower=performing?state.stroke!.power:state.power;
      // Pulling the power bar draws the cue back exactly as far as the stroke will.
      const pulled=CUE_ADDRESS_GAP+.065+.135*Math.max(0,Math.min(1,state.power/100));
      // A stroke may start part-way through the routine; ease in from wherever the cue was.
      const blend=THREE.MathUtils.smoothstep(now-strokeSeen,0,160);
      const withdrawal=performing?initialWithdrawal+(cueStroke(elapsed,shotPower,initialWithdrawal)-initialWithdrawal)*blend:state.aiming&&state.pulling?lastWithdrawal+(pulled-lastWithdrawal)*Math.min(1,renderDt*18)
        :state.aiming&&!reducedMotion&&!drag?cueFeather(now-featherStarted,Math.min(shotPower,40)):CUE_ADDRESS_GAP;
      lastWithdrawal=withdrawal;
      const address=state.aiming?1:state.stroke?1-THREE.MathUtils.smoothstep(elapsed,STROKE_END_MS,STROKE_END_MS+400):0;
      const shotSpin=state.aiming?state.spin:state.stroke?.spin??{top:0,side:0};
      const offset=cueContactOffset(angle,shotSpin);
      const contactDepth=Math.sqrt(Math.max(0,RADIUS**2-offset.x**2-offset.z**2-(CUE_HEIGHT+offset.y-RADIUS)**2));
      const avatarPose=avatar?.update(origin,angle,address,withdrawal+contactDepth-RADIUS,state.aiming?0:state.stroke?.player??0,shotPower,offset);
      if(avatar)avatar.root.visible=mode!=='aim';
      cue.visible=state.aiming||performing;
      // Guides follow the prediction the HUD already computed for this aim.
      const guide=state.aiming?state.prediction:null;
      if(guide!==drawn||state.assist!==drawnAssist){
        drawn=guide;drawnAssist=state.assist;
        if(guide)drawGuides(guide,state.assist);
        else for(const mesh of [aimLine,objectLine,cueLine,ghost,ghostRing,restRing,restDot])mesh.visible=false;
      }
      const pulse=reducedMotion?.75:.6+.3*Math.sin(now/260);
      pocketGlow.visible=!!guide&&state.assist==='full'&&state.potOn&&guide.objectPocket>=0;
      if(pocketGlow.visible){const centre=pocketCentre(guide!.objectPocket);pocketGlow.position.set(centre.x,.04,centre.z);(pocketGlow.material as THREE.MeshBasicMaterial).opacity=pulse;}
      coachRing.visible=state.aiming&&!!state.marker;
      if(coachRing.visible){coachRing.position.set(state.marker!.x,.0065,state.marker!.z);(coachRing.material as THREE.MeshBasicMaterial).opacity=pulse;}
      baulkD.visible=state.aiming&&state.showD;
      cueModel.setExtension(avatarPose?.extension??0);
      // Contact lies on the spherical surface, closer to the centre plane for off-centre hits.
      cue.position.set(b.x+offset.x-dx*(contactDepth+withdrawal),CUE_HEIGHT+offset.y,b.z+offset.z-dz*(contactDepth+withdrawal));cue.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(dx,0,dz));
      rest.visible=!!avatarPose?.extended&&cue.visible&&mode!=='aim';
      if(rest.visible&&avatarPose){
        const support=restSupport(b,angle);
        rest.position.set(support.x+offset.x,offset.y,support.z+offset.z);rest.rotation.y=Math.atan2(dx,dz);rest.updateMatrixWorld(true);
        const handle=rest.worldToLocal(avatarPose.restHandle.clone()),head=new THREE.Vector3(0,.014,-.012),shaft=head.clone().sub(handle);
        restPole.scale.y=shaft.length();restPole.position.copy(handle).add(head).multiplyScalar(.5);
        restPole.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),shaft.normalize());
      }
      renderer.render(scene,view);frame=requestAnimationFrame(render);
    }
    applyEnvironment(scene);
    render();
    const lost=(event:Event)=>{event.preventDefault();setFailed(true);cancelAnimationFrame(frame);};renderer.domElement.addEventListener('webglcontextlost',lost);
    return()=>{cancelled=true;cancelAnimationFrame(frame);cancelAnimationFrame(resizeFrame);observer.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);renderer.domElement.removeEventListener('webglcontextlost',lost);dispose(scene);environment.dispose();renderer.dispose();renderer.domElement.remove();};
  },[]);
  return <div className="snooker-table" ref={host} role="group" tabIndex={0} aria-label="3D 球檯瞄準" aria-disabled={!aiming} aria-describedby="table-aim-help" onKeyDown={event=>{
    if(!aiming||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();
    onAim(wrap(live.current.angle+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey ? .01 : .1)));
  }}>{modelStatus!=='ready'&&!failed&&<span className="snooker-model-status" role="status">{modelStatus==='loading'?'球員載入中…':'球員載入失敗，請重新載入頁面。'}</span>}{failed&&<div className="snooker-webgl-error" role="alert">未能顯示 3D 球檯。請啟用瀏覽器硬件加速，然後重新載入。</div>}</div>;
}

