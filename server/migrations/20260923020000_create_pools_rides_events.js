/**
 * The pooling core:
 *   pools        one Tesla trip (pickup zone, capacity snapshot, seats taken, lifecycle)
 *   rides        one passenger's booking AND their membership in a pool (pool_id)
 *   ride_events  append-only audit trail of every state change
 *
 * Invariants are enforced here, not only in the services:
 *   - seats_taken can never exceed capacity                       (CHECK)
 *   - one active pool per vehicle, one active ride per passenger  (partial UNIQUE)
 *   - a REQUESTED ride has no pool; matched/started/completed rides have one (CHECK)
 *   - a fare exists exactly when the trip has started, and its parts add up (CHECK)
 */
const ACTIVE_RIDE = `('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED')`;
const ACTIVE_POOL = `('OPEN', 'DRIVER_ARRIVED', 'STARTED')`;

export async function up(knex) {
  await knex.raw(`CREATE TYPE pool_status AS ENUM ('OPEN', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')`);
  await knex.raw(`CREATE TYPE ride_status AS ENUM ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')`);
  await knex.raw(`CREATE TYPE payment_method AS ENUM ('CASH', 'TESLAPAY')`);
  await knex.raw(`CREATE TYPE payment_status AS ENUM ('PENDING', 'PAID', 'NOT_CHARGED')`);

  await knex.schema.createTable('pools', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('vehicle_id').notNullable().references('vehicles.id').onDelete('RESTRICT');
    t.uuid('driver_id').notNullable().references('users.id').onDelete('RESTRICT');
    t.text('pickup_zone').notNullable().references('zones.code');
    t.specificType('status', 'pool_status').notNullable().defaultTo('OPEN');
    t.smallint('capacity').notNullable();
    t.smallint('seats_taken').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('arrived_at', { useTz: true });
    t.timestamp('started_at', { useTz: true });
    t.timestamp('ended_at', { useTz: true });
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE pools
      ADD CONSTRAINT pools_capacity_range CHECK (capacity BETWEEN 1 AND 6),
      ADD CONSTRAINT pools_seats_within_capacity CHECK (seats_taken BETWEEN 0 AND capacity)
  `);
  await knex.raw(`CREATE UNIQUE INDEX pools_one_active_per_vehicle ON pools (vehicle_id) WHERE status IN ${ACTIVE_POOL}`);
  await knex.raw(`CREATE INDEX pools_open_by_zone ON pools (pickup_zone, created_at) WHERE status = 'OPEN'`);
  await knex.raw(`CREATE INDEX pools_driver_history ON pools (driver_id, created_at DESC)`);

  await knex.schema.createTable('rides', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('passenger_id').notNullable().references('users.id').onDelete('RESTRICT');
    t.uuid('pool_id').references('pools.id').onDelete('RESTRICT');
    t.text('pickup_zone').notNullable().references('zones.code');
    t.text('dropoff_zone').notNullable().references('zones.code');
    t.smallint('seats').notNullable();
    t.specificType('status', 'ride_status').notNullable().defaultTo('REQUESTED');
    t.specificType('payment_method', 'payment_method').notNullable();
    t.specificType('payment_status', 'payment_status').notNullable().defaultTo('PENDING');
    t.integer('distance_m').notNullable();
    // Final fare, locked when the trip starts (NULL before that).
    t.bigInteger('fare_base_paisa');
    t.bigInteger('fare_distance_paisa');
    t.bigInteger('fare_discount_paisa');
    t.bigInteger('fare_total_paisa');
    t.boolean('pooled');
    t.text('cancel_reason');
    t.uuid('cancelled_by').references('users.id');
    t.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('matched_at', { useTz: true });
    t.timestamp('arrived_at', { useTz: true });
    t.timestamp('started_at', { useTz: true });
    t.timestamp('completed_at', { useTz: true });
    t.timestamp('cancelled_at', { useTz: true });
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE rides
      ADD CONSTRAINT rides_pickup_differs_from_dropoff CHECK (pickup_zone <> dropoff_zone),
      ADD CONSTRAINT rides_seats_range CHECK (seats BETWEEN 1 AND 3),
      ADD CONSTRAINT rides_distance_positive CHECK (distance_m > 0),
      ADD CONSTRAINT rides_pool_matches_status CHECK (
        (status = 'REQUESTED' AND pool_id IS NULL)
        OR (status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED') AND pool_id IS NOT NULL)
        OR status = 'CANCELLED'
      ),
      ADD CONSTRAINT rides_fare_locked_after_start CHECK (
        (status IN ('STARTED', 'COMPLETED')) = (fare_total_paisa IS NOT NULL)
      ),
      ADD CONSTRAINT rides_fare_parts_add_up CHECK (
        fare_total_paisa IS NULL
        OR (fare_total_paisa >= 0 AND fare_total_paisa = fare_base_paisa + fare_distance_paisa - fare_discount_paisa)
      )
  `);
  await knex.raw(`CREATE UNIQUE INDEX rides_one_active_per_passenger ON rides (passenger_id) WHERE status IN ${ACTIVE_RIDE}`);
  await knex.raw(`CREATE INDEX rides_waiting_feed ON rides (pickup_zone, requested_at) WHERE status = 'REQUESTED'`);
  await knex.raw(`CREATE INDEX rides_by_pool ON rides (pool_id)`);
  await knex.raw(`CREATE INDEX rides_passenger_history ON rides (passenger_id, requested_at DESC)`);

  await knex.schema.createTable('ride_events', (t) => {
    t.bigIncrements('id').primary();
    t.uuid('ride_id').references('rides.id').onDelete('CASCADE');
    t.uuid('pool_id').references('pools.id').onDelete('CASCADE');
    t.uuid('actor_id').references('users.id'); // NULL = system
    t.text('type').notNullable();
    t.text('from_status');
    t.text('to_status');
    t.jsonb('details').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE ride_events ADD CONSTRAINT ride_events_has_subject CHECK (ride_id IS NOT NULL OR pool_id IS NOT NULL)`);
  await knex.raw(`CREATE INDEX ride_events_by_ride ON ride_events (ride_id, created_at)`);
  await knex.raw(`CREATE INDEX ride_events_by_pool ON ride_events (pool_id, created_at)`);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('ride_events');
  await knex.schema.dropTableIfExists('rides');
  await knex.schema.dropTableIfExists('pools');
  await knex.raw('DROP TYPE IF EXISTS payment_status');
  await knex.raw('DROP TYPE IF EXISTS payment_method');
  await knex.raw('DROP TYPE IF EXISTS ride_status');
  await knex.raw('DROP TYPE IF EXISTS pool_status');
}
