import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { initPreContext, preHtml, preJs } from '@dcloudio/uni-cli-shared';

initPreContext('mp-weixin');

// Intentionally independent: never execute the mini-program production plugin.
export default defineConfig({
  plugins: [{ name: 'weixin-component-branches', enforce: 'pre', transform(source, id) {
    if (!id.includes('/@wot-ui/') && !id.includes('/@wot-ui+')) return;
    if (id.endsWith('.vue')) return preJs(preHtml(source, id), id);
    if (id.endsWith('.ts')) return preJs(source, id);
  } }, vue({ template: { compilerOptions: { isCustomElement: tag => tag === 'page-meta', nodeTransforms: [node => {
    if (node.type === 1 && ['view', 'text', 'button', 'input', 'textarea'].includes(node.tag)) {
      node.tag = `Uni${node.tag[0].toUpperCase()}${node.tag.slice(1)}`; node.tagType = 1;
    }
  }] } } })],
  resolve: { alias: {
    '@dcloudio/uni-app': fileURLToPath(new URL('./tests/support/uni-lifecycle.ts', import.meta.url)),
    'home-contracts': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-contracts/index.ts', import.meta.url)),
    'home-kernel': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-kernel/index.ts', import.meta.url)),
    'home-family': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-family/index.ts', import.meta.url)),
    'home-media': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-media/index.ts', import.meta.url)),
    'home-recipes': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-recipes/index.ts', import.meta.url)),
    'home-imports': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-imports/index.ts', import.meta.url)),
  } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
