import { context } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyWasms() {
    const wasmSrcDir = path.resolve(__dirname, "node_modules/@cucumber/language-service/dist");
    const wasmDstDir = path.resolve(__dirname, "out");
    if (!fs.existsSync(wasmDstDir)) {
        fs.mkdirSync(wasmDstDir, { recursive: true });
    }
    if (fs.existsSync(wasmSrcDir)) {
        const files = fs.readdirSync(wasmSrcDir).filter((f) => f.endsWith(".wasm"));
        for (const f of files) {
            fs.copyFileSync(path.join(wasmSrcDir, f), path.join(wasmDstDir, f));
        }
    }
}

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: "esbuild-problem-matcher",

    setup(build) {
        build.onStart(() => {
            console.log("[watch] build started");
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            copyWasms();
            console.log("[watch] build finished");
        });
    },
};

async function main() {
    const ctx = await context({
        entryPoints: [
            "src/extension.ts",
        ],
        bundle: true,
        format: "cjs",
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: "node",
        outfile: "out/bundle.js",
        external: ["vscode"],
        logLevel: "silent",
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        copyWasms();
        await ctx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
