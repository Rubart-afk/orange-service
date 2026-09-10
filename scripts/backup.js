'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const source = path.resolve(root, process.env.OTKLIK_DB_PATH || path.join('data', 'otklik.db'));
const backupDir = path.resolve(root, process.env.BACKUP_DIR || 'backups');
const keep = Number(process.env.BACKUP_KEEP || 14);
if (!Number.isSafeInteger(keep) || keep < 1) throw new Error('BACKUP_KEEP must be a positive integer.');

if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`);
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const destination = path.join(backupDir, `otklik-${stamp}.db`);
const database = new DatabaseSync(source);
try {
  database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
} finally { database.close(); }

const backups = fs.readdirSync(backupDir)
  .filter(name => /^otklik-\d{8}T\d{6}(?:\d{3})?Z\.db$/.test(name))
  .sort()
  .reverse();
for (const old of backups.slice(keep)) fs.unlinkSync(path.join(backupDir, old));
console.log(destination);
