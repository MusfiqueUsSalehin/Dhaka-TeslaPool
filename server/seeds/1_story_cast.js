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

// ৳500 / ৳300 / ৳150 in TeslaPay; Jashim starts at ৳0 and earns.
export const OPENING_BALANCES = { nusrat: 50000, rafiq: 30000, shirin: 15000 };

export const BULLET ={ name: 'Bullet', plate: 'DHAKA-TESLA-11', capacity: 3, current_zone: 'BANANI' };

export async function seed(knex) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const person of Object.values(CAST)) {
    await knex('users')
      .insert({ ...person, password_hash: passwordHash })
      .onConflict('phone')
      .ignore();
  }

  // Opening TeslaPay balances, written through the ledger so balance == sum(ledger).
  // Only for users with no ledger history yet (keeps the seed idempotent).
  for (const [key, paisa] of Object.entries(OPENING_BALANCES)) {
    const user = await knex('users').where({ phone: CAST[key].phone }).first('id');
    const hasHistory = await knex('wallet_transactions').where({ user_id: user.id }).first('id');
    if (hasHistory) continue;
    const [{ wallet_balance_paisa: balance }] = await knex('users')
      .where({ id: user.id })
      .update({ wallet_balance_paisa: knex.raw('wallet_balance_paisa + ?', [paisa]) })
      .returning('wallet_balance_paisa');
    await knex('wallet_transactions').insert({ user_id: user.id, type: 'TOPUP', amount_paisa: paisa, balance_after_paisa: balance });
  }

  const jashim = await knex('users').where({ phone: CAST.jashim.phone }).first('id');
  await knex('vehicles')
    .insert({ ...BULLET, driver_id: jashim.id })
    .onConflict('driver_id')
    .ignore();
}
