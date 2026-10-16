import { pool } from "./db.ts";
import type { Actor } from "./auth.ts";

export async function audit(a: Pick<Actor, "propertyId" | "userId">, action: string, detail: string) {
  await pool.query(
    `insert into rota_audit (property_id, actor_user_id, action, detail) values ($1,$2,$3,$4)`,
    [a.propertyId, a.userId, action.slice(0, 80), detail.slice(0, 500)],
  );
}

export async function notifyUsers(propertyId: string, userIds: string[], title: string, body: string, href: string) {
  for (const id of userIds) {
    await pool.query(
      `insert into wf_notification (property_id, user_id, title, body, href) values ($1,$2,$3,$4,$5)`,
      [propertyId, id, title.slice(0, 140), body.slice(0, 240), href.slice(0, 200)],
    );
  }
}
