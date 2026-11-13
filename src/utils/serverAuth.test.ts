import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBearerOrCookieToken,
  hashPassword,
  parseCookies,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from './serverAuth';

test('hashPassword and verifyPassword validate scrypt hashes safely', () => {
  const hash = hashPassword('CorporatePass!2026');
  assert.ok(hash.includes(':'));
  assert.equal(verifyPassword('CorporatePass!2026', hash), true);
  assert.equal(verifyPassword('WrongPass!2026', hash), false);
  assert.equal(verifyPassword('CorporatePass!2026', 'malformed'), false);
});

test('signSessionToken and verifySessionToken enforce signature integrity and expiration', () => {
  const secret = 'test-signing-secret-123456';
  const now = 1_700_000_000_000;
  const token = signSessionToken(
    {
      uid: 'emp-alexey',
      sid: 'sess_abc',
      iat: now,
      exp: now + 60_000,
    },
    secret
  );

  const verified = verifySessionToken(token, secret, now + 1000);
  assert.deepEqual(verified, {
    uid: 'emp-alexey',
    sid: 'sess_abc',
    iat: now,
    exp: now + 60_000,
  });

  // Tampered payload rejected
  const [, sig] = token.split('.');
  const fakePayload = Buffer.from(
    JSON.stringify({
      uid: 'admin-root',
      sid: 'sess_abc',
      iat: now,
      exp: now + 60_000,
    })
  ).toString('base64url');
  assert.equal(verifySessionToken(`${fakePayload}.${sig}`, secret, now + 1000), null);

  // Wrong secret rejected
  assert.equal(verifySessionToken(token, 'other-secret', now + 1000), null);

  // Expired token rejected
  assert.equal(verifySessionToken(token, secret, now + 60_001), null);
});

test('parseCookies and extractBearerOrCookieToken resolve tokens across headers', () => {
  const cookies = parseCookies(`foo=1; ${SESSION_COOKIE_NAME}=tok_cookie_123; bar=baz`);
  assert.equal(cookies[SESSION_COOKIE_NAME], 'tok_cookie_123');

  assert.equal(
    extractBearerOrCookieToken({
      authorizationHeader: 'Bearer tok_header_999',
      cookieHeader: `${SESSION_COOKIE_NAME}=tok_cookie_123`,
    }),
    'tok_header_999'
  );

  assert.equal(
    extractBearerOrCookieToken({
      cookieHeader: `${SESSION_COOKIE_NAME}=tok_cookie_123`,
    }),
    'tok_cookie_123'
  );
});
