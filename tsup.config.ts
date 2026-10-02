import { defineConfig } from 'tsup';

// One self-contained ESM file: the Docker image needs no node_modules at runtime.
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  dts: false,
  noExternal: [/.*/],
  banner: { js: '#!/usr/bin/env node' },
});
