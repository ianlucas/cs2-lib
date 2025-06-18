import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';
import del from 'rollup-plugin-delete'

export default defineConfig({
    input: ['src/index.ts', 'src/translations/index.ts'],
    plugins: [
        del({ targets: ['dist'] }),
        dts(),
    ],
    treeshake: true,
    output: {
        dir: 'dist',
        format: 'esm',
        minify: true,
        entryFileNames: '[name].mjs',
        chunkFileNames: '_chunks/[name]-[hash].mjs',
        preserveModules: true,
        preserveModulesRoot: 'src'
    },
});