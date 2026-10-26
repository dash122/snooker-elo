import {readFileSync} from 'node:fs';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {rigSnookerPlayer} from '../app/game/PlayerAvatar.ts';
const manager=new T.LoadingManager();manager.addHandler(/\.(tga|png|jpg)$/i,{setPath(){return this;},load(){return new T.Texture();}});
const bytes=readFileSync('public/models/snooker-player/Male_Adult_08.fbx');const model=new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');const avatar=rigSnookerPlayer(model);
function log(label){console.log(label);for(const name of ['L_Hand','L_Finger0','L_Finger1','L_Finger2','L_Finger3','L_Finger4','R_Hand']){const b=model.getObjectByName('Bip01_'+name);if(!b)continue;console.log(name,b.parent.name,b.getWorldPosition(new T.Vector3()).toArray().map(n=>+n.toFixed(3)),b.quaternion.toArray().map(n=>+n.toFixed(3)));}}
log('bind');avatar.update({x:0,z:1.22},0,1,.04,0);log('address');

