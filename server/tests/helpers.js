import request from 'supertest';
import { db } from '../src/db/knex.js';
import { createApp } from '../src/app.js';
import { seed, CAST, DEMO_PASSWORD } from '../seeds/1_story_cast.js';

export const app = createApp();
export { CAST, DEMO_PASSWORD, db };

/** Wipe everything except reference data (zones), then re-seed the story cast. */
export async function resetDb() {
  const tables = await db('pg_tables')
    .where({ schemaname: 'public' })
    .whereNotIn('tablename', ['zones', 'knex_migrations', 'knex_migrations_lock'])
    .pluck('tablename');
  if (tables.length) await db.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seed(db);
}

/** Returns a supertest agent that carries the session cookie of the given cast member. */
export async function loginAs(who) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone: CAST[who].phone, password: DEMO_PASSWORD });
  if (res.status !== 200) throw new Error(`login as ${who} failed: ${res.status} ${JSON.stringify(res.body)}`);
  agent.user = res.body.data.user;
  return agent;
}
