import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => ({
  resolve: { alias: mode === 'ui-review' ? [{ find: './shared/production-client', replacement: fileURLToPath(new URL('./review/app-client.ts', import.meta.url)) }] : [] },
  plugins: [uni(), ...(mode === 'ui-review' ? [{
    name: 'isolated-ui-review-assets',
    writeBundle(options: { dir?: string }) {
      if (!options.dir) throw new Error('UI review output directory missing');
      const out = resolve(options.dir, 'static/ui-review'); mkdirSync(out, { recursive: true });
      for (const name of ['noodles', 'chicken', 'rice', 'salad']) copyFileSync(fileURLToPath(new URL('./design-preview/assets/' + name + '.jpg', import.meta.url)), resolve(out, name + '.jpg'));
    },
  }] : [])],
}));
