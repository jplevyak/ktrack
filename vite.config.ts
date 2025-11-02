import { sveltekit } from "@sveltejs/kit/vite";
import type { UserConfig } from "vite";

const config: UserConfig = {
  plugins: [sveltekit()],
  server: {
    allowedHosts: [
      'localhost',
      '192.168.0.3',
      'ktrack.local',
      'test.ktrack.org',
      'ktrack.org',
    ]
  },
  build: {
    sourcemap: true,
  },
};

export default config;
