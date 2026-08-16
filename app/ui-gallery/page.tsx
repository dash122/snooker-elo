import { redirect } from "next/navigation";
import { getCurrentMember } from "../../db/auth";
import GalleryClient from "./GalleryClient";

export const dynamic = "force-dynamic";

export default async function UiGalleryPage() {
  if (process.env.NODE_ENV === "production") {
    const user = await getCurrentMember();
    if (!user) redirect("/login");
    if (user.role !== "admin") redirect("/account");
  }
  return <GalleryClient />;
}
