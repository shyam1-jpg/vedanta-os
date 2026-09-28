export const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export const tok = {
  get: () => (typeof window === "undefined" ? null : sessionStorage.getItem("vedanta.staff.token")),
  set: (t: string | null) => { if (t) sessionStorage.setItem("vedanta.staff.token", t); else sessionStorage.removeItem("vedanta.staff.token"); },
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) };
  const t = tok.get(); if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(API + path, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? res.statusText);
  return body as T;
}

export async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Attach a photo as an image"));
      el.src = url;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the photo");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.72;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 680_000 && quality > 0.35) {
      quality -= 0.08;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (!data.startsWith("data:image/") || data.length > 700_000) throw new Error("That photo is too large — use a smaller one");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readAttachment(file: File): Promise<string> {
  if (file.type === "application/pdf") {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the file"));
      reader.readAsDataURL(file);
    });
    if (!data.startsWith("data:application/pdf") || data.length > 700_000) throw new Error("That file is too large — use a smaller one");
    return data;
  }
  return shrinkPhoto(file);
}
