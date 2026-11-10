import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

const output = fileURLToPath(new URL('../../../.superpowers/ui-visual/mp-weixin', import.meta.url));
export default mergeConfig(base, defineConfig({
  plugins: [{ name: 'offline-visual-client', enforce: 'pre',
    configResolved(config) { if (resolve(config.build.outDir) !== output) throw new Error('Visual builds require --outDir ../.superpowers/ui-visual/mp-weixin'); },
    resolveId(source, importer) {
      if (source === './shared/production-client' && importer?.replaceAll('\\', '/').endsWith('/src/main.ts')) return fileURLToPath(new URL('./entry.ts', import.meta.url));
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'static/visual-chicken.jpg', source: readFileSync(fileURLToPath(new URL('../../design-preview/assets/chicken.jpg', import.meta.url))) }); },
  }],
  build: { outDir: output },
}));
