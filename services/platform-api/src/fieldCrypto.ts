/**
 * Field-level encryption for sensitive guest information.
 * AES-256-GCM. The key comes from FIELD_ENCRYPTION_KEY (base64, 32 bytes, or a passphrase).
 * FIELD_ENCRYPTION_KEY_PREVIOUS decrypts older rows after a rotation.
 * Production refuses to start without a key. Local development uses a fixed dev key
 * that is rejected in production.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const FIELD_PREFIX = "enc1:";
const DEV_KEY_MATERIAL = "vedanta-dev-only-field-key";

export function assertFieldEncryptionReady(): void {
  if (process.env.NODE_ENV === "production" && !process.env.FIELD_ENCRYPTION_KEY?.trim()) {
    throw new Error("FIELD_ENCRYPTION_KEY is required in production");
  }
  fieldKey("current");
}

export function fieldKey(which: "current" | "previous"): Buffer | null {
  const raw = (which === "current" ? process.env.FIELD_ENCRYPTION_KEY : process.env.FIELD_ENCRYPTION_KEY_PREVIOUS)?.trim();
  if (raw) return decodeKey(raw);
  if (which === "previous") return null;
  if (process.env.NODE_ENV === "production") {
    throw new Error("FIELD_ENCRYPTION_KEY is required in production");
  }
  return createHash("sha256").update(DEV_KEY_MATERIAL).digest();
}

function decodeKey(raw: string): Buffer {
  const asB64 = /^[A-Za-z0-9+/_=-]+$/.test(raw) ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  const buf = asB64.length >= 32 ? asB64.subarray(0, 32) : createHash("sha256").update(raw).digest();
  return buf;
}

export function sealText(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  if (plain === "") return "";
  if (plain.startsWith(FIELD_PREFIX)) return plain;
  const key = fieldKey("current");
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return FIELD_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function openText(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(FIELD_PREFIX)) return value;
  const body = Buffer.from(value.slice(FIELD_PREFIX.length), "base64url");
  if (body.length < 29) throw new Error("Sensitive field is not a valid ciphertext");
  const iv = body.subarray(0, 12);
  const tag = body.subarray(12, 28);
  const data = body.subarray(28);
  const keys = [fieldKey("current"), fieldKey("previous")].filter((k): k is Buffer => !!k);
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      /* try the previous key */
    }
  }
  throw new Error("Could not decrypt a sensitive field. Check FIELD_ENCRYPTION_KEY.");
}

export function sealList(items: string[] | null | undefined): string[] {
  return (items ?? []).map(item => sealText(item) ?? "");
}

export function openList(items: string[] | null | undefined): string[] | null {
  if (items == null) return null;
  return items.map(item => openText(item) ?? "");
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

function listNeedsSeal(items: unknown): boolean {
  return Array.isArray(items) && items.some(item => typeof item === "string" && item !== "" && !item.startsWith(FIELD_PREFIX));
}

function textNeedsSeal(value: unknown): boolean {
  return typeof value === "string" && value !== "" && !value.startsWith(FIELD_PREFIX);
}

/** Encrypt plaintext sensitive columns already stored by seeds or older versions. */
export async function sealStoredSensitive(client: Queryable): Promise<void> {
  const diets = await client.query(`select person_id, diet, allergens, notes from diet_profile`);
  for (const row of diets.rows) {
    if (!listNeedsSeal(row.diet) && !listNeedsSeal(row.allergens) && !textNeedsSeal(row.notes)) continue;
    await client.query(
      `update diet_profile set diet=$2, allergens=$3, notes=$4 where person_id=$1`,
      [row.person_id, sealList(row.diet as string[] | null), sealList(row.allergens as string[] | null), textNeedsSeal(row.notes) ? sealText(String(row.notes)) : row.notes],
    );
  }
  const people = await client.query(`select id, notes from person where notes is not null and notes <> ''`);
  for (const row of people.rows) {
    if (!textNeedsSeal(row.notes)) continue;
    await client.query(`update person set notes=$2 where id=$1`, [row.id, sealText(String(row.notes))]);
  }
  const groups = await client.query(`select id, dietary_notes from booking_group where dietary_notes is not null and dietary_notes <> ''`);
  for (const row of groups.rows) {
    if (!textNeedsSeal(row.dietary_notes)) continue;
    await client.query(`update booking_group set dietary_notes=$2 where id=$1`, [row.id, sealText(String(row.dietary_notes))]);
  }
  const enquiries = await client.query(`select id, dietary_notes, accessibility_notes, travel_notes from guest_enquiry`);
  for (const row of enquiries.rows) {
    if (!textNeedsSeal(row.dietary_notes) && !textNeedsSeal(row.accessibility_notes) && !textNeedsSeal(row.travel_notes)) continue;
    await client.query(
      `update guest_enquiry set dietary_notes=$2, accessibility_notes=$3, travel_notes=$4 where id=$1`,
      [
        row.id,
        textNeedsSeal(row.dietary_notes) ? sealText(String(row.dietary_notes)) : row.dietary_notes,
        textNeedsSeal(row.accessibility_notes) ? sealText(String(row.accessibility_notes)) : row.accessibility_notes,
        textNeedsSeal(row.travel_notes) ? sealText(String(row.travel_notes)) : row.travel_notes,
      ],
    );
  }
  await sealTextColumns(client, "guest_account", "id", ["dietary_notes", "accessibility_notes", "travel_notes", "notes", "flagged_reason"]);
  await sealTextColumns(client, "guest_enquiry", "id", ["party"]);
  await sealTextColumns(client, "diet_profile", "person_id", ["allergen_detail"]);
  await sealTextColumns(client, "booking_group", "id", ["accessibility_notes", "travel_notes"]);
  await sealTextColumns(client, "guest_communication", "id", ["body"]);
  await sealTextColumns(client, "guest_complaint", "id", ["description", "compensation", "resolution"]);
  await sealTextColumns(client, "staff_hr", "user_id", ["pay_note", "bank_account_name", "bank_sort_code", "bank_account_number", "national_insurance", "home_address", "date_of_birth"]);
  await sealTextColumns(client, "absence_request", "id", ["notes"]);
  await sealTextColumns(client, "staff_document", "id", ["notes"]);
  await sealTextColumns(client, "training_record", "id", ["notes", "certificate_ref"]);
  await sealTextColumns(client, "guest_profile", "person_id", ["accessibility_notes", "special_requests", "notes"]);
  await sealTextColumns(client, "guest_staff_note", "id", ["body"]);
  await sealTextColumns(client, "guest_note_event", "id", ["previous_body"]);
  await sealTextColumns(client, "diet_history", "id", ["notes", "allergen_detail"]);
}

async function sealTextColumns(client: Queryable, table: string, idCol: string, cols: string[]): Promise<void> {
  const exists = await client.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name = any($2::text[])`,
    [table, cols],
  );
  const present = exists.rows.map(r => String(r.column_name));
  if (!present.length) return;
  const rows = await client.query(`select ${idCol} as id, ${present.map(c => `"${c}"`).join(", ")} from ${table}`);
  for (const row of rows.rows) {
    if (!present.some(c => textNeedsSeal(row[c]))) continue;
    const sets = present.map((c, i) => `"${c}"=$${i + 2}`).join(", ");
    const vals = present.map(c => textNeedsSeal(row[c]) ? sealText(String(row[c])) : row[c]);
    await client.query(`update ${table} set ${sets} where ${idCol}=$1`, [row.id, ...vals]);
  }
}
