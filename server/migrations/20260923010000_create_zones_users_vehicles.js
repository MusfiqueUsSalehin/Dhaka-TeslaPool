import { ZONES } from '../src/domain/zones.js';

/**
 * Reference data + identities:
 *   zones     predefined Dhaka areas (FK target for pickups/dropoffs)
 *   users     passengers and drivers (role enum), TeslaPay balance
 *   vehicles  the Tesla, its fixed capacity and the driver's availability
 */
export async function up(knex) {
  await knex.raw(`CREATE TYPE user_role AS ENUM ('PASSENGER', 'DRIVER')`);

  await knex.schema.createTable('zones', (t) => {
    t.text('code').primary();
    t.text('name').notNullable().unique();
    t.decimal('lat', 9, 6).notNullable();
    t.decimal('lng', 9, 6).notNullable();
    t.integer('grid_x_m').notNullable();
    t.integer('grid_y_m').notNullable();
  });
  await knex('zones').insert(
    ZONES.map((z) => ({ code: z.code, name: z.name, lat: z.lat, lng: z.lng, grid_x_m: z.x, grid_y_m: z.y })),
  );

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable();
    t.text('phone').notNullable().unique();
    t.text('password_hash').notNullable();
    t.specificType('role', 'user_role').notNullable();
    t.bigInteger('wallet_balance_paisa').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE users
      ADD CONSTRAINT users_name_length CHECK (char_length(trim(name)) BETWEEN 2 AND 60),
      ADD CONSTRAINT users_phone_bd_mobile CHECK (phone ~ '^01[3-9][0-9]{8}$'),
      ADD CONSTRAINT users_wallet_non_negative CHECK (wallet_balance_paisa >= 0)
  `);

  await knex.schema.createTable('vehicles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('driver_id').notNullable().unique().references('users.id').onDelete('RESTRICT');
    t.text('name').notNullable();
    t.text('plate').notNullable().unique();
    t.smallint('capacity').notNullable();
    t.boolean('is_online').notNullable().defaultTo(false);
    t.text('current_zone').references('zones.code');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE vehicles
      ADD CONSTRAINT vehicles_capacity_range CHECK (capacity BETWEEN 1 AND 6),
      ADD CONSTRAINT vehicles_online_needs_zone CHECK (NOT is_online OR current_zone IS NOT NULL)
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('vehicles');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('zones');
  await knex.raw('DROP TYPE IF EXISTS user_role');
}
