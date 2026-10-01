import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8765/web/',
    headless: true,
    launchOptions: {args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']},
  },
  webServer: {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1 --directory ..',
    url: 'http://127.0.0.1:8765/web/',
    reuseExistingServer: false,
  },
});
