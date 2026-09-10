'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp, createTokenSealer, hashPassword } = require('../server');

test('OAuth callback preserves refresh token, encrypts tokens and rejects replay', async t => {
  const seal = createTokenSealer('test-key');
  let exchanges = 0;
  const app = createApp({ dbFile: ':memory:', legacyDir: null, tokenEncryptionKey: 'test-key', logger: null,
    googleClient: { async getToken(input) {
      assert.equal(input.codeVerifier, 'test-verifier');
      exchanges++;
      return { tokens: { access_token: 'new-access', expiry_date: 123456 } };
    } }
  });
  const store = app.locals.store;
  store.createUser({id:'u', name:'Test', email:'test@example.test', company:'', password_hash:hashPassword('password-for-test'), created_at:new Date().toISOString(), tariff:'start'});
  store.createEmailAccount({id:'a', user_id:'u', provider:'gmail', email:'test@example.test', status:'connected', enabled:false, daily_limit:25, sent_today:0, queued_today:0, created_at:new Date().toISOString(), counter_date:'2026-09-10'});
  store.updateEmailAccount('a','u',{tokens_encrypted:seal({refresh_token:'original-refresh'})});
  const state='random-test-state';
  store.createOAuthState({stateHash:crypto.createHash('sha256').update(state).digest('hex'), userId:'u', accountId:'a', codeVerifier:'test-verifier', createdAt:Date.now(), expiresAt:Date.now()+60000});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));app.locals.close();});
  const url=`http://127.0.0.1:${server.address().port}/api/email-accounts/callback/google?state=${state}&code=test-code`;
  assert.equal((await fetch(url)).status,200);
  const encrypted=store.getEmailAccount('a','u').tokens_encrypted;
  assert.equal(encrypted.includes('original-refresh'),false);
  assert.deepEqual(seal.open(encrypted),{access_token:'new-access',refresh_token:'original-refresh'});
  assert.equal((await fetch(url)).status,400);
  assert.equal(exchanges,1);
  assert.throws(()=>createTokenSealer('wrong-key').open(encrypted));
});
