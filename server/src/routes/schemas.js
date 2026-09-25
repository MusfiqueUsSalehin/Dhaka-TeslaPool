import { z } from 'zod';
import { ZONE_CODES } from '../domain/zones.js';

/** Shared request schemas. */
export const zoneCode = z.enum(ZONE_CODES, { message: 'Unknown zone' });
export const seats = z.coerce.number().int().min(1, 'At least 1 seat').max(3, 'A Tesla has at most 3 seats');
export const uuidParam = (name) => z.object({ [name]: z.string().uuid('Invalid id') });

export const tripSchema = z
  .object({ pickup: zoneCode, dropoff: zoneCode, seats: seats.default(1) })
  .refine((v) => v.pickup !== v.dropoff, { message: 'Pickup and destination must be different zones', path: ['dropoff'] });
