import * as THREE from 'three';
import { CUE_LENGTH, CUE_TIP_RADIUS, CUE_BUTT_RADIUS } from '../../lib/snooker-presentation.ts';

/** Cue-local +Y points towards the ball. The tip is at zero, butt at -58 inches. */
export function createCue(){
  const root=new THREE.Group();
  const ash=new THREE.MeshStandardMaterial({color:'#cfb579',roughness:.42});
  const ebony=new THREE.MeshPhysicalMaterial({color:'#19140f',roughness:.30,clearcoat:.35});
  function section(length:number,front:number,tipRadius:number,buttRadius:number,material:THREE.Material){
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(tipRadius,buttRadius,length,20),material);
    mesh.position.y=-front-length/2;mesh.castShadow=true;root.add(mesh);return mesh;
  }
  section(.003,0,CUE_TIP_RADIUS,CUE_TIP_RADIUS,new THREE.MeshStandardMaterial({color:'#456461',roughness:.95}));
  section(.008,.003,CUE_TIP_RADIUS,CUE_TIP_RADIUS,new THREE.MeshStandardMaterial({color:'#a39363',metalness:.65,roughness:.35}));
  section(1.09,.011,CUE_TIP_RADIUS,.009,ash);
  section(CUE_LENGTH-1.101,1.101,.009,CUE_BUTT_RADIUS,ebony);
  // Fine longitudinal ash markings give the shaft a readable taper and grain.
  const grain:number[]=[];
  for(let i=0;i<7;i++){
    const angle=i/7*Math.PI*2;
    for(let j=0;j<14;j++){
      for(const k of [j,j+1]){
        const t=k/14,r=CUE_TIP_RADIUS+(.009-CUE_TIP_RADIUS)*t+.00001;
        grain.push(Math.cos(angle+Math.sin(t*9+i)*.10)*r,-.011-t*1.09,Math.sin(angle+Math.sin(t*9+i)*.10)*r);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(grain,3));
  root.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#967b45',transparent:true,opacity:.28})));
  const extension=section(1,CUE_LENGTH,.012,.014,ebony);extension.visible=false;
  const joint=section(.008,CUE_LENGTH-.004,CUE_BUTT_RADIUS,CUE_BUTT_RADIUS,new THREE.MeshStandardMaterial({color:'#a39363',metalness:.65,roughness:.35}));
  function setExtension(length:number){
    extension.visible=joint.visible=length>0;
    extension.scale.y=length;extension.position.y=-CUE_LENGTH-length/2;
  }
  setExtension(0);
  return {root,setExtension};
}

