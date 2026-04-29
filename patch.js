const fs = require('fs');
['types', 'utils', 'contracts'].forEach(pkg => {
  const file = `packages/${pkg}/package.json`;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.scripts.lint = "echo 'No lint yet'";
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
});
