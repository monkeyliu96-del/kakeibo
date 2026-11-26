import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* 构建后把带哈希的资源文件列表写进 sw.js,这样第一次打开后就能完全离线使用;
   构建号由这些文件名决定,代码一变 sw.js 就变,浏览器会自动更新缓存 */
function swPrecache(): Plugin {
  let outDir = 'dist';
  const assets: string[] = [];
  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir; },
    generateBundle(_o, bundle) {
      for (const f of Object.keys(bundle)) if (/\.(js|css)$/.test(f)) assets.push(f);
    },
    closeBundle() {
      const p = join(outDir, 'sw.js');
      const build = createHash('sha1').update(assets.sort().join('|')).digest('hex').slice(0, 8);
      const src = readFileSync(p, 'utf8')
        .replace("/*__BUILD__*/'dev'", JSON.stringify(build))
        .replace('/*__ASSETS__*/[]', JSON.stringify(assets));
      writeFileSync(p, src);
    },
  };
}


// GitHub Pages 发布在 /仓库名/ 下,用相对路径让它在任何位置都能打开
export default defineConfig({
  base: './',
  plugins: [swPrecache()],
  // 用 esbuild 压缩 CSS:默认的压缩器会自动给 system-ui 追加一串备用字体,改变显示效果
  build: { target: 'es2020', sourcemap: false, cssMinify: 'esbuild' },
});
