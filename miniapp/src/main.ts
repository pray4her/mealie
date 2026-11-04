import { createSSRApp } from 'vue';
import App from './App.vue';
import { provideAppClient } from './shared/app-client';
import { createProductionClient } from './shared/production-client';

export function createApp() {
  const app = createSSRApp(App);
  provideAppClient(app, createProductionClient());
  return { app };
}
