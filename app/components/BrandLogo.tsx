import Image from "next/image";
import Link from "next/link";
import { BrandWordmark } from "./BrandWordmark";

export function BrandLogo({className="",compact=false}:{className?:string;compact?:boolean}){
  return <Link className={`site-brand${compact?" compact":""} ${className}`.trim()} href="/" aria-label="Snooker ELO 首頁">
    <Image className="site-brand-mark" src="/brand/snooker-elo-mark.png" width={compact?36:44} height={compact?36:44} alt="" priority/>
    <BrandWordmark/>
  </Link>;
}
