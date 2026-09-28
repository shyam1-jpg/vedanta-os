/**
 * Guest photo gallery. The public list is drawings the house can swap later.
 * A bull is never offered to guests. A cow caption has to say the visit is supervised, with the gentle cow.
 * The switch defaults to off, so the public site stays empty until the house turns it on.
 */

import { mentionsHiddenAnimal } from "../ops/cowCare.ts";

export const GALLERY_CATEGORIES = ["grounds", "goshala", "kitchen", "rooms", "other"] as const;
export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

export const GALLERY_LICENCE = "Original placeholder drawing for this repository. No person is shown. It is not a photograph of the house or of any guest. The house may replace it.";

export type GalleryPhoto = {
  id: string;
  category: GalleryCategory;
  title: string;
  alt: string;
  caption: string;
  src: string;
  audience: "guest" | "staff";
  showsPeople: boolean;
  showsBull: boolean;
  hidden: boolean;
  sort: number;
  licence: string;
};

export type GallerySettings = { enabled: boolean };

export function parseGallerySettings(raw: unknown): GallerySettings {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { enabled: src.enabled === true || src.enabled === "true" };
}

function svg(label: string, body: string): string {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img"><title>${label}</title>${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(doc)}`;
}

function groundsSrc(): string {
  return svg("Grounds", `<rect width="640" height="400" fill="#E7F0E4"/><rect y="250" width="640" height="150" fill="#8EAE7A"/><circle cx="140" cy="210" r="50" fill="#2F6B45"/><rect x="128" y="210" width="24" height="70" fill="#6B4A2A"/><circle cx="420" cy="190" r="70" fill="#245C3A"/><rect x="404" y="190" width="28" height="90" fill="#6B4A2A"/><rect x="40" y="300" width="560" height="8" fill="#C4A574"/>`);
}

function cowSrc(): string {
  return svg("Gentle cow", `<rect width="640" height="400" fill="#F3E6C8"/><ellipse cx="340" cy="230" rx="150" ry="70" fill="#F7F1E6" stroke="#1F3A32" stroke-width="6"/><circle cx="470" cy="170" r="46" fill="#F7F1E6" stroke="#1F3A32" stroke-width="6"/><circle cx="488" cy="162" r="4" fill="#1F3A32"/><rect x="250" y="270" width="16" height="50" fill="#1F3A32"/><rect x="400" y="270" width="16" height="50" fill="#1F3A32"/><text x="40" y="50" fill="#1F3A32" font-size="22" font-family="Georgia">Example Daisy</text>`);
}

function bullSrc(): string {
  return svg("Staff only bull", `<rect width="640" height="400" fill="#E4D5C4"/><ellipse cx="320" cy="230" rx="150" ry="72" fill="#6B4A2A"/><circle cx="460" cy="160" r="48" fill="#6B4A2A"/><path d="M430 130 L400 90 M500 130 L530 90" stroke="#1A1712" stroke-width="8" fill="none"/><text x="40" y="50" fill="#1A1712" font-size="22" font-family="Georgia">Staff only</text>`);
}

function kitchenSrc(): string {
  return svg("Kitchen and dining", `<rect width="640" height="400" fill="#F7F1E6"/><rect x="80" y="180" width="480" height="24" fill="#C4A574"/><rect x="110" y="204" width="16" height="90" fill="#6B4A2A"/><rect x="500" y="204" width="16" height="90" fill="#6B4A2A"/><ellipse cx="220" cy="160" rx="36" ry="16" fill="#EFE6D4" stroke="#1F3A32"/><ellipse cx="320" cy="150" rx="40" ry="18" fill="#EFE6D4" stroke="#1F3A32"/><ellipse cx="420" cy="162" rx="30" ry="14" fill="#EFE6D4" stroke="#1F3A32"/>`);
}

function roomSrc(): string {
  return svg("Guest room", `<rect width="640" height="400" fill="#F4EFE6"/><rect x="80" y="200" width="300" height="90" fill="#EFE6D4" stroke="#1F3A32"/><rect x="90" y="170" width="80" height="40" fill="#fff" stroke="#1F3A32"/><rect x="430" y="70" width="120" height="90" fill="#D5E4EF" stroke="#1F3A32"/>`);
}

function hallSrc(): string {
  return svg("Hall", `<rect width="640" height="400" fill="#F7F1E6"/><rect x="70" y="80" width="500" height="240" fill="none" stroke="#1F3A32" stroke-width="4"/><rect x="250" y="250" width="140" height="70" fill="#C4A574"/>`);
}

const COW_CAPTION = "Supervised seva with Example Daisy, a gentle cow. Guests visit only with staff.";

