/**
 * Load a local staff list into the database.
 * Default file: db/import/staff-teams.local.json (gitignored).
 * Never point this at a file you are about to commit.
 *
 *   DATABASE_URL=postgres://vedanta:vedanta@localhost:5432/vedanta node tools/import-staff/import-teams.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const file = resolve(process.argv[2] ?? "db/import/staff-teams.local.json");
if (file.endsWith("staff-teams.example.json")) {
  console.error("Refusing to import the example file. Copy it to staff-teams.local.json and replace the emails.");
  process.exit(1);
}

const doc = JSON.parse(readFileSync(file, "utf8"));
const people = doc.people ?? [];
if (!Array.isArray(people) || people.length === 0) {
  console.error("No people in " + file);
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://vedanta:vedanta@localhost:5432/vedanta" });
await client.connect();
try {
  const prop = (await client.query(`select id, tenant_id from property order by created_at limit 1`)).rows[0];
  if (!prop) throw new Error("No property. Run migrations first.");
  const hasConstraint = (await client.query(`select to_regclass('public.staff_rota_constraint') as t`)).rows[0].t;
  await client.query("begin");
  for (const person of people) {
    const email = String(person.email ?? "").trim().toLowerCase();
    const name = String(person.name ?? "").trim();
    const role = String(person.role ?? "").trim();
    const department = person.department ? String(person.department).trim() : null;
    const section = person.section ? String(person.section).trim() : null;
    if (!email.includes("@") || !name || !role) throw new Error("Each person needs email, name and role");
    const roleRow = (await client.query(`select id from role where tenant_id=$1 and code=$2`, [prop.tenant_id, role])).rows[0];
    if (!roleRow) throw new Error("Unknown role " + role + " for " + email);
    const dept = department
      ? (await client.query(`select id from department where property_id=$1 and code=$2`, [prop.id, department])).rows[0]
      : null;
    if (department && !dept) throw new Error("Unknown department " + department);
    const sectionRow = section
      ? (await client.query(
        `select id from department_section where department_id=$1 and code=$2`,
        [dept.id, section],
      )).rows[0]
      : null;
    if (section && !sectionRow) throw new Error("Unknown sub-section " + section + " in " + department);
    const existing = (await client.query(
      `select id from app_user where tenant_id=$1 and lower(email)=lower($2)`,
      [prop.tenant_id, email],
    )).rows[0];
    const user = existing
      ? (await client.query(`update app_user set display_name=$2, status='ACTIVE' where id=$1 returning id`, [existing.id, name])).rows[0]
      : (await client.query(
        `insert into app_user (tenant_id, email, display_name, status) values ($1,$2,$3,'ACTIVE') returning id`,
        [prop.tenant_id, email, name],
      )).rows[0];
    await client.query(`delete from membership where user_id=$1 and property_id=$2`, [user.id, prop.id]);
    await client.query(
      `insert into membership (tenant_id, user_id, property_id, role_id, department_id, section_id) values ($1,$2,$3,$4,$5,$6)`,
      [prop.tenant_id, user.id, prop.id, roleRow.id, dept?.id ?? null, sectionRow?.id ?? null],
    );
    if (hasConstraint && Array.isArray(person.templates) && person.templates.length) {
      const bodies = [];
      for (const code of person.templates) {
        const tpl = (await client.query(`select body from rota_constraint_template where code=$1`, [code])).rows[0];
        if (!tpl) throw new Error("Unknown constraint template " + code);
        bodies.push(tpl.body);
      }
      const merged = Object.assign({}, ...bodies);
      await client.query(
        `insert into staff_rota_constraint (
           user_id, tenant_id, property_id, earliest_start, lates_only, lates_from, never_kp, can_do_kp, opens_kitchen,
           max_hours_week, max_hours_month, normal_week_hours, max_days_week, unavailable_weekdays, earliest_by_weekday, notes
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::int[],$15::jsonb,$16
         )
         on conflict (user_id) do update set
           earliest_start=excluded.earliest_start, lates_only=excluded.lates_only, lates_from=excluded.lates_from,
           never_kp=excluded.never_kp, can_do_kp=excluded.can_do_kp, opens_kitchen=excluded.opens_kitchen,
           max_hours_week=excluded.max_hours_week, max_hours_month=excluded.max_hours_month,
           normal_week_hours=excluded.normal_week_hours, max_days_week=excluded.max_days_week,
           unavailable_weekdays=excluded.unavailable_weekdays, earliest_by_weekday=excluded.earliest_by_weekday,
           notes=excluded.notes, updated_at=now()`,
        [
          user.id, prop.tenant_id, prop.id,
          merged.earliestStart ?? null,
          !!merged.latesOnly,
          merged.latesFrom ?? "12:00",
          merged.neverKp ?? null,
          merged.canDoKp ?? null,
          merged.opensKitchen ?? null,
          merged.maxHoursWeek ?? null,
          merged.maxHoursMonth ?? null,
          merged.normalWeekHours ?? null,
          merged.maxDaysWeek ?? null,
          merged.unavailableWeekdays ?? [],
          JSON.stringify(merged.earliestByWeekday ?? {}),
          merged.notes ?? null,
        ],
      );
    }
    console.log("imported " + email + " → " + role + (department ? " / " + department : "") + (section ? " / " + section : ""));
  }
  await client.query("commit");
} catch (err) {
  await client.query("rollback");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
