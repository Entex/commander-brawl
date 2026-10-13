import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Only the app's own code may run in the window. Added at build time; the dev server needs inline scripts.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    outDir: resolve(import.meta.dirname, '../../build/app/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
  },
  server: { port: 5173, strictPort: true },
});
