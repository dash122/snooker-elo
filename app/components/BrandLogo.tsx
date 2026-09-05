import Image from "next/image";
import Link from "next/link";

export function BrandLogo({className="",compact=false}:{className?:string;compact?:boolean}){
  return <Link className={`site-brand ${className}`.trim()} href="/" aria-label="Snooker ELO 首頁">
    <Image className="site-brand-mark" src="/brand/snooker-elo-mark.png" width={compact?36:44} height={compact?36:44} alt="" priority/>
    <span className="site-brand-type"><strong>Snooker <em>ELO</em></strong>{!compact&&<small>PLAY · COMPETE · IMPROVE</small>}</span>
  </Link>;
}
