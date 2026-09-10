'use strict';

const crypto = require('node:crypto');

console.log(`TOKEN_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('base64url')}`);
console.log(`ADMIN_API_KEY=${crypto.randomBytes(32).toString('base64url')}`);
