import type {ReactNode} from "react";
export function AppShell({signedIn,children}:{signedIn:boolean;children:ReactNode}){return <div className={`shell ds-app-shell${signedIn?"":" read-only"}`}>{children}</div>}
export function PageFrame({className="",children}:{className?:string;children:ReactNode}){return <div className={`app-page${className?` ${className}`:""}`}>{children}</div>}
export function PageHero({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}){return <header className="ds-page-hero"><div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>{action}</header>}
