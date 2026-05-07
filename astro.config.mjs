// @ts-check
import { defineConfig } from 'astro/config';
import yaml from '@rollup/plugin-yaml';
import netlify from '@astrojs/netlify';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
	site: 'https://www.protect.earth',
	output: 'static',
	adapter: netlify(),

	vite: {
		plugins: [yaml()],
	},

	integrations: [mdx()],
});
