"use client";

import { STORY_HEIGHT, STORY_WIDTH } from "../lib/story-card";

/** Turning the story card into something a phone can post.
 *
 *  Instagram has no web intent — there is no URL that opens the story composer with our content in
 *  it, the way wa.me does for WhatsApp. The only route onto a story is to hand the operating system
 *  an image file and let the share sheet offer Instagram alongside everything else. So the flow is:
 *  draw the card as SVG, rasterise it to a PNG in the browser, then share the file.
 *
 *  Rasterising is done here rather than on a server because it costs nothing: the card is already a
 *  self-contained string, `Image` can load it as a data URI, and a canvas can read it back. No image
 *  service, no font hosting, no new dependency, and the card can be regenerated instantly when the
 *  member switches between the result and their record. */

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Rasterise at the story's native 1080×1920, so the image Instagram receives never gets upscaled. */
export async function storyPng(svg: string): Promise<Blob> {
  const image = new Image();
  image.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("story-render-failed"));
    image.src = svgDataUrl(svg);
  });
  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("story-render-failed");
  context.drawImage(image, 0, 0, STORY_WIDTH, STORY_HEIGHT);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("story-render-failed");
  return blob;
}

export type StoryShareOutcome = "shared" | "downloaded" | "cancelled" | "failed";

/** Share the card as a file, falling back to a download.
 *
 *  The sheet is the good path — on a phone it lists Instagram directly, and "Add to story" is one
 *  more tap. Desktop browsers mostly cannot share files, and Instagram cannot be posted to from a
 *  desktop anyway, so there the honest fallback is to save the image: the member finishes the post
 *  from their phone. A dismissed sheet is reported separately from a real failure, because telling
 *  someone something broke when they simply changed their mind is its own small insult. */
export async function shareStory(svg: string, options: { filename: string; title: string; text?: string }): Promise<StoryShareOutcome> {
  let blob: Blob;
  try { blob = await storyPng(svg); } catch { return "failed"; }
  const file = new File([blob], options.filename, { type: "image/png" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: options.title, text: options.text });
      return "shared";
    } catch (error) {
      /* AbortError is the user closing the sheet. Anything else means the sheet refused the payload,
         and saving the file still gets them to a story. */
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  try {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = options.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return "downloaded";
  } catch { return "failed"; }
}

/** The WhatsApp path. The native sheet goes first on a phone — WhatsApp is the first row for most
    members of this club — and wa.me is the desktop fallback rather than a second-class route. */
export async function shareText(message: string, title: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try { await navigator.share({ title, text: message }); return; } catch { /* dismissed */ }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}
