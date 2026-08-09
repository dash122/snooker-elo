import GalleryClient from "./GalleryClient";
export default function UiGalleryPage(){if(process.env.NODE_ENV==="production")return <main className="ds-gallery"><h1>Not found</h1></main>;return <GalleryClient/>}
