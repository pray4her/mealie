import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

export default mergeConfig(base, defineConfig({
  plugins: [{ name: 'offline-visual-client', enforce: 'pre',
    resolveId(source, importer) {
      if (source === './shared/production-client' && importer?.replaceAll('\\', '/').endsWith('/src/main.ts')) return fileURLToPath(new URL('./entry.ts', import.meta.url));
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'static/visual-chicken.jpg', source: readFileSync(fileURLToPath(new URL('../../design-preview/assets/chicken.jpg', import.meta.url))) }); },
  }],
  build: { outDir: fileURLToPath(new URL('../../../.superpowers/ui-visual/mp-weixin', import.meta.url)) },
}));
