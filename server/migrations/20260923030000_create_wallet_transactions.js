/**
 * TeslaPay (simulated wallet) ledger. users.wallet_balance_paisa is a cached running
 * total; this append-only ledger is the source of truth and explains every change.
 *
 * The partial unique index on (ride_id, type) makes ride settlement idempotent: a ride
 * can be charged (RIDE_PAYMENT) and paid out (RIDE_EARNING) at most once.
 */
export async function up(knex) {
  await knex.raw(`CREATE TYPE wallet_tx_type AS ENUM ('TOPUP', 'RIDE_PAYMENT', 'RIDE_EARNING')`);

  await knex.schema.createTable('wallet_transactions', (t) => {
    t.bigIncrements('id').primary();
    t.uuid('user_id').notNullable().references('users.id').onDelete('RESTRICT');
    t.uuid('ride_id').references('rides.id').onDelete('RESTRICT');
    t.specificType('type', 'wallet_tx_type').notNullable();
    t.bigInteger('amount_paisa').notNullable(); // signed: + credit, − debit
    t.bigInteger('balance_after_paisa').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_tx_amount_nonzero CHECK (amount_paisa <> 0),
      ADD CONSTRAINT wallet_tx_balance_non_negative CHECK (balance_after_paisa >= 0),
      ADD CONSTRAINT wallet_tx_sign_matches_type CHECK (
        (type = 'RIDE_PAYMENT' AND amount_paisa < 0) OR (type IN ('TOPUP', 'RIDE_EARNING') AND amount_paisa > 0)
      ),
      ADD CONSTRAINT wallet_tx_ride_required CHECK (type = 'TOPUP' OR ride_id IS NOT NULL)
  `);
  await knex.raw(`CREATE UNIQUE INDEX wallet_tx_once_per_ride ON wallet_transactions (ride_id, type) WHERE ride_id IS NOT NULL`);
  await knex.raw(`CREATE INDEX wallet_tx_by_user ON wallet_transactions (user_id, created_at DESC)`);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('wallet_transactions');
  await knex.raw('DROP TYPE IF EXISTS wallet_tx_type');
}
