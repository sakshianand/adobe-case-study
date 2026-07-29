const path = require('path');
const { validateFileStreaming } = require('./services/validation/validationPipeline');

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node runLocal.js <path-to-csv>');
  process.exit(1);
}

console.log(`Validating ${filePath} ...\n`);
console.time('validation');

validateFileStreaming(path.resolve(filePath))
  .then((summary) => {
    console.timeEnd('validation');
    console.log('\n--- Validation summary ---');
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((err) => {
    console.error('Validation failed:', err.message);
    process.exit(1);
  });