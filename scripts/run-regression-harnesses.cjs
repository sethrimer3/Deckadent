const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(repoRoot, 'src');
const outRoot = path.join(repoRoot, '.tmp-regression-harness');

function collectTsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function transpileHarnessSources() {
  fs.rmSync(outRoot, { recursive: true, force: true });

  for (const filePath of collectTsFiles(srcRoot)) {
    const relativePath = path.relative(srcRoot, filePath);
    const outPath = path.join(outRoot, relativePath).replace(/\.ts$/, '.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output.outputText);
  }
}

try {
  transpileHarnessSources();
  const { runRegressionHarnesses } = require(path.join(outRoot, 'game/regressionHarness.js'));
  runRegressionHarnesses();
  console.log('Regression harnesses passed');
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  fs.rmSync(outRoot, { recursive: true, force: true });
}
