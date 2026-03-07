// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`  ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

/** Extension Host 入口（Node.js 环境） */
async function buildExtension() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension/activate.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'warning',
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

/** Webview 双入口（浏览器环境） */
async function buildWebview() {
  const entries = [
    { entry: 'src/webview/panel/index.tsx', outfile: 'dist/panel.js' },
    { entry: 'src/webview/report/index.tsx', outfile: 'dist/report.js' },
  ];

  for (const { entry, outfile } of entries) {
    const ctx = await esbuild.context({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      minify: production,
      sourcemap: !production,
      sourcesContent: false,
      platform: 'browser',
      outfile,
      logLevel: 'warning',
      // CSS 由 esbuild 自动提取为同名 .css 文件
      plugins: [esbuildProblemMatcherPlugin],
    });

    if (watch) {
      await ctx.watch();
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  }
}

async function main() {
  await Promise.all([buildExtension(), buildWebview()]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
