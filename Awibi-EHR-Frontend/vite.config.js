import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the vendor libraries out of the application bundle.
         *
         * This shipped as a single 1.4 MB file, which on a Nigerian mobile
         * connection is a long wait before anything appears — and the whole
         * thing was re-downloaded on every deployment. Vendor code changes far
         * less often than application code, so separating it means a routine
         * release only invalidates the small half.
         *
         * Charts are separated again because only the clinical screens use
         * them; a receptionist never loads that code at all.
         */
        manualChunks(id) {
          const at = id.lastIndexOf('node_modules/');
          if (at === -1) return undefined;
          // Match on the package name, not anywhere in the path. Matching a bare
          // substring put packages whose *path* merely contained "react" into
          // the react chunk, which made the chunks import each other in a cycle.
          const rest = id.slice(at + 'node_modules/'.length);
          const pkg = rest.startsWith('@')
            ? rest.split('/').slice(0, 2).join('/')
            : rest.split('/')[0];

          if (pkg === 'recharts' || pkg.startsWith('d3-') || pkg === 'victory-vendor') return 'charts';
          if (['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom', '@remix-run/router']
            .includes(pkg)) return 'react';
          if (pkg.startsWith('@tanstack') || pkg.includes('redux') || pkg === 'zustand') return 'state';
          if (pkg === 'lucide-react' || pkg.startsWith('@tabler')) return 'icons';
          return 'vendor';
        },
      },
    },
    // The remaining warning threshold is about the app bundle, not the vendors.
    chunkSizeWarningLimit: 700,
  },
  server: {
    // 5173 and 5174 are used by other local projects on this workstation.
    // Keep Awibi on one predictable URL instead of letting Vite silently shift ports.
    port: 5177,
    strictPort: true,
    proxy: {
      '/v1': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
