import { ImageResponse } from "next/og";
import { loadCupShare } from "../../../cup-share-data";
import { cupOgCard, cupOgGlyphs } from "../../../../lib/cup-og";
import { FONT_STACK, poster } from "./poster";

/** The picture at the top of a shared cup link.
 *
 *  Drawn per cup, at request time, because the thumbnail is the largest object in a WhatsApp preview
 *  and a generic club banner spends all of it saying nothing: the name of the cup, the clock and the
 *  size of the field are exactly the three things that make a member stop scrolling, and they are
 *  different for every cup and different again tomorrow.
 *
 *  Rasterised by `next/og` rather than by the Chromium script that renders the static banners in
 *  `public/`: a crawler cannot wait for a build, and there is no build between a member entering the
 *  cup and the next person opening the link.
 *
 *  The font is the whole difficulty. Every word here is Traditional Chinese, `next/og` ships Latin
 *  only, and Noto Sans TC entire is megabytes — far past what a crawler will wait for. So the face is
 *  fetched already subset to the exact characters this one card draws, which is a few kilobytes, and
 *  cached for the life of the server process. If that fetch fails the card is not drawn with missing
 *  glyphs — a wall of tofu is worse than a plain banner — the request falls back to the static
 *  `cup-share.jpg` instead. */

export const dynamic="force-dynamic";

const fontCache=new Map<string,ArrayBuffer>();
/** Google's `css2` endpoint returns a TrueType face containing only the requested characters when it
    is not asked from a browser that would prefer woff2 — which is what satori can actually parse. */
async function subsetFont(text:string,weight:400|700|900):Promise<ArrayBuffer|null> {
  const key=`${weight}:${text}`;
  const cached=fontCache.get(key);
  if(cached)return cached;
  try{
    const css=await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@${weight}&text=${encodeURIComponent(text)}`,
      {headers:{"user-agent":"Mozilla/5.0 (compatible)"},signal:AbortSignal.timeout(4000)},
    ).then(response=>response.ok?response.text():"");
    const source=/src:\s*url\((.+?)\)/.exec(css)?.[1];
    if(!source)return null;
    const data=await fetch(source,{signal:AbortSignal.timeout(4000)}).then(response=>response.arrayBuffer());
    fontCache.set(key,data);
    return data;
  }catch{ return null; }
}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const fallback=()=>Response.redirect(new URL("/cup-share.jpg",request.url),307);
  const data=await loadCupShare(id).catch(()=>null);
  if(!data)return fallback();

  const card=cupOgCard(data.tournament.name,data.share);
  const glyphs=cupOgGlyphs(card);
  const [regular,heavy]=await Promise.all([subsetFont(glyphs,400),subsetFont(glyphs,900)]);
  if(!heavy)return fallback();

  return new ImageResponse(poster(card),{
    width:1200,height:630,
    fonts:[
      ...(regular?[{name:FONT_STACK,data:regular,weight:400 as const,style:"normal" as const}]:[]),
      {name:FONT_STACK,data:heavy,weight:700 as const,style:"normal" as const},
      {name:FONT_STACK,data:heavy,weight:900 as const,style:"normal" as const},
    ],
    headers:{
      /* Short enough that a cup filling up gets a fresh poster within the hour, long enough that a
         link reposted around the group does not redraw it for every crawler. */
      "cache-control":"public, max-age=600, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}
