/** Staff-desk rules for the house operations suite.
 *  Publishing is a permission, never a screen. Staff may read, confirm, and
 *  finish work assigned to them. They do not publish handbook, news, ideas,
 *  calendar entries or the home feed.
 */

export const PUBLISH_PERMISSION = "content.publish";

/** Roles that receive content.publish. Heads of department do not. */
export const PUBLISH_ROLES = ["SYSTEM_OWNER", "GENERAL_MANAGER"] as const;

export const RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const COMPLAINT_STATUSES = ["open", "acknowledged", "resolving", "resolved", "closed"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const IDEA_STATUSES = ["new", "considering", "planned", "done", "declined"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const HANDOVER_AUDIENCES = ["shift", "person", "group"] as const;
export type HandoverAudience = (typeof HANDOVER_AUDIENCES)[number];

const COMPLAINT_NEXT: Record<ComplaintStatus, ComplaintStatus[]> = {
  open: ["acknowledged", "resolving", "closed"],
  acknowledged: ["resolving", "resolved", "closed"],
  resolving: ["resolved", "closed"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

export function mayPublish(perms: Iterable<string>): boolean {
  for (const code of perms) if (code === PUBLISH_PERMISSION) return true;
  return false;
}

export function parseRecurrence(v: unknown): Recurrence {
  const raw = String(v ?? "none").trim().toLowerCase();
  return (RECURRENCES as readonly string[]).includes(raw) ? raw as Recurrence : "none";
}

export function parseComplaintStatus(v: unknown, fallback: ComplaintStatus = "open"): ComplaintStatus {
  const raw = String(v ?? "").trim().toLowerCase();
  return (COMPLAINT_STATUSES as readonly string[]).includes(raw) ? raw as ComplaintStatus : fallback;
}

export function canMoveComplaint(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return COMPLAINT_NEXT[from].includes(to);
}

export function parseIdeaStatus(v: unknown, fallback: IdeaStatus = "new"): IdeaStatus {
  const raw = String(v ?? "").trim().toLowerCase();
  return (IDEA_STATUSES as readonly string[]).includes(raw) ? raw as IdeaStatus : fallback;
}

export function parseHandoverAudience(v: unknown): HandoverAudience {
  const raw = String(v ?? "shift").trim().toLowerCase();
  return (HANDOVER_AUDIENCES as readonly string[]).includes(raw) ? raw as HandoverAudience : "shift";
}

/** Empty audience, ALL, or HOUSE means every member of the house. */
export function audienceAllows(audience: string[] | null | undefined, ctx: { department?: string | null; role?: string | null }): boolean {
  const list = (audience ?? []).map(s => String(s).trim().toUpperCase()).filter(Boolean);
  if (list.length === 0 || list.includes("ALL") || list.includes("HOUSE")) return true;
  const department = String(ctx.department ?? "").trim().toUpperCase();
  const role = String(ctx.role ?? "").trim().toUpperCase();
  return (!!department && list.includes(department)) || (!!role && list.includes(role));
}

export function taskIsVisible(showAfter: string | Date | null | undefined, now: Date, includeLater: boolean): boolean {
  if (includeLater || !showAfter) return true;
  const at = showAfter instanceof Date ? showAfter : new Date(showAfter);
  if (Number.isNaN(at.getTime())) return true;
  return at.getTime() <= now.getTime();
}

export function staffMayComplete(task: { assigned_staff_id?: string | null; assigned_staff_ids?: string[] | null }, userId: string): boolean {
  if (!userId) return false;
  if (task.assigned_staff_id === userId) return true;
  return (task.assigned_staff_ids ?? []).includes(userId);
}

/** An assignee may mark their own open task done without walking the manager status machine. */
const DONE_FROM = new Set([
  "new", "assigned", "acknowledged", "accepted", "scheduled", "in_progress",
  "paused", "waiting", "blocked", "awaiting_approval", "reopened",
]);

export function assigneeCanMarkDone(status: string): boolean {
  return DONE_FROM.has(status);
}

export function nextDue(fromIso: string | null, rule: Recurrence): string | null {
  if (rule === "none") return null;
  const base = fromIso ? new Date(fromIso) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const d = new Date(base);
  if (rule === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (rule === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/** Walk forward until the next occurrence is still in the future and inside the until date. */
export function nextOpenDue(fromIso: string | null, rule: Recurrence, until: string | null, now: Date): string | null {
  if (rule === "none") return null;
  let cursor = fromIso;
  for (let i = 0; i < 36; i++) {
    const n = nextDue(cursor, rule);
    if (!n) return null;
    if (until && new Date(n).getTime() > new Date(until).getTime()) return null;
    if (new Date(n).getTime() > now.getTime()) return n;
    cursor = n;
  }
  return null;
}

const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h2", "h3", "a", "blockquote"]);

/** Keep a small set of formatting tags. Drop scripts, handlers and odd URLs. */
export function sanitizeRichText(input: string): string {
  let html = String(input ?? "").replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  html = html.replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, "");
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/javascript\s*:/gi, "");
  html = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (full, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return "";
    if (full.startsWith("</")) return name === "br" ? "" : `</${name}>`;
    if (name === "br") return "<br>";
    if (name === "a") {
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs) ?? /href\s*=\s*'([^']*)'/i.exec(attrs);
      const url = href?.[1] ?? "";
      if (!/^https?:\/\//i.test(url)) return "<a>";
      return `<a href="${url.replace(/"/g, "")}" rel="noopener noreferrer">`;
    }
    return `<${name}>`;
  });
  return html.slice(0, 100_000);
}

export function richTextToPlain(html: string): string {
  return sanitizeRichText(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h2|h3|li|blockquote)>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pdfEscape(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const piece = word.length > width ? word.slice(0, width) : word;
      if ((line + " " + piece).trim().length > width) {
        if (line) lines.push(line);
        line = piece;
      } else line = (line + " " + piece).trim();
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** A small text PDF so an article can be downloaded without a browser print dialog. */
export function buildTextPdf(title: string, body: string): Uint8Array {
  const lines = wrapLines(`${title}\n\n${body}`, 90);
  const pageSize = 46;
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += pageSize) pages.push(lines.slice(i, i + pageSize));
  const objects: string[] = [];
  const pageIds: number[] = [];
  let id = 3;
  const fontId = 3 + pages.length * 2;
  for (const page of pages) {
    const pageId = id++;
    const contentId = id++;
    pageIds.push(pageId);
    const commands = ["BT", "/F1 12 Tf", "50 800 Td", "14 TL"];
    page.forEach((line, index) => {
      if (index === 0) commands.push(`(${pdfEscape(line)}) Tj`);
      else commands.push("T*", `(${pdfEscape(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  }
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(n => `${n} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let n = 1; n <= fontId; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${fontId + 1}\n`;
  out += "0000000000 65535 f \n";
  for (let n = 1; n <= fontId; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  out += `trailer << /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

/** First line of the uploaded file is the heading. Each later line is one idea. */
export function parseEventIdeas(text: string): { title: string; body: string }[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.slice(1).map(line => {
    const split = line.indexOf(". ");
    if (split > 0 && split < 90) return { title: line.slice(0, split).trim(), body: line.slice(split + 2).trim() };
    return { title: line.slice(0, 180), body: "" };
  }).filter(idea => idea.title.length > 0);
}
