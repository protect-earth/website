// @ts-check
import { defineConfig } from 'astro/config';
import yaml from '@rollup/plugin-yaml';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
	site: 'https://www.protect.earth',
	output: 'static',
	adapter: netlify(),
	vite: {
		plugins: [yaml()],
	},
});
