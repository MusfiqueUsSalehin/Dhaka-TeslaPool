import bcrypt from 'bcryptjs';

/**
 * The Banani rush-hour cast. Idempotent: running it again (e.g. every container start
 * with SEED_ON_START=true) never duplicates or wipes data — rows are matched by phone.
 *
 * Demo password for everyone: tesla1234
 */
export const DEMO_PASSWORD = 'tesla1234';

export const CAST = {
  jashim: { name: 'Jashim', phone: '01711000001', role: 'DRIVER' },
  nusrat: { name: 'Nusrat', phone: '01711000002', role: 'PASSENGER' },
  rafiq: { name: 'Rafiq', phone: '01711000003', role: 'PASSENGER' },
  shirin: { name: 'Shirin', phone: '01711000004', role: 'PASSENGER' },
};

export const BULLET = { name: 'Bullet', plate: 'DHAKA-TESLA-11', capacity: 3, current_zone: 'BANANI' };

export async function seed(knex) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const person of Object.values(CAST)) {
    await knex('users')
      .insert({ ...person, password_hash: passwordHash })
      .onConflict('phone')
      .ignore();
  }

  const jashim = await knex('users').where({ phone: CAST.jashim.phone }).first('id');
  await knex('vehicles')
    .insert({ ...BULLET, driver_id: jashim.id })
    .onConflict('driver_id')
    .ignore();
}