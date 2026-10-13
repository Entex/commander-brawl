import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, '../../build/app/phone'),
    emptyOutDir: true,
    // Phones keep older browsers around longer than desktops do.
    target: ['safari15', 'chrome100'],
  },
});
