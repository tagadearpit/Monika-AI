const fs = require('fs');
let s = fs.readFileSync('public/admin.js', 'utf8');
s = s.replace(/\\`/g, '`').replace(/\\\$\{/g, '${');
fs.writeFileSync('public/admin.js', s);
