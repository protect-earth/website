// Ref: https://docs.astro.build/en/guides/content-collections/

// 1. Import utilities from `astro:content`
import { defineCollection } from 'astro:content';

// 2. Import loader(s)
import { glob, file } from 'astro/loaders';

// 3. Import Zod
import { z } from 'astro/zod';

// 4. Define a `loader` and `schema` for each collection
const articles = defineCollection({
	loader: glob({ base: './src/content/articles', pattern: '**/*.{md, mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.date(),
		author: z.string(),
		thumbnail: z.string().optional(),
	}),
});

const events = defineCollection({
	loader: glob({ base: './src/content/events', pattern: '**/*.{md, mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		pubDate: z.date(),
		startDate: z.date(),
		endDate: z.date(),
		address: z.string(),
		map: z.string(),
		ics: z.string(),
		googleCal: z.string(),
		thumbnail: z.string().optional(),
		eventBrite: z.string().optional(),
	}),
});

const members = defineCollection({
	loader: file('./src/data/team.yaml'),
	schema: z.array(
		z.object({
			name: z.string(),
			role: z.string(),
			image: z.string(),
			imageAlt: z.string().default(''),
			bio: z.string(),
		}),
	),
});

const press = defineCollection({
	loader: file('./src/data/press-articles.yaml'),
	schema: z.array(
		z.object({
			title: z.string(),
			source: z.string(),
			url: z.string(),
			image: z.string(),
			imageAlt: z.string().default(''),
			description: z.string(),

			// TODO Improve conversion or use full dates.
			date: z.string().transform((value) => new Date(value)),
		}),
	),
});

const siteMeta = defineCollection({
	loader: glob({ base: './src/content/siteMeta', pattern: '**/*.md' }),
	schema: ({ image }) =>
		z.object({
			fundingPartners: z.array(z.string()).optional(),
			tags: z.array(z.string()),
			notionIds: z.array(z.string()).optional(),
			images: z.array(image()).optional(),
		}),
});

const siteUpdates = defineCollection({
	loader: glob({ base: './src/content/site-updates', pattern: '**/*.md' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			notionId: z.string(),
			type: z.string().optional(),
			date: z.string().optional(),
			siteNotionId: z.string().optional(),
			treesPlanted: z.number().optional(),
			treesRestocked: z.number().optional(),
			survivalRate: z.number().optional(),
			photos: z.array(image()).optional(),
		}),
});

// 5. Export a single `collections` object to register your collection(s)
export const collections = { articles, events, members, press, siteMeta, siteUpdates };
