import { defineCollection, z } from 'astro:content';

const teamCollection = defineCollection({
	type: 'data',
	schema: z.object({
		name: z.string(),
		role: z.string(),
		image: z.string(),
		bio: z.string(),
	}),
});

const pressArticlesCollection = defineCollection({
	type: 'data',
	schema: z.object({
		title: z.string(),
		publication: z.string(),
		date: z.string(),
		url: z.string(),
	}),
});

const sitesCollection = defineCollection({
	type: 'content',
	schema: ({ image }) =>
		z.object({
			notionIds: z.array(z.string()).optional(),
			fundingPartners: z.array(z.string()).optional(),
			tags: z.array(z.string()).optional(),
			images: z.array(image()).optional(),
		}),
});

const articlesCollection = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		author: z.string(),
		thumbnail: z.string().optional(),
	}),
});

const eventsCollection = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		pubDate: z.coerce.date(),
		startDate: z.date(),
		endDate: z.date(),
		address: z.string(),
		map: z.string(),
		ics: z.string(),
		googleCal: z.string(),
		thumbnail: z.string().optional(),
		eventbriteLink: z.string().optional(),
	}),
});

const siteUpdatesCollection = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		notionId: z.string(),
		type: z.string().optional(),
		date: z.coerce.date().optional(),
		siteNotionId: z.string().optional(),
		treesPlanted: z.number().optional(),
		survivalRate: z.number().optional(),
		treesRestocked: z.number().optional(),
		photos: z.array(z.string()).optional(),
	}),
});

export const collections = {
	team: teamCollection,
	'press-articles': pressArticlesCollection,
	sites: sitesCollection,
	articles: articlesCollection,
	'site-updates': siteUpdatesCollection,
};
