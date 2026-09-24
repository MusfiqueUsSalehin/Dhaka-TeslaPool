import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, db, resetDb, loginAs, CAST } from './helpers.js';

beforeEach(resetDb);
afterAll(() => db.destroy());

describe('passenger auth', () => {
  it('signs up a new passenger and starts a session (httpOnly cookie)', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/signup').send({ name: 'Shila', phone: '01812345678', password: 'rickshaw99' });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ name: 'Shila', role: 'PASSENGER', walletBalancePaisa: 0 });
    expect(res.headers['set-cookie'][0]).toMatch(/tp_session=.+HttpOnly/i);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.phone).toBe('01812345678');
  });

  it('normalises +880 phone numbers and rejects duplicates', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'Nusrat Again', phone: '+8801711000002', password: 'whatever123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_TAKEN');
  });

  it('validates input with field-level messages', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'N', phone: '12345', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual(['name', 'password', 'phone']);
  });

  it('logs Nusrat in with the demo password and never returns the password hash', async () => {
    const nusrat = await loginAs('nusrat');
    expect(nusrat.user).toMatchObject({ name: 'Nusrat', role: 'PASSENGER' });
    expect(JSON.stringify(nusrat.user)).not.toMatch(/password/i);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ phone: CAST.rafiq.phone, password: 'not-his-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Wrong phone number or password');
  });

  it('rejects requests without a session and with a forged token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const forged = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt');
    expect(forged.status).toBe(401);
  });

  it('logs out by clearing the cookie', async () => {
    const shirin = await loginAs('shirin');
    await shirin.post('/api/auth/logout').expect(200);
    expect((await shirin.get('/api/auth/me')).status).toBe(401);
  });
});