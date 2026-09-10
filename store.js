'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ACCOUNT_FIELDS = `
  id, user_id, provider, email, status, enabled, daily_limit,
  sent_today, queued_today, created_at, counter_date, updated_at,
  authorized_at, tokens_encrypted, token_expiry
`;

class Store {
  constructor({ dbFile, legacyDir, sealTokens }) {
    if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrateSchema();
    if (legacyDir) this.migrateLegacyData(legacyDir, sealTokens);
  }

  migrateSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        company TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tariff TEXT NOT NULL DEFAULT 'none',
        email_verified INTEGER NOT NULL DEFAULT 0,
        terms_accepted_at TEXT,
        terms_version TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE,
        status TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        daily_limit INTEGER NOT NULL DEFAULT 25,
        sent_today INTEGER NOT NULL DEFAULT 0,
        queued_today INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        counter_date TEXT,
        updated_at TEXT,
        authorized_at TEXT,
        tokens_encrypted TEXT,
        token_expiry INTEGER,
        UNIQUE(user_id, email)
      );
      CREATE INDEX IF NOT EXISTS email_accounts_user_id_idx ON email_accounts(user_id);
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        plan TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL,
        consent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS requests_status_created_idx ON requests(status, created_at DESC);
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
        code_verifier TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states(expires_at);
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.ensureColumn('users', 'terms_accepted_at', 'TEXT');
    this.ensureColumn('users', 'terms_version', 'TEXT');
    this.ensureColumn('requests', 'consent_at', 'TEXT');
  }

  ensureColumn(table, column, definition) {
    if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  migrateLegacyData(legacyDir, sealTokens) {
    if (this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('legacy_json_migrated')) return;
    const readJson = (name, fallback) => {
      const file = path.join(legacyDir, name);
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const users = readJson('users.json', { users: [] }).users || [];
    const accounts = readJson('email-accounts.json', []);
    const requests = readJson('requests.json', []);
    const insertUser = this.db.prepare(`INSERT OR IGNORE INTO users
      (id, name, email, company, password_hash, created_at, tariff, email_verified, terms_accepted_at, terms_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertAccount = this.db.prepare(`INSERT OR IGNORE INTO email_accounts
      (${ACCOUNT_FIELDS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertRequest = this.db.prepare(`INSERT OR IGNORE INTO requests
      (id, email, message, plan, status, created_at, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const user of users) {
        insertUser.run(user.id, user.name, user.email, user.company || '', user.password_hash,
          user.created_at || new Date().toISOString(), user.tariff || 'none', user.email_verified ? 1 : 0,
          user.terms_accepted_at || null, user.terms_version || null);
      }
      for (const account of accounts) {
        const hasPlainTokens = account.access_token || account.refresh_token;
        if (hasPlainTokens && !sealTokens) throw new Error('TOKEN_ENCRYPTION_KEY is required to migrate OAuth tokens.');
        const sealed = hasPlainTokens ? sealTokens({ access_token: account.access_token, refresh_token: account.refresh_token }) : account.tokens_encrypted || null;
        insertAccount.run(account.id, account.user_id, account.provider, account.email, account.status || 'authorization_required',
          account.enabled ? 1 : 0, account.daily_limit || 25, account.sent_today || 0, account.queued_today || 0,
          account.created_at || new Date().toISOString(), account.counter_date || null, account.updated_at || null,
          account.authorized_at || null, sealed, account.token_expiry || null);
      }
      for (const item of requests) {
        insertRequest.run(item.id, item.email, item.message, item.plan || null, item.status || 'new', item.created_at || new Date().toISOString(), item.consent_at || null);
      }
      this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('legacy_json_migrated', new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getUserById(id) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
  getUserByEmail(email) { return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email); }
  createUser(user) {
    this.db.prepare(`INSERT INTO users (id, name, email, company, password_hash, created_at, tariff, terms_accepted_at, terms_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.name, user.email, user.company, user.password_hash, user.created_at, user.tariff, user.terms_accepted_at || null, user.terms_version || null);
    return this.getUserById(user.id);
  }
  updatePasswordHash(userId, passwordHash) { this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId); }
  updateTariff(userId, tariff) { this.db.prepare('UPDATE users SET tariff = ? WHERE id = ?').run(tariff, userId); return this.getUserById(userId); }
  deleteUser(userId) { return this.db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0; }

  createSession(session) {
    this.db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(session.idHash, session.userId, session.createdAt, session.expiresAt);
  }
  getSession(idHash) { return this.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(idHash); }
  deleteSession(idHash) { this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash); }
  deleteUserSessions(userId, exceptIdHash = null) {
    if (exceptIdHash) this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?').run(userId, exceptIdHash);
    else this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
  cleanupExpired(now) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(now);
  }

  listEmailAccounts(userId) { return this.db.prepare(`SELECT ${ACCOUNT_FIELDS} FROM email_accounts WHERE user_id = ? ORDER BY created_at`).all(userId).map(normalizeAccount); }
  getEmailAccount(id, userId) { const row = this.db.prepare(`SELECT ${ACCOUNT_FIELDS} FROM email_accounts WHERE id = ? AND user_id = ?`).get(id, userId); return row ? normalizeAccount(row) : null; }
  createEmailAccount(account) {
    this.db.prepare(`INSERT INTO email_accounts (${ACCOUNT_FIELDS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(account.id, account.user_id, account.provider, account.email, account.status, account.enabled ? 1 : 0,
        account.daily_limit, account.sent_today, account.queued_today, account.created_at, account.counter_date,
        null, null, null, null);
    return this.getEmailAccount(account.id, account.user_id);
  }
  updateEmailAccount(id, userId, changes) {
    const allowed = ['enabled', 'daily_limit', 'status', 'updated_at', 'authorized_at', 'tokens_encrypted', 'token_expiry'];
    const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getEmailAccount(id, userId);
    const values = entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value);
    values.push(id, userId);
    this.db.prepare(`UPDATE email_accounts SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    return this.getEmailAccount(id, userId);
  }

  createOAuthState(item) {
    this.db.prepare('INSERT INTO oauth_states (state_hash, user_id, account_id, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(item.stateHash, item.userId, item.accountId, item.codeVerifier, item.createdAt, item.expiresAt);
  }
  consumeOAuthState(stateHash, now) {
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state_hash = ? AND expires_at >= ?').get(stateHash, now);
    this.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(stateHash);
    return row || null;
  }

  createRequest(item) {
    this.db.prepare('INSERT INTO requests (id, email, message, plan, status, created_at, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.email, item.message, item.plan || null, 'new', item.created_at, item.consent_at);
    return item;
  }
  countRequests() { return this.db.prepare('SELECT COUNT(*) AS count FROM requests').get().count; }
  listRequests(status = 'new', limit = 100) { return this.db.prepare('SELECT * FROM requests WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit); }
  updateRequestStatus(id, status) {
    const result = this.db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, id);
    return result.changes ? this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) : null;
  }
  healthcheck() { return this.db.prepare('SELECT 1 AS ok').get().ok === 1; }
  close() { this.db.close(); }
}

function normalizeAccount(row) {
  return { ...row, enabled: Boolean(row.enabled) };
}

module.exports = { Store };
