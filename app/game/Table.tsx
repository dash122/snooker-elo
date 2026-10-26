"use client";
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { swipeAim } from '../../lib/snooker-aim';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { predictShot, rack, type Spin, COLOURS, LENGTH, RADIUS, WIDTH, type Ball } from '../../lib/snooker-game';
import { CUE_ADDRESS_GAP, CUE_HEIGHT, STROKE_END_MS, cueContactOffset, cueFeather, restSupport, cueStroke, type Stroke } from '../../lib/snooker-presentation';
import { createCue } from './Cue';
import { buildTournamentTable } from './TournamentTable';
import { loadPlayerAvatar, type PlayerAvatar } from './PlayerAvatar';

export default function Table({balls,angle,power,spin,camera,precise,aiming,stroke,onAim}:{balls:Ball[];angle:number;power:number;spin:Spin;camera:string;precise:boolean;aiming:boolean;stroke:Stroke|null;onAim:(angle:number)=>void}) {
  const host=useRef<HTMLDivElement>(null),live=useRef({balls,angle,power,spin,camera,precise,aiming,stroke,onAim});
  const [failed,setFailed]=useState(false);
  const [modelStatus,setModelStatus]=useState('loading');
  useEffect(()=>{live.current={balls,angle,power,spin,camera,precise,aiming,stroke,onAim};},[balls,angle,power,spin,camera,precise,aiming,stroke,onAim]);
  useEffect(()=>{
    const element=host.current!;
    let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true});}catch{queueMicrotask(()=>setFailed(true));return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;renderer.setClearColor('#100f16');element.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),view=new THREE.PerspectiveCamera(39,1,.01,30);
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scene.fog=new THREE.Fog('#100f16',7,18);
    scene.add(new THREE.HemisphereLight('#e5e8ee','#101018',.22));
    // A prefiltered room supplies real material reflections, especially on balls/rails.
    const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
    const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.32;
    room.dispose();pmrem.dispose();
    RectAreaLightUniformsLib.init();
    for(const z of [-.95,.95]){
      const panel=new THREE.RectAreaLight('#fff5e4',2.6,1.6,1.5);panel.position.set(0,2.7,z);panel.lookAt(0,0,z);scene.add(panel);
    }
    const light=new THREE.SpotLight('#fff7e8',42,12,.60,.7,2);light.position.set(-.2,4.7,.4);light.target.position.set(0,0,0);
    light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.bias=-.00004;light.shadow.normalBias=.003;light.shadow.camera.near=.3;light.shadow.camera.far=9;scene.add(light,light.target);
    const fill=new THREE.DirectionalLight('#d5e2ff',.28);fill.position.set(3,2,4);scene.add(fill);
    let avatar:PlayerAvatar|undefined,cancelled=false;
    function dispose(object:THREE.Object3D){
      const textures=new Set<THREE.Texture>();
      object.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>{Object.values(m).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value);});m.dispose();});}});
      textures.forEach(texture=>texture.dispose());
    }
    loadPlayerAvatar().then(player=>{if(cancelled){dispose(player.root);return;}avatar=player;scene.add(player.root);setModelStatus('ready');}).catch(()=>{if(!cancelled)setModelStatus('error');});
    function box(w:number,h:number,d:number,x:number,y:number,z:number,colour:string,roughness=.6) {
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color:colour,roughness}));mesh.position.set(x,y,z);mesh.receiveShadow=true;mesh.castShadow=true;scene.add(mesh);return mesh;
    }
    box(18,.1,18,0,-.90,0,'#252b34');
    box(6.4,.035,7.5,0,-.78,0,'#293641');
    box(18,7,.2,0,2,-8,'#17131d');
    for(let panel=-8;panel<=8;panel+=.45)box(.18,6,.15,panel,2,-7.85,'#322333');
    // Instancing keeps the surrounding audience inexpensive on mobile GPUs.
    const seats=new THREE.InstancedMesh(new THREE.BoxGeometry(.36,.48,.16),new THREE.MeshStandardMaterial({color:'#351524',roughness:.95,envMapIntensity:.12}),240);
    const bodies=new THREE.InstancedMesh(new THREE.CapsuleGeometry(.105,.25,3,6),new THREE.MeshStandardMaterial({color:'#101116',roughness:1,envMapIntensity:.12}),240);
    const heads=new THREE.InstancedMesh(new THREE.SphereGeometry(.075,8,6),new THREE.MeshStandardMaterial({color:'#6a5046',roughness:1,envMapIntensity:.12}),240);
    const dummy=new THREE.Object3D();let count=0;
    for(let row=0;row<5;row++)for(let i=0;i<48;i++){
      const theta=Math.PI*.07+i/47*Math.PI*1.86,r=4.4+row*.56,x=Math.sin(theta)*r,z=-Math.cos(theta)*r,y=-.35+row*.40;
      dummy.position.set(x,y,z);dummy.rotation.set(0,theta,0);dummy.updateMatrix();seats.setMatrixAt(count,dummy.matrix);
      dummy.position.set(x,y+.07,z+.10);dummy.updateMatrix();bodies.setMatrixAt(count,dummy.matrix);
      dummy.position.y=y+.36;dummy.updateMatrix();heads.setMatrixAt(count++,dummy.matrix);
    }
    scene.add(seats,bodies,heads);
    for(let row=0;row<5;row++){
      const tier=new THREE.Mesh(new THREE.RingGeometry(4.1+row*.56,4.67+row*.56,96),new THREE.MeshStandardMaterial({color:'#24232b',side:THREE.DoubleSide,roughness:1}));
      tier.rotation.x=-Math.PI/2;tier.position.y=-.65+row*.4;scene.add(tier);
    }
    for(const x of [-3.3,3.3])box(.12,.55,6.6,x,-.48,0,'#113e40');
    box(6.6,.55,.12,0,-.48,-3.5,'#113e40');
    const signCanvas=document.createElement('canvas');signCanvas.width=1024;signCanvas.height=128;
    const ctx=signCanvas.getContext('2d')!;ctx.fillStyle='#113e40';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#e5c681';ctx.font='500 48px Georgia';ctx.textAlign='center';ctx.fillText('S N O O K E R   E L O',512,82);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(4.8,.6),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(signCanvas)}));sign.position.set(0,.1,-3.42);scene.add(sign);
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
    const meshes=live.current.balls.map(b=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(RADIUS,40,28),new THREE.MeshPhysicalMaterial({color:COLOURS[b.value],roughness:.12,metalness:0,clearcoat:.8,clearcoatRoughness:.08}));mesh.castShadow=true;scene.add(mesh);return mesh;});
    const aim=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:'#f7df9a',dashSize:.045,gapSize:.03,transparent:true,opacity:.7}));scene.add(aim);
    const objectAim=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#f7df9a'}));scene.add(objectAim);
    const cueAim=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:'#ffffff',dashSize:.035,gapSize:.025}));scene.add(cueAim);
    const ghost=new THREE.Mesh(new THREE.TorusGeometry(RADIUS,.002,6,32),new THREE.MeshBasicMaterial({color:'#f7df9a'}));ghost.rotation.x=-Math.PI/2;scene.add(ghost);
    let predictionKey='';
    const landing=new THREE.Mesh(new THREE.TorusGeometry(RADIUS,.003,8,40),new THREE.MeshBasicMaterial({color:'#ffffff'}));landing.rotation.x=-Math.PI/2;scene.add(landing);
    let landingPotted=false;
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
    const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
    const pointer=(event:PointerEvent)=>{if(!live.current.aiming)return;const rect=element.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),view);const hit=ray.ray.intersectPlane(plane,new THREE.Vector3());if(hit&&Math.abs(hit.x)<=WIDTH/2&&Math.abs(hit.z)<=LENGTH/2){const b=live.current.balls[0];if(Math.hypot(hit.x-b.x,hit.z-b.z)<=RADIUS)return;live.current.angle=Math.atan2(hit.x-b.x,b.z-hit.z)*180/Math.PI;live.current.onAim(live.current.angle);}};
    const canvas=renderer.domElement;
    let drag:{id:number;camera:THREE.PerspectiveCamera;x:number;y:number;lastX:number;lastY:number;moved:boolean}|null=null;
    const down=(event:PointerEvent)=>{
      if(!live.current.aiming||!event.isPrimary||event.button!==0||drag)return;
      element.focus({preventScroll:true});
      drag={id:event.pointerId,camera:view.clone(),x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false};
      canvas.setPointerCapture(event.pointerId);
    };
    // Tap selects a direction; dragging adjusts the existing aim without a jump.
    // Project the positive rotation tangent so movement follows the visible aim in every camera.
    const move=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId||!live.current.aiming)return;
      if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;
      drag.moved=true;
      if(live.current.camera==='firstPerson'){
        const next=swipeAim(live.current.angle,event.clientX-drag.lastX,element.clientWidth,live.current.precise||event.shiftKey);
        live.current.angle=((next+180)%360+360)%360-180;
        live.current.onAim(live.current.angle);
        drag.lastX=event.clientX;drag.lastY=event.clientY;
        return;
      }
      const b=live.current.balls[0],a=live.current.angle*Math.PI/180;
      const origin=new THREE.Vector3(b.x,.035,b.z).project(drag.camera);
      const tangent=new THREE.Vector3(b.x+Math.cos(a),.035,b.z+Math.sin(a)).project(drag.camera);
      const tx=(tangent.x-origin.x)*element.clientWidth,ty=-(tangent.y-origin.y)*element.clientHeight;
      const length=Math.hypot(tx,ty);
      if(length>0){
        const delta=((event.clientX-drag.lastX)*tx+(event.clientY-drag.lastY)*ty)/length;
        const next=live.current.angle+delta*((event.shiftKey||live.current.precise) ? .001 : .01);
        live.current.angle=((next+180)%360+360)%360-180;
        live.current.onAim(live.current.angle);
      }
      drag.lastX=event.clientX;drag.lastY=event.clientY;
    };
    const up=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      if(drag.moved)move(event);else if(live.current.camera!=='firstPerson')pointer(event);
      drag=null;
      if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    };
    const cancel=()=>{drag=null;};
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);
    canvas.addEventListener('pointercancel',cancel);
    canvas.addEventListener('lostpointercapture',cancel);
    let resizeFrame=0;
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);view.aspect=w/h;view.updateProjectionMatrix();});});observer.observe(element);
    let frame=0,previousRender=performance.now(),displayAngle=live.current.angle;
    let featherStarted=performance.now(),wasAiming=false,lastStroke=-1,initialWithdrawal=CUE_ADDRESS_GAP,lastWithdrawal=CUE_ADDRESS_GAP;
    function render(){
      const now=performance.now(),renderDt=Math.min((now-previousRender)/1000,.05);previousRender=now;
      const input=live.current;
      // Ease cue, camera and prediction together along the shortest arc.
      const targetAngle=input.aiming?input.angle:input.stroke?.angle??input.angle;
      const delta=((targetAngle-displayAngle+180)%360+360)%360-180;
      displayAngle=input.camera==='firstPerson'&&input.aiming&&!reducedMotion
        ?displayAngle+delta*(1-Math.exp(-renderDt/.055)):targetAngle;
      if(Math.abs(delta)<.0001)displayAngle=targetAngle;
      const state={...input,angle:displayAngle};
      const cameraOrigin=state.aiming?state.balls[0]:state.stroke?.origin??state.balls[0];
      const cameraAngle=(state.aiming?state.angle:state.stroke?.angle??state.angle)*Math.PI/180;
      const firstPerson=state.camera==='firstPerson';
      if(firstPerson){
        const dx=Math.sin(cameraAngle),dz=-Math.cos(cameraAngle);
        view.position.set(cameraOrigin.x-dx*.65,.24,cameraOrigin.z-dz*.65);
        view.lookAt(cameraOrigin.x+dx*1.2,.035,cameraOrigin.z+dz*1.2);
      }else if(state.camera==='player'){
        const dx=Math.sin(cameraAngle),dz=-Math.cos(cameraAngle);
        view.position.set(cameraOrigin.x-dx*1.7-dz*2.5,1.35,cameraOrigin.z-dz*1.7+dx*2.5);
        view.lookAt(cameraOrigin.x-dx*.65,-.03,cameraOrigin.z-dz*.65);
      }else {view.position.set(0,state.camera==='overhead'?7.5:3.5,state.camera==='overhead'?.001:4.9);view.lookAt(0,0,state.camera==='overhead'?0:.25);}
      // Fit all eight table bounds in portrait, in either camera, with a 10% margin.
      view.updateMatrixWorld();
      let tangent=0;
      if(view.aspect<1) for(const x of [-WIDTH/2-.55,WIDTH/2+.55]) for(const z of [-LENGTH/2-.65,LENGTH/2+.65]) for(const y of [-.85,.25]) {
        const p=new THREE.Vector3(x,y,z).applyMatrix4(view.matrixWorldInverse);
        tangent=Math.max(tangent,Math.abs(p.y)/-p.z,Math.abs(p.x)/(-p.z*view.aspect));
      }
      const playerFov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(21))/Math.min(1,view.aspect)));
      view.fov=firstPerson||state.camera==='player'?playerFov:view.aspect<1?THREE.MathUtils.radToDeg(2*Math.atan(tangent*1.1)):39;view.updateProjectionMatrix();
      state.balls.forEach((b,i)=>{const mesh=meshes[i];contacts[i].visible=!b.potted;contacts[i].position.set(b.x,.001,b.z);mesh.visible=!b.potted;mesh.position.set(b.x,RADIUS,b.z);mesh.rotation.x+=(b.wx??b.vz/RADIUS)*renderDt;mesh.rotation.z+=(b.wz??-b.vx/RADIUS)*renderDt;mesh.rotation.y+=(b.wy??0)*renderDt;});
      const elapsed=state.stroke?performance.now()-state.stroke.startedAt:Infinity;
      const performing=!state.aiming&&state.stroke!==null&&elapsed<STROKE_END_MS;
      const origin=state.aiming?state.balls[0]:state.stroke?.origin??state.balls[0];
      const angle=state.aiming?state.angle:state.stroke?.angle??state.angle;
      const b=origin,a=angle*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a);
      if(state.aiming&&!wasAiming)featherStarted=now;
      wasAiming=state.aiming;
      if(state.stroke&&state.stroke.id!==lastStroke){lastStroke=state.stroke.id;initialWithdrawal=lastWithdrawal;}
      const shotPower=performing?state.stroke!.power:state.power;
      const withdrawal=performing?cueStroke(elapsed,shotPower,initialWithdrawal):state.aiming&&!reducedMotion?cueFeather(now-featherStarted,shotPower):CUE_ADDRESS_GAP;
      lastWithdrawal=withdrawal;
      const address=state.aiming?1:state.stroke?1-THREE.MathUtils.smoothstep(elapsed,STROKE_END_MS,STROKE_END_MS+400):0;
      const shotSpin=state.aiming?state.spin:state.stroke?.spin??{top:0,side:0};
      const offset=cueContactOffset(angle,shotSpin);
      const contactDepth=Math.sqrt(Math.max(0,RADIUS**2-offset.x**2-offset.z**2-(CUE_HEIGHT+offset.y-RADIUS)**2));
      const pose=avatar?.update(origin,angle,address,withdrawal+contactDepth-RADIUS,state.aiming?0:state.stroke?.player??0,shotPower,offset);
      if(avatar)avatar.root.visible=!firstPerson;
      if(state.camera==='player'&&avatar){
        const player=avatar.root.position;
        view.position.set(player.x+dx*.3-dz*2.5,1.35,player.z+dz*.3+dx*2.5);
        view.lookAt(player.x+dx*.45,-.03,player.z+dz*.45);
      }
      aim.visible=state.aiming;cue.visible=state.aiming||performing;
      objectAim.visible=cueAim.visible=ghost.visible=state.aiming;
      landing.visible=state.aiming&&!landingPotted;
      const key=`${state.angle}:${state.power}:${state.spin.top}:${state.spin.side}:${state.balls.map(b=>`${b.x},${b.z},${b.potted}`).join(';')}`;
      if(state.aiming&&key!==predictionKey){
        predictionKey=key;const prediction=predictShot(state.balls,state.angle,state.power,state.spin);
        landingPotted=prediction.cueEnd.potted;landing.visible=!landingPotted;
        landing.position.set(prediction.cueEnd.x,.038,prediction.cueEnd.z);
        ghost.position.set(prediction.contact.x,.035,prediction.contact.z);
        const update=(line:THREE.Line,points:{x:number;z:number}[])=>{line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,.036,p.z)));line.computeLineDistances();};
        update(objectAim,prediction.object?[prediction.object,...prediction.objectPath]:[]);update(cueAim,prediction.cuePath);
        const positions=aim.geometry.attributes.position as THREE.BufferAttribute;positions.setXYZ(0,b.x,.035,b.z);positions.setXYZ(1,prediction.contact.x,.035,prediction.contact.z);positions.needsUpdate=true;aim.computeLineDistances();
      }
      cueModel.setExtension(pose?.extension??0);
      // Contact lies on the spherical surface, closer to the centre plane for off-centre hits.
      cue.position.set(b.x+offset.x-dx*(contactDepth+withdrawal),CUE_HEIGHT+offset.y,b.z+offset.z-dz*(contactDepth+withdrawal));cue.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(dx,0,dz));
      rest.visible=!!pose?.extended&&cue.visible;
      if(rest.visible&&pose){
        const support=restSupport(b,angle);
        rest.position.set(support.x+offset.x,offset.y,support.z+offset.z);rest.rotation.y=Math.atan2(dx,dz);rest.updateMatrixWorld(true);
        const handle=rest.worldToLocal(pose.restHandle.clone()),head=new THREE.Vector3(0,.014,-.012),shaft=head.clone().sub(handle);
        restPole.scale.y=shaft.length();restPole.position.copy(handle).add(head).multiplyScalar(.5);
        restPole.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),shaft.normalize());
      }
      if(drag&&state.aiming&&!firstPerson){view.position.copy(drag.camera.position);view.quaternion.copy(drag.camera.quaternion);view.fov=drag.camera.fov;view.updateProjectionMatrix();view.updateMatrixWorld();}
      renderer.render(scene,view);frame=requestAnimationFrame(render);
    }
    render();
    const lost=(event:Event)=>{event.preventDefault();setFailed(true);cancelAnimationFrame(frame);};renderer.domElement.addEventListener('webglcontextlost',lost);
    return()=>{cancelled=true;cancelAnimationFrame(frame);cancelAnimationFrame(resizeFrame);observer.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);renderer.domElement.removeEventListener('webglcontextlost',lost);dispose(scene);environment.dispose();renderer.dispose();renderer.domElement.remove();};
  },[]);
  return <div className="snooker-table" ref={host} role="group" tabIndex={0} aria-label="3D 球檯瞄準" aria-disabled={!aiming} aria-describedby="table-aim-help" onKeyDown={event=>{
    if(!aiming||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();
    const next=live.current.angle+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey ? .01 : .1);
    live.current.angle=((next+180)%360+360)%360-180;
    onAim(live.current.angle);
  }}>{modelStatus!=='ready'&&!failed&&<span className="snooker-model-status" role="status">{modelStatus==='loading'?'球員載入中…':'球員載入失敗，請重新載入頁面。'}</span>}{failed&&<div className="snooker-webgl-error" role="alert">未能顯示 3D 球檯。請啟用瀏覽器硬件加速，然後重新載入。</div>}</div>;
}

