const vm = require('node:vm');
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['./src/game/regressionHarness.ts'],
  bundle: true,
  platform: 'node',
  format: 'iife',
  globalName: 'DeckadentHarness',
  write: false,
  footer: { js: 'DeckadentHarness.runRegressionHarnesses();' },
}).then(result => {
  vm.runInThisContext(result.outputFiles[0].text);
  console.log('Regression harnesses passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
