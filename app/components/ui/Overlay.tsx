"use client";
import {useEffect,useRef,type ReactNode} from "react";
import {IconButton} from "./Primitives";
const CloseIcon=()=> <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>;
export function Dialog({open,title,children,onClose}:{open:boolean;title:string;children:ReactNode;onClose:()=>void}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{if(!open)return;const before=document.activeElement as HTMLElement|null;ref.current?.querySelector<HTMLElement>("button,input,select,textarea,a")?.focus();const key=(event:KeyboardEvent)=>event.key==="Escape"&&onClose();document.addEventListener("keydown",key);return()=>{document.removeEventListener("keydown",key);before?.focus()}},[open,onClose]);if(!open)return null;return <div className="ds-overlay" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><div ref={ref} className="ds-dialog" role="dialog" aria-modal="true" aria-labelledby="ds-dialog-title"><IconButton className="ds-dialog-close" onClick={onClose} label="關閉"><CloseIcon/></IconButton><h2 id="ds-dialog-title">{title}</h2>{children}</div></div>}
export function Sheet({open,title,children,onClose,className=""}:{open:boolean;title:string;children:ReactNode;onClose:()=>void;className?:string}){
  const ref=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    ref.current?.querySelector<HTMLElement>("button,input,select,textarea,a")?.focus();
    function onKey(ev:KeyboardEvent){
      if(ev.key==="Escape"){onClose();return}
      if(ev.key!=="Tab")return;
      const focusable=ref.current?Array.from(ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')):[];
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}
      else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}
    }
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("keydown",onKey);previous?.focus()}
  },[open,onClose]);
  if(!open)return null;
  return <div className="ds-overlay ds-overlay--sheet" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section ref={ref as never} className={`ds-sheet${className?` ${className}`:""}`} role="dialog" aria-modal="true" aria-labelledby="ds-sheet-title"><IconButton className="ds-dialog-close" onClick={onClose} label="關閉"><CloseIcon/></IconButton><h2 id="ds-sheet-title">{title}</h2>{children}</section></div>
}
/** Shared scaffold for the app's pre-existing `.backdrop`/`.sheet.invite-sheet` bottom-sheet pattern
    (invite composers, session/slot creation, counter-offers). Kept on the legacy classes rather than
    `.ds-sheet` since those carry their own established styling — this only removes the identical
    backdrop/close-button/aria wiring that was duplicated across each call site. */
/** Shared scaffold for the app's `.availability-dialog-backdrop`/`.availability-dialog`
    alertdialog pattern (destructive confirmations, unsaved-changes prompts). Owns its own
    focus trap + Escape handling so call sites stop re-implementing the same wiring. */
export function ConfirmDialog({kicker,title,titleId,description,extra,children,onClose}:{kicker:string;title:ReactNode;titleId:string;description:ReactNode;extra?:ReactNode;children:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const focusable=ref.current?Array.from(ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')):[];
    focusable[0]?.focus();
    function onKey(ev:KeyboardEvent){
      if(ev.key==="Escape"){onClose();return}
      if(ev.key==="Tab"&&focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}}
    }
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("keydown",onKey);previous?.focus()}
  },[onClose]);
  return <div className="availability-dialog-backdrop" onMouseDown={onClose}><section ref={ref as never} className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={event=>event.stopPropagation()}><small>{kicker}</small><h2 id={titleId}>{title}</h2><p>{description}</p>{extra}<div>{children}</div></section></div>
}
export function BackdropSheet({onClose,labelledBy,className,shellClassName,children}:{onClose:()=>void;labelledBy?:string;className?:string;shellClassName?:string;children:ReactNode}){
  const sheetClassName=`sheet${shellClassName?"":" invite-sheet"}${className?` ${className}`:""}`;
  /* Same element the match-entry modal in HomeClient uses for its own close button
     (`<IconButton className="close">`), not a bare button with the class alone — the base
     `.ds-button,.ds-icon-button` layer supplies the flex centering `.close`'s own rule never did,
     so the × sat visibly off-center here while it was centered there. */
  const close=<IconButton className="close" label="關閉" onClick={onClose}><CloseIcon/></IconButton>;
  return <div className="backdrop invite-backdrop" onMouseDown={onClose}>{shellClassName
    ? <div className={`sheet-shell ${shellClassName}`} onMouseDown={event=>event.stopPropagation()}>{close}<section className={sheetClassName} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</section></div>
    : <section className={sheetClassName} onMouseDown={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{close}{children}</section>}
  </div>;
}
