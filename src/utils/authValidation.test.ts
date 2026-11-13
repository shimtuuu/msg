import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  validateLoginInput,
  validateRegisterInput,
} from './authValidation';

test('normalizeEmail trims and lowercases emails', () => {
  assert.equal(normalizeEmail('  User@Corp.Internal '), 'user@corp.internal');
});

test('validateLoginInput enforces email format and password length', () => {
  assert.equal(validateLoginInput('', '123456').valid, false);
  assert.equal(validateLoginInput('bad-email', '123456').valid, false);
  assert.equal(validateLoginInput('a.petrov@corp.internal', '123').valid, false);
  assert.equal(
    validateLoginInput('a.petrov@corp.internal', 'PetrovWork!2026').valid,
    true
  );
});

test('validateRegisterInput enforces all required employee fields and matching passwords', () => {
  assert.equal(
    validateRegisterInput({
      name: 'И',
      email: 'ivan@corp.internal',
      department: 'Разработка',
      title: 'Инженер',
      password: 'Password123',
      confirmPassword: 'Password123',
    }).valid,
    false
  );

  assert.equal(
    validateRegisterInput({
      name: 'Иван Новиков',
      email: 'ivan@corp.internal',
      department: 'Разработка',
      title: 'Инженер',
      password: 'Password123',
      confirmPassword: 'DifferentPassword',
    }).valid,
    false
  );

  assert.equal(
    validateRegisterInput({
      name: 'Иван Новиков',
      email: 'ivan@corp.internal',
      department: 'Разработка',
      title: 'Инженер',
      password: 'Password123',
      confirmPassword: 'Password123',
    }).valid,
    true
  );
});
