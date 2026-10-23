const fs = require('fs');
const path = require('path');

const wasmSrcDir = path.resolve(__dirname, '../node_modules/@cucumber/language-service/dist');
const wasmDstDir = path.resolve(__dirname, '../out');

if (!fs.existsSync(wasmDstDir)) {
  fs.mkdirSync(wasmDstDir, { recursive: true });
}

if (fs.existsSync(wasmSrcDir)) {
  const files = fs.readdirSync(wasmSrcDir).filter((f) => f.endsWith('.wasm'));
  for (const f of files) {
    fs.copyFileSync(path.join(wasmSrcDir, f), path.join(wasmDstDir, f));
  }
  console.log(`Copied ${files.length} Cucumber language server wasm files to out/`);
} else {
  console.warn(`Cucumber wasm source directory not found at: ${wasmSrcDir}`);
}
