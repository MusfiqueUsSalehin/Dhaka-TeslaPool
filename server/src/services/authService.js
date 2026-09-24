import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/knex.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { formatTaka } from '../lib/money.js';

const BCRYPT_ROUNDS = 10;
export const SESSION_COOKIE = 'tp_session';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    walletBalancePaisa: user.wallet_balance_paisa,
    walletBalance: formatTaka(user.wallet_balance_paisa),
  };
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

export async function signUpPassenger({ name, phone, password }) {
  const existing = await db('users').where({ phone }).first('id');
  if (existing) throw conflict('PHONE_TAKEN', 'An account with this phone number already exists');

  const [user] = await db('users')
    .insert({ name: name.trim(), phone, password_hash: await hashPassword(password), role: 'PASSENGER' })
    .returning('*');
  logger.info({ userId: user.id }, 'passenger signed up');
  return user;
}

export async function login({ phone, password }) {
  const user = await db('users').where({ phone }).first();
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Wrong phone number or password');
  logger.debug({ userId: user.id, role: user.role }, 'login ok');
  return user;
}

export async function findUserById(id) {
  return db('users').where({ id }).first();
}