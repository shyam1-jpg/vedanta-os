/** Guest photo gallery. Public when the house switches it on. Owner and general manager manage the list. */
import type { FastifyInstance } from "fastify";
import { pool } from "./db.ts";
import { allow, problem, requireActor } from "./auth.ts";
import {
  parseGallerySettings,
  placeholderFor,
  publicGallery,
  reviewPhoto,
  seedPhotos,
  type GalleryPhoto,
} from "../../../domains/guest/gallery.ts";

type PhotoRow = {
  id: string; category: GalleryPhoto["category"]; title: string; alt_text: string; caption: string; image_src: string;
  audience: "guest" | "staff"; shows_people: boolean; shows_bull: boolean; hidden: boolean; sort_order: number; licence: string;
};

function photoOf(row: PhotoRow): GalleryPhoto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    alt: row.alt_text,
    caption: row.caption,
    src: row.image_src,
    audience: row.audience,
    showsPeople: row.shows_people,
    showsBull: row.shows_bull,
    hidden: row.hidden,
    sort: row.sort_order,
    licence: row.licence,
  };
}

async function property(): Promise<{ id: string; tenant_id: string; enabled: boolean } | null> {
  const row = (await pool.query(
    `select id, tenant_id, coalesce(settings->'gallery', '{}'::jsonb) gallery from property order by created_at limit 1`,
  )).rows[0];
  if (!row) return null;
  return { id: row.id, tenant_id: row.tenant_id, enabled: parseGallerySettings(row.gallery).enabled };
}

async function ensureSeed(propertyId: string, tenantId: string) {
  const count = (await pool.query(`select count(*)::int n from gallery_photo where property_id=$1`, [propertyId])).rows[0].n;
  if (count > 0) return;
  for (const photo of seedPhotos()) {
    await pool.query(
      `insert into gallery_photo (tenant_id, property_id, category, title, alt_text, caption, image_src, audience, shows_people, shows_bull, hidden, sort_order, licence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tenantId, propertyId, photo.category, photo.title, photo.alt, photo.caption, photo.src, photo.audience, photo.showsPeople, photo.showsBull, photo.hidden, photo.sort, photo.licence],
    );
  }
}

async function listPhotos(propertyId: string): Promise<GalleryPhoto[]> {
  const rows = (await pool.query(
    `select id, category, title, alt_text, caption, image_src, audience, shows_people, shows_bull, hidden, sort_order, licence
     from gallery_photo where property_id=$1 order by sort_order, title`,
    [propertyId],
  )).rows as PhotoRow[];
  return rows.map(photoOf);
}

export default async function galleryRoutes(app: FastifyInstance) {
  app.get("/guest/gallery", async () => {
    try {
      const house = await property();
      if (!house) return { enabled: false, items: [] };
      await ensureSeed(house.id, house.tenant_id);
      const items = publicGallery(await listPhotos(house.id), { enabled: house.enabled });
      return { enabled: house.enabled, items: items.map(photo => ({ id: photo.id, category: photo.category, title: photo.title, alt: photo.alt, caption: photo.caption, src: photo.src })) };
    } catch {
      return { enabled: false, items: [] };
    }
  });

  app.get("/v1/gallery", async (req, reply) => {
    const actor = await requireActor(req, reply);
    if (!actor || !allow(actor, "gallery.manage", reply)) return;
    const house = await property();
    if (!house) return { enabled: false, items: [], categories: ["grounds", "goshala", "kitchen", "rooms", "other"] };
    await ensureSeed(house.id, house.tenant_id);
    return { enabled: house.enabled, items: await listPhotos(house.id), categories: ["grounds", "goshala", "kitchen", "rooms", "other"] };
  });

  app.put<{ Body: { enabled?: boolean } }>("/v1/gallery/settings", async (req, reply) => {
    const actor = await requireActor(req, reply);
    if (!actor || !allow(actor, "gallery.manage", reply)) return;
    const enabled = req.body?.enabled === true;
    await pool.query(
      `update property set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{gallery}', $2::jsonb, true) where id=$1`,
      [actor.propertyId, JSON.stringify({ enabled })],
    );
    return { enabled };
  });

  app.post<{ Body: Record<string, unknown> }>("/v1/gallery", async (req, reply) => {
    const actor = await requireActor(req, reply);
    if (!actor || !allow(actor, "gallery.manage", reply)) return;
    const draft = req.body ?? {};
    if (!draft.src && draft.category) {
      const standIn = placeholderFor(String(draft.category) as "grounds");
      draft.src = standIn.src;
      draft.alt = draft.alt || standIn.alt;
    }
    const reviewed = reviewPhoto(draft, "new");
    if (!reviewed.ok) return reply.code(422).send(problem(422, "validation", reviewed.error));
    const photo = reviewed.photo;
    const row = (await pool.query(
      `insert into gallery_photo (tenant_id, property_id, category, title, alt_text, caption, image_src, audience, shows_people, shows_bull, hidden, sort_order, licence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [actor.tenantId, actor.propertyId, photo.category, photo.title, photo.alt, photo.caption, photo.src, photo.audience, photo.showsPeople, photo.showsBull, photo.hidden, photo.sort, photo.licence],
    )).rows[0];
    return { id: row.id, audience: photo.audience };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/v1/gallery/:id", async (req, reply) => {
    const actor = await requireActor(req, reply);
    if (!actor || !allow(actor, "gallery.manage", reply)) return;
    const current = (await pool.query(
      `select id, category, title, alt_text, caption, image_src, audience, shows_people, shows_bull, hidden, sort_order, licence
       from gallery_photo where id=$1 and property_id=$2`,
      [req.params.id, actor.propertyId],
    )).rows[0] as PhotoRow | undefined;
    if (!current) return reply.code(404).send(problem(404, "not_found", "That photo is not on the list"));
    const photo = photoOf(current);
    const reviewed = reviewPhoto({ ...photo, ...req.body, alt: req.body?.alt ?? photo.alt, src: req.body?.src ?? photo.src }, photo.id);
    if (!reviewed.ok) return reply.code(422).send(problem(422, "validation", reviewed.error));
    const next = reviewed.photo;
    await pool.query(
      `update gallery_photo set category=$2, title=$3, alt_text=$4, caption=$5, image_src=$6, audience=$7, shows_people=$8, shows_bull=$9, hidden=$10, sort_order=$11 where id=$1`,
      [photo.id, next.category, next.title, next.alt, next.caption, next.src, next.audience, next.showsPeople, next.showsBull, next.hidden, next.sort],
    );
    return { id: photo.id, audience: next.audience };
  });
}
