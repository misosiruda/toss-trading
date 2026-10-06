import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'tests/run-comparison',testMatch:'*.spec.ts',workers:1,retries:0,timeout:30_000,expect:{timeout:5_000},
  use:{baseURL:'http://127.0.0.1:3006',trace:'off',screenshot:'off'},
  webServer:[{command:'node tests/run-comparison/fixture-api.mjs',url:'http://127.0.0.1:8795/health',reuseExistingServer:false,timeout:15_000},
    {command:'npm run start -- --hostname 127.0.0.1 --port 3006',url:'http://127.0.0.1:3006/dashboard/experiments/compare',reuseExistingServer:false,timeout:120_000,env:{NEXT_TELEMETRY_DISABLED:'1',DASHBOARD_OPS_API_BASE_URL:'',OPS_API_BASE_URL:'http://127.0.0.1:8795'}}],
  projects:[{name:'ux06-desktop-1440',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'ux06-tablet-1024',use:{...devices['Desktop Chrome'],viewport:{width:1024,height:900}}},{name:'ux06-mobile-390',use:{...devices['iPhone 13'],defaultBrowserType:'chromium',viewport:{width:390,height:844}}}]
});
