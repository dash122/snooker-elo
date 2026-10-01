/** Horizontal, automatically activated tabs; disabled options never receive keyboard focus. */
export function nextTabValue(items:readonly {value:string;disabled?:boolean}[],current:string,key:string):string|null{
  const enabled=items.filter(item=>!item.disabled);
  if(!enabled.length)return null;
  if(key==="Home")return enabled[0].value;
  if(key==="End")return enabled[enabled.length-1].value;
  if(key!=="ArrowRight"&&key!=="ArrowLeft")return null;
  const index=enabled.findIndex(item=>item.value===current);
  if(index<0)return enabled[key==="ArrowRight"?0:enabled.length-1].value;
  return enabled[(index+(key==="ArrowRight"?1:-1)+enabled.length)%enabled.length].value;
}
