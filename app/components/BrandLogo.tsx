import Image from "next/image";
import Link from "next/link";

export function BrandLogo({className="",compact=false}:{className?:string;compact?:boolean}){
  return <Link className={`site-brand${compact?" compact":""} ${className}`.trim()} href="/" aria-label="Snooker ELO 首頁">
    <Image className="site-brand-mark" src="/brand/snooker-elo-mark.png" width={compact?36:44} height={compact?36:44} alt="" priority/>
    <Image className="site-brand-wordmark" src="/brand/snooker-elo-wordmark.png" width={515} height={135} sizes="(max-width: 820px) 6.75rem, 8.4rem" alt="" priority/>
  </Link>;
}
