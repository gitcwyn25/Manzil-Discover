import test from 'node:test';
import assert from 'node:assert/strict';
import { canShowRegistration, requestedLoginMode } from './registrationPolicy.ts';

test('public signup is visible while the seeded admin finishes their own setup', () => {
  assert.equal(canShowRegistration({ has_users: true, password_registration: true, setup_complete: false }), true);
});
test('disabled granular registration takes precedence over the legacy flag', () => {
  assert.equal(canShowRegistration({ has_users: true, password_registration: false, allow_registration: true }), false);
});
test('private registration stays private, while a validated invitation is allowed', () => {
  assert.equal(canShowRegistration({ has_users: true, password_registration: false }), false);
  assert.equal(canShowRegistration({ has_users: true, password_registration: false }, true), true);
});
test('fresh installation and legacy configuration remain supported', () => {
  assert.equal(canShowRegistration({ has_users: false, password_registration: false }), true);
  assert.equal(canShowRegistration({ has_users: true, allow_registration: true }), true);
});
test('unknown configuration cannot accidentally expose a signup action', () => {
  assert.equal(canShowRegistration(null), false);
  assert.equal(canShowRegistration(undefined), false);
});
test('signup deep links accept only the explicit register mode', () => {
  assert.equal(requestedLoginMode('?mode=register'), 'register');
  assert.equal(requestedLoginMode('?mode=admin'), 'login');
  assert.equal(requestedLoginMode('?mode=https://example.com'), 'login');
});
