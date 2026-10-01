"use client";
import type {HTMLAttributes,ReactNode} from "react";
import {nextTabValue} from "../../../lib/tab-navigation";
import {SlidingToggleGroup} from "./Primitives";

type TabItem={value:string;label:ReactNode;accessibleLabel?:string;disabled?:boolean};
function tabId(id:string,value:string){return `${id}-tab-${encodeURIComponent(value)}`}
function panelId(id:string,value:string){return `${id}-panel-${encodeURIComponent(value)}`}

/** Supply a useId() group ID, and a TabPanel for every item, including inactive ones. */
export function TabList({id,label,value,items,onChange,className="",as="div"}:{id:string;label:string;value:string;items:TabItem[];onChange:(value:string)=>void;className?:string;as?:"div"|"nav"}){
  const selected=items.find(item=>item.value===value&&!item.disabled)?.value??items.find(item=>!item.disabled)?.value;
  return <SlidingToggleGroup as={as} className={className} role="tablist" aria-label={label} aria-orientation="horizontal">
    {items.map(item=><button key={item.value} id={tabId(id,item.value)} type="button" role="tab" aria-selected={value===item.value} aria-controls={panelId(id,item.value)} aria-label={item.accessibleLabel} tabIndex={selected===item.value?0:-1} disabled={item.disabled} className={value===item.value?"active":""} onClick={()=>onChange(item.value)} onKeyDown={event=>{
      const next=nextTabValue(items,item.value,event.key);
      if(next===null)return;
      event.preventDefault();
      const target=event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[id="${CSS.escape(tabId(id,next))}"]`);
      target?.focus();onChange(next);
    }}>{item.label}</button>)}
  </SlidingToggleGroup>;
}

/** Keep inactive panel IDs available while preserving caller content's mount/unmount lifecycle. */
export function TabPanel({id,value,active,as:Tag="div",children,...props}:Omit<HTMLAttributes<HTMLElement>,"id"|"hidden"|"role"|"aria-labelledby">&{id:string;value:string;active:boolean;as?:"div"|"section";children:ReactNode}){
  return <Tag {...props} id={panelId(id,value)} role="tabpanel" aria-labelledby={tabId(id,value)} hidden={!active} tabIndex={0}>{active?children:null}</Tag>;
}