export function seedPhotos(): GalleryPhoto[] {
  return [
    { id: "grounds", category: "grounds", title: "The grounds", alt: "Trees and a lawn. No people.", caption: "A placeholder drawing of the grounds.", src: groundsSrc(), audience: "guest", showsPeople: false, showsBull: false, hidden: false, sort: 10, licence: GALLERY_LICENCE },
    { id: "goshala", category: "goshala", title: "Example Daisy", alt: "A gentle cow in a field. No people.", caption: COW_CAPTION, src: cowSrc(), audience: "guest", showsPeople: false, showsBull: false, hidden: false, sort: 20, licence: GALLERY_LICENCE },
    { id: "kitchen", category: "kitchen", title: "Kitchen and dining", alt: "An empty dining table and bowls. No people.", caption: "A placeholder drawing of the dining room. Food is a buffet and is never billed.", src: kitchenSrc(), audience: "guest", showsPeople: false, showsBull: false, hidden: false, sort: 30, licence: GALLERY_LICENCE },
    { id: "rooms", category: "rooms", title: "A guest room", alt: "An empty bed and a window. No people.", caption: "A placeholder drawing of a room.", src: roomSrc(), audience: "guest", showsPeople: false, showsBull: false, hidden: false, sort: 40, licence: GALLERY_LICENCE },
    { id: "hall", category: "other", title: "The hall", alt: "An empty hall. No people.", caption: "A placeholder drawing of the hall.", src: hallSrc(), audience: "guest", showsPeople: false, showsBull: false, hidden: false, sort: 50, licence: GALLERY_LICENCE },
    { id: "bull", category: "goshala", title: "Example Bull", alt: "A bull. Staff only. No people.", caption: "Staff only. Guests are never shown this animal.", src: bullSrc(), audience: "staff", showsPeople: false, showsBull: true, hidden: false, sort: 90, licence: GALLERY_LICENCE },
  ];
}

export function placeholderFor(category: GalleryCategory): { src: string; alt: string } {
  const match = seedPhotos().find(photo => photo.category === category && photo.audience === "guest");
  return { src: match?.src ?? groundsSrc(), alt: match?.alt ?? "Placeholder drawing. No people." };
}

function blob(...parts: string[]): string {
  return parts.join(" ").toLowerCase();
}

export function cowCaptionOk(caption: string): boolean {
  const text = caption.toLowerCase();
  if (!text.includes("supervised")) return false;
  if (!text.includes("gentle")) return false;
  if (text.includes("bull")) return false;
  if (/\balone\b/.test(text)) return false;
  return true;
}

export function guestMaySee(photo: GalleryPhoto, staffOnlyNames: string[] = []): boolean {
  if (photo.hidden || photo.audience !== "guest") return false;
  if (photo.showsPeople || photo.showsBull) return false;
  const text = blob(photo.title, photo.alt, photo.caption);
  if (text.includes("bull")) return false;
  if (mentionsHiddenAnimal(text, staffOnlyNames)) return false;
  const cow = photo.category === "goshala" || text.includes("cow");
  if (cow && !cowCaptionOk(photo.caption)) return false;
  if (!photo.alt.trim() || !photo.src.trim()) return false;
  return true;
}

export function publicGallery(photos: GalleryPhoto[], settings: GallerySettings, staffOnlyNames: string[] = []): GalleryPhoto[] {
  if (!settings.enabled) return [];
  return photos.filter(photo => guestMaySee(photo, staffOnlyNames)).slice().sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
}

/** A guest caption that names a staff-only animal stays on the staff list. */
export function shieldGuestPhoto(photo: GalleryPhoto, staffOnlyNames: string[]): GalleryPhoto {
  const text = blob(photo.title, photo.alt, photo.caption);
  if (photo.showsBull || text.includes("bull") || mentionsHiddenAnimal(text, staffOnlyNames)) {
    return { ...photo, audience: "staff", showsBull: true };
  }
  return photo;
}

export type PhotoDraft = {
  category?: unknown;
  title?: unknown;
  alt?: unknown;
  caption?: unknown;
  src?: unknown;
  audience?: unknown;
  showsPeople?: unknown;
  showsBull?: unknown;
  hidden?: unknown;
  sort?: unknown;
};

export function reviewPhoto(draft: PhotoDraft, id: string): { ok: true; photo: GalleryPhoto } | { ok: false; error: string } {
  const category = String(draft.category ?? "") as GalleryCategory;
  if (!GALLERY_CATEGORIES.includes(category)) return { ok: false, error: "Choose grounds, the goshala, kitchen, rooms, or other" };
  const title = String(draft.title ?? "").trim().slice(0, 120);
  const alt = String(draft.alt ?? "").trim().slice(0, 300);
  const caption = String(draft.caption ?? "").trim().slice(0, 500);
  const src = String(draft.src ?? "").trim().slice(0, 200_000);
  if (!title || !alt || !caption || !src) return { ok: false, error: "A title, a description, a caption, and an image are required" };
  const showsBull = draft.showsBull === true || blob(title, alt, caption).includes("bull");
  const showsPeople = draft.showsPeople === true;
  let audience: "guest" | "staff" = draft.audience === "staff" || showsBull ? "staff" : "guest";
  if (showsPeople) audience = "staff";
  if (audience === "guest" && (category === "goshala" || blob(title, caption).includes("cow")) && !cowCaptionOk(caption)) {
    return { ok: false, error: "A cow photo for guests must say it is supervised seva with the gentle cow" };
  }
  const sort = Number(draft.sort);
  return {
    ok: true,
    photo: {
      id,
      category,
      title,
      alt,
      caption,
      src,
      audience,
      showsPeople,
      showsBull,
      hidden: draft.hidden === true,
      sort: Number.isFinite(sort) ? sort : 100,
      licence: GALLERY_LICENCE,
    },
  };
}
