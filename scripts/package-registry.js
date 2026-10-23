#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkgJsonOriginal = fs.readFileSync(pkgPath, 'utf8');

const targetArg =
  process.argv.slice(2).find((a) => a.startsWith('--registry='))?.replace('--registry=', '') ||
  (process.argv.includes('--all') ? 'all' : 'all');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  cp.execSync(cmd, { stdio: 'inherit', cwd: rootDir });
}

function packageForPublisher(publisher, outName) {
  console.log(`\n==========================================================`);
  console.log(`Building package for: ${outName}`);
  console.log(`Publisher ID: "${publisher}"`);
  console.log(`==========================================================\n`);

  const currentPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  currentPkg.publisher = publisher;
  fs.writeFileSync(pkgPath, JSON.stringify(currentPkg, null, 2) + '\n');

  try {
    run(`npx @vscode/vsce package --no-dependencies -o "${outName}"`);
  } finally {
    fs.writeFileSync(pkgPath, pkgJsonOriginal);
  }
}

console.log('Compiling TypeScript and production bundle...');
run('npm run check-ts');
run('node esbuild.js --production');
run('node scripts/copy-wasms.js');

const pkg = JSON.parse(pkgJsonOriginal);
const version = pkg.version || '1.0.0';

if (targetArg === 'vscode' || targetArg === 'all') {
  // VS Code Marketplace uses 'GauravWardhekar'
  packageForPublisher('GauravWardhekar', `smart-cucumber-behave-vscode-${version}.vsix`);
  packageForPublisher('GauravWardhekar', `smart-cucumber-behave-${version}.vsix`);
}

if (targetArg === 'openvsx' || targetArg === 'all') {
  // Open VSX uses 'GauravWardhekara'
  packageForPublisher('GauravWardhekara', `smart-cucumber-behave-openvsx-${version}.vsix`);
}

console.log('\nAll requested packages built successfully!\n');
