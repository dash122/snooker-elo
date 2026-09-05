import type {ReactNode} from "react";
export function AppShell({signedIn,children}:{signedIn:boolean;children:ReactNode}){return <div className={`shell ds-app-shell${signedIn?"":" read-only"}`}>{children}</div>}
export function PageFrame({className="",children}:{className?:string;children:ReactNode}){return <div className={`app-page${className?` ${className}`:""}`}>{children}</div>}
export function PageHero({eyebrow,title,description,action}:{eyebrow?:string;title:string;description:string;action?:ReactNode}){return <header className="ds-page-hero"><div>{eyebrow&&<p>{eyebrow}</p>}<h1>{title}</h1><span>{description}</span></div>{action}</header>}
export function SectionHeader({title,description,meta,className=""}:{title:string;description?:string;meta?:ReactNode;className?:string}){return <header className={`ds-section-header ${className}`.trim()}><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{meta&&<div className="ds-section-header__meta">{meta}</div>}</header>}
