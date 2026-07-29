import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { renderOgImage, type OgImageOptions } from '../../../lib/og-image';
import { getCategoryName } from '../../../helpers';
import type { CategorySlug } from '../../../helpers';

export async function getStaticPaths() {
	const articles = await getCollection('articles');
	return articles.map((article) => {
		const { title, categories, thumbnail } = article.data;
		return {
			params: { slug: article.id.replace(/\.(md|mdx)$/i, '') },
			props: {
				title,
				kicker: categories?.length ? getCategoryName(categories[0] as CategorySlug) : undefined,
				photoPath: (thumbnail as { fsPath?: string } | undefined)?.fsPath,
			} satisfies OgImageOptions,
		};
	});
}

export const GET: APIRoute<OgImageOptions> = async ({ props }) => {
	return new Response(new Uint8Array(await renderOgImage(props)), {
		headers: { 'Content-Type': 'image/webp' },
	});
};
