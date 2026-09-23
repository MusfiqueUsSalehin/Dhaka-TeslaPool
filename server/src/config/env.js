import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at boot.
 * A missing or malformed variable crashes the process immediately with a readable
 * message, instead of failing later in the middle of a request.
 */
const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a postgres:// URL' }),
  DATABASE_SSL: booleanFromString.default(false),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: booleanFromString.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // When true, the container runs migrations + seeds the story cast on start.
  SEED_ON_START: booleanFromString.default(false),
  // Directory with the built React app. Empty = API only (dev mode uses Vite).
  CLIENT_DIST_DIR: z.string().optional(),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`[config] Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export const env = loadEnv();
