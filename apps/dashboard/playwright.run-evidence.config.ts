import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'tests/run-evidence',testMatch:'*.spec.ts',workers:1,retries:0,timeout:30_000,expect:{timeout:5_000},
  use:{baseURL:'http://127.0.0.1:3005',trace:'off',screenshot:'off'},
  webServer:[{command:'node tests/run-evidence/fixture-api.mjs',url:'http://127.0.0.1:8794/health',reuseExistingServer:false,timeout:15_000},
    {command:'npm run start -- --hostname 127.0.0.1 --port 3005',url:'http://127.0.0.1:3005/dashboard/lab/runs/fixture_evidence_normal',reuseExistingServer:false,timeout:120_000,env:{NEXT_TELEMETRY_DISABLED:'1',DASHBOARD_OPS_API_BASE_URL:'',OPS_API_BASE_URL:'http://127.0.0.1:8794'}}],
  projects:[{name:'ux05-desktop-1440',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'ux05-tablet-1024',use:{...devices['Desktop Chrome'],viewport:{width:1024,height:900}}},{name:'ux05-mobile-390',use:{...devices['iPhone 13'],defaultBrowserType:'chromium',viewport:{width:390,height:844}}}]
});
