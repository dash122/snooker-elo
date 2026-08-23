"use client";
import {useEffect,useRef,type ReactNode} from "react";
export function Dialog({open,title,children,onClose}:{open:boolean;title:string;children:ReactNode;onClose:()=>void}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{if(!open)return;const before=document.activeElement as HTMLElement|null;ref.current?.querySelector<HTMLElement>("button,input,select,textarea,a")?.focus();const key=(event:KeyboardEvent)=>event.key==="Escape"&&onClose();document.addEventListener("keydown",key);return()=>{document.removeEventListener("keydown",key);before?.focus()}},[open,onClose]);if(!open)return null;return <div className="ds-overlay" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><div ref={ref} className="ds-dialog" role="dialog" aria-modal="true" aria-labelledby="ds-dialog-title"><button className="ds-dialog-close" onClick={onClose} aria-label="關閉">×</button><h2 id="ds-dialog-title">{title}</h2>{children}</div></div>}
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
  return <div className="ds-overlay ds-overlay--sheet" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section ref={ref as never} className={`ds-sheet${className?` ${className}`:""}`} role="dialog" aria-modal="true" aria-labelledby="ds-sheet-title"><button className="ds-dialog-close" onClick={onClose} aria-label="關閉">×</button><h2 id="ds-sheet-title">{title}</h2>{children}</section></div>
}
/** Shared scaffold for the app's pre-existing `.backdrop`/`.sheet.invite-sheet` bottom-sheet pattern
    (invite composers, session/slot creation, counter-offers). Kept on the legacy classes rather than
    `.ds-sheet` since those carry their own established styling — this only removes the identical
    backdrop/close-button/aria wiring that was duplicated across each call site. */
/** Shared scaffold for the app's `.availability-dialog-backdrop`/`.availability-dialog`
    alertdialog pattern (destructive confirmations, unsaved-changes prompts). Owns its own
    focus trap + Escape handling so call sites stop re-implementing the same wiring. */
export function ConfirmDialog({kicker,title,titleId,description,children,onClose}:{kicker:string;title:ReactNode;titleId:string;description:ReactNode;children:ReactNode;onClose:()=>void}){
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
  return <div className="availability-dialog-backdrop" onMouseDown={onClose}><section ref={ref as never} className="availability-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={event=>event.stopPropagation()}><small>{kicker}</small><h2 id={titleId}>{title}</h2><p>{description}</p><div>{children}</div></section></div>
}
export function BackdropSheet({onClose,labelledBy,className,children}:{onClose:()=>void;labelledBy?:string;className?:string;children:ReactNode}){return <div className="backdrop invite-backdrop" onMouseDown={onClose}><section className={`sheet invite-sheet${className?` ${className}`:""}`} onMouseDown={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={labelledBy}><button type="button" className="close" aria-label="關閉" onClick={onClose}>×</button>{children}</section></div>}
