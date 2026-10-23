#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';

// Check possible Antigravity IDE CLI locations
const localAppData = process.env.LOCALAPPDATA || '';
const possiblePaths = [
  path.join(localAppData, 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
  path.join(localAppData, 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide'),
  'antigravity-ide'
];

let ideCli = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    ideCli = p;
    break;
  }
}

if (!ideCli) {
  console.log('Antigravity IDE CLI not found in standard paths, falling back to "code"...');
  ideCli = 'code';
}

const vsixFiles = [
  path.join(rootDir, `smart-cucumber-behave-openvsx-${version}.vsix`),
  path.join(rootDir, `smart-cucumber-behave-vscode-${version}.vsix`)
];

for (const vsix of vsixFiles) {
  if (fs.existsSync(vsix)) {
    console.log(`Installing ${path.basename(vsix)} into Antigravity IDE using: ${ideCli}...`);
    try {
      cp.execSync(`"${ideCli}" --install-extension "${vsix}" --force`, { stdio: 'inherit', cwd: rootDir });
      console.log(`✓ Installed ${path.basename(vsix)} successfully.\n`);
    } catch (e) {
      console.error(`Failed to install ${path.basename(vsix)}:`, e.message);
    }
  }
}
