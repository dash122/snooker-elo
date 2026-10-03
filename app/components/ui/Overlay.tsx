"use client";
import {useEffect,useId,useRef,type ReactNode,type RefObject} from "react";
import {createPortal} from "react-dom";
import {IconButton} from "./Primitives";
import {useT} from "../I18nProvider";

const CloseIcon=()=> <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>;
const overlays:HTMLElement[]=[];
const returnTargets=new Map<HTMLElement,HTMLElement|null>();
let overlayOrder=100;
const inertElements=new Map<HTMLElement,boolean>();
function updateBackground(){
  inertElements.forEach((inert,node)=>{node.inert=inert});
  inertElements.clear();
  let current:HTMLElement|undefined=overlays.at(-1);
  while(current&&current!==document.body){
    for(const sibling of Array.from(current.parentElement?.children??[])){
      if(sibling!==current&&sibling instanceof HTMLElement){inertElements.set(sibling,sibling.inert);sibling.inert=true;}
    }
    current=current.parentElement??undefined;
  }
}

function controlsWithin(root:HTMLElement){
  return Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex], [contenteditable="true"]'))
    .filter(element=>element.tabIndex>=0&&!element.matches(':disabled, input[type="hidden"]')&&!element.closest('[hidden], [inert], [aria-hidden="true"]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=="hidden")
    .sort((a,b)=>(a.tabIndex||Infinity)-(b.tabIndex||Infinity));
}

let unlockPage:(()=>void)|undefined;
function lockPage(){
  const body=document.body,html=document.documentElement;
  const x=window.scrollX,y=window.scrollY;
  const properties=["position","top","left","width","overflow","padding-right"] as const;
  const original=properties.map(name=>[name,body.style.getPropertyValue(name),body.style.getPropertyPriority(name)]);
  const overflow=html.style.getPropertyValue("overflow"),priority=html.style.getPropertyPriority("overflow");
  const gutter=window.innerWidth-html.clientWidth;
  if(gutter>0)body.style.paddingRight=`${parseFloat(getComputedStyle(body).paddingRight)+gutter}px`;
  body.style.position="fixed";body.style.top=`-${y}px`;body.style.left=`-${x}px`;
  body.style.width="100%";body.style.overflow="hidden";html.style.overflow="hidden";
  return()=>{
    original.forEach(([name,value,important])=>{if(value)body.style.setProperty(name,value,important);else body.style.removeProperty(name)});
    if(overflow)html.style.setProperty("overflow",overflow,priority);else html.style.removeProperty("overflow");
    // Avoid animated scroll restoration, including in iOS standalone mode.
    const behavior=html.style.getPropertyValue("scroll-behavior"),behaviorPriority=html.style.getPropertyPriority("scroll-behavior");
    html.style.setProperty("scroll-behavior","auto","important");window.scrollTo(x,y);
    if(behavior)html.style.setProperty("scroll-behavior",behavior,behaviorPriority);else html.style.removeProperty("scroll-behavior");
  };
}

/** Callback updates must not restart focus effects. All visual shells share one stack. */
function useOverlay(open:boolean,ref:RefObject<HTMLElement|null>,onClose:()=>void){
  const latest=useRef(onClose);
  useEffect(()=>{latest.current=onClose});
  useEffect(()=>{
    if(!open||!ref.current)return;
    const root:HTMLElement=ref.current;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    returnTargets.set(root,previous);
    const backdrop=root.closest<HTMLElement>('[data-overlay-backdrop]')!;
    const oldZ=backdrop.style.zIndex;
    if(!overlays.length)unlockPage=lockPage();
    overlays.push(root);
    // Mixed legacy/shared shells paint in the same order as their focus stack.
    backdrop.style.zIndex=String(++overlayOrder);
    updateBackground();
    const topmost=()=>overlays.at(-1)===root;
    const enter=()=>{(controlsWithin(root)[0]??root).focus({preventScroll:true})};
    enter();
    function key(event:KeyboardEvent){
      if(!topmost()||event.defaultPrevented)return;
      if(event.key==="Escape"){
        event.preventDefault();event.stopImmediatePropagation();latest.current();return;
      }
      if(event.key!=="Tab")return;
      const controls=controlsWithin(root),index=controls.indexOf(document.activeElement as HTMLElement);
      if(!controls.length){event.preventDefault();root.focus({preventScroll:true});return;}
      if(index===-1||event.shiftKey&&index===0||!event.shiftKey&&index===controls.length-1){
        event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus({preventScroll:true});
      }
    }
    function focus(event:FocusEvent){if(topmost()&&!root.contains(event.target as Node))enter()}
    document.addEventListener("keydown",key);document.addEventListener("focusin",focus);
    return()=>{
      const wasTop=topmost();
      const returnTarget=returnTargets.get(root);
      // If a parent disappears first, its child's return path still reaches the original opener.
      returnTargets.forEach((target,overlay)=>{if(target&&root.contains(target))returnTargets.set(overlay,returnTarget??null)});
      returnTargets.delete(root);
      overlays.splice(overlays.indexOf(root),1);backdrop.style.zIndex=oldZ;
      updateBackground();
      document.removeEventListener("keydown",key);document.removeEventListener("focusin",focus);
      if(!overlays.length){unlockPage?.();unlockPage=undefined;overlayOrder=100;}
      if(wasTop){
        const parent=overlays.at(-1);
        if(returnTarget?.isConnected&&!returnTarget.matches(':disabled')&&!returnTarget.closest('[hidden], [inert]')&&returnTarget.getClientRects().length&&(!parent||parent.contains(returnTarget)))returnTarget.focus({preventScroll:true});
        else if(parent)(controlsWithin(parent)[0]??parent).focus({preventScroll:true});
      }
    };
  },[open,ref]);
  return()=>{if(ref.current&&overlays.at(-1)===ref.current)latest.current()};
}

/** A legacy `.backdrop` modal joined to the shared overlay stack, so it layers, traps focus and
 *  answers Escape in order with the Sheets and Dialogs around it (a match sheet it was opened from). */
export function OverlayBackdrop({onClose,children}:{onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  const dismiss=useOverlay(true,ref,onClose);
  // Portalled like the Sheets: the app shell is its own stacking context, so a modal left inside it
  // would always paint under a Sheet that lives on <body>, whatever z-index the stack gave it.
  return createPortal(<div ref={ref} tabIndex={-1} data-overlay-backdrop className="backdrop" onMouseDown={event=>event.target===event.currentTarget&&dismiss()}>{children}</div>,document.body);
}

export function Dialog({open,title,children,onClose}:{open:boolean;title:string;children:ReactNode;onClose:()=>void}){
  const t=useT(),ref=useRef<HTMLDivElement>(null),titleId=useId();
  const dismiss=useOverlay(open,ref,onClose);
  if(!open)return null;
  return <div data-overlay-backdrop className="ds-overlay" onMouseDown={event=>event.target===event.currentTarget&&dismiss()}><div ref={ref} tabIndex={-1} className="ds-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}><IconButton type="button" className="ds-dialog-close" onClick={dismiss} label={t("關閉")}><CloseIcon/></IconButton><h2 id={titleId}>{title}</h2>{children}</div></div>;
}

export function Sheet({open,title,children,onClose,className=""}:{open:boolean;title:string;children:ReactNode;onClose:()=>void;className?:string}){
  const t=useT(),ref=useRef<HTMLElement>(null),titleId=useId();
  const dismiss=useOverlay(open,ref,onClose);
  if(!open)return null;
  return <div data-overlay-backdrop className="ds-overlay ds-overlay--sheet" onMouseDown={event=>event.target===event.currentTarget&&dismiss()}><section ref={ref} tabIndex={-1} className={`ds-sheet${className?` ${className}`:""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><IconButton type="button" className="ds-dialog-close" onClick={dismiss} label={t("關閉")}><CloseIcon/></IconButton><h2 id={titleId}>{title}</h2>{children}</section></div>;
}

export function ConfirmDialog({kicker,title,titleId,description,extra,children,onClose}:{kicker:string;title:ReactNode;titleId:string;description:ReactNode;extra?:ReactNode;children:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLElement>(null),id=useId(),descriptionId=useId();
  const uniqueTitleId=`${titleId}-${id}`;
  const dismiss=useOverlay(true,ref,onClose);
  return <div data-overlay-backdrop className="availability-dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&dismiss()}><section ref={ref} tabIndex={-1} className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby={uniqueTitleId} aria-describedby={descriptionId}><small>{kicker}</small><h2 id={uniqueTitleId}>{title}</h2><p id={descriptionId}>{description}</p>{extra}<div>{children}</div></section></div>;
}

/** Preserve legacy skins; include the sibling close button inside the focus boundary. */
export function BackdropSheet({onClose,labelledBy,className,shellClassName,children}:{onClose:()=>void;labelledBy?:string;className?:string;shellClassName?:string;children:ReactNode}){
  const t=useT(),ref=useRef<HTMLElement>(null),titleId=useId();
  const dismiss=useOverlay(true,ref,onClose);
  useEffect(()=>{
    const root=ref.current;
    const heading=labelledBy?Array.from(root?.querySelectorAll<HTMLElement>('[id]')??[]).find(node=>node.id===labelledBy):root?.querySelector<HTMLElement>('h1,h2,h3');
    if(!root||!heading)return;
    const oldId=heading.id;
    heading.id=titleId;root.setAttribute("aria-labelledby",titleId);
    return()=>{heading.id=oldId};
  },[labelledBy,titleId]);
  const sheetClassName=`sheet${shellClassName?"":" invite-sheet"}${className?` ${className}`:""}`;
  const close=<IconButton type="button" className="close" label={t("關閉")} onClick={dismiss}><CloseIcon/></IconButton>;
  return <div data-overlay-backdrop className="backdrop invite-backdrop" onMouseDown={event=>event.target===event.currentTarget&&dismiss()}>{shellClassName
    ? <div ref={ref as RefObject<HTMLDivElement|null>} tabIndex={-1} className={`sheet-shell ${shellClassName}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy?undefined:t("對話框")}>{close}<section className={sheetClassName}>{children}</section></div>
    : <section ref={ref} tabIndex={-1} className={sheetClassName} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy?undefined:t("對話框")}>{close}{children}</section>}
  </div>;
}
