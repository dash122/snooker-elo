/* Synthesised table sounds: no assets, nothing to download. Ball clicks, cushion
   thuds, the cue's tap and the drop into a pocket, scaled by impact speed. */
type Kind='ball'|'cushion'|'pocket'|'cue';
export function createSound(){
  let context:AudioContext|null=null,enabled=true,noise:AudioBuffer|null=null;
  const last:Record<Kind,number>={ball:0,cushion:0,pocket:0,cue:0};
  function unlock(){
    if(!enabled)return;
    try{
      context??=new AudioContext();
      if(context.state==='suspended')void context.resume();
    }catch{context=null;}
  }
  function burst(ctx:AudioContext,frequency:number,q:number,gain:number,duration:number){
    if(!noise){
      noise=ctx.createBuffer(1,ctx.sampleRate*.4,ctx.sampleRate);
      const data=noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    }
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),volume=ctx.createGain(),now=ctx.currentTime;
    source.buffer=noise;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=q;
    volume.gain.setValueAtTime(gain,now);volume.gain.exponentialRampToValueAtTime(.0001,now+duration);
    source.connect(filter).connect(volume).connect(ctx.destination);source.start(now);source.stop(now+duration+.02);
  }
  function tone(ctx:AudioContext,frequency:number,gain:number,duration:number){
    const oscillator=ctx.createOscillator(),volume=ctx.createGain(),now=ctx.currentTime;
    oscillator.frequency.setValueAtTime(frequency,now);oscillator.frequency.exponentialRampToValueAtTime(frequency*.6,now+duration);
    volume.gain.setValueAtTime(gain,now);volume.gain.exponentialRampToValueAtTime(.0001,now+duration);
    oscillator.connect(volume).connect(ctx.destination);oscillator.start(now);oscillator.stop(now+duration+.02);
  }
  function impact(kind:Kind,speed:number){
    const ctx=context;if(!enabled||!ctx||ctx.state!=='running')return;
    const now=performance.now(),level=Math.min(1,Math.max(0,speed)/3);
    if(now-last[kind]<28||(kind!=='pocket'&&level<.01))return;last[kind]=now;
    if(kind==='ball'){burst(ctx,3200,1.4,.05+.5*level,.035);tone(ctx,2100,.03+.2*level,.03);}
    else if(kind==='cue'){burst(ctx,1500,1,.08+.3*level,.05);tone(ctx,620,.04+.12*level,.05);}
    else if(kind==='cushion'){burst(ctx,260,.8,.06+.4*level,.09);}
    else{tone(ctx,150,.28,.2);burst(ctx,520,.7,.2,.22);}
  }
  return {unlock,impact,setEnabled(value:boolean){enabled=value;}};
}
