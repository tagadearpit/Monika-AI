'use strict';

const { hashAdminPassword } = require('../utils');

const password = process.argv[2];
if (!password) {
    console.error('Usage: node scripts/hash-admin-password.js "YourStrongPassword"');
    process.exit(1);
}
console.log(hashAdminPassword(password));
