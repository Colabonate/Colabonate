import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    host: true,
    fs: {
      // Monorepo: Assets aus packages/ dürfen über /@fs/ ausgeliefert werden
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  resolve: {
    alias: {
      '@ds/tokens': path.resolve(__dirname, '../../packages/tokens'),
      '@ds/ui':     path.resolve(__dirname, '../../packages/ui/index.ts'),
      '@ds/utils':  path.resolve(__dirname, '../../packages/utils/index.ts'),
    },
  },
});
