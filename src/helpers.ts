import { siteConfig } from './config';

export const toKebabCase = (str: string): string =>
	str
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/--+/g, '-')
		.trim();

// Site work stats
const ACRE_IN_SQUARE_METERS = 4_046.86;

export function formatWorkUnits(units: number, label: string): { value: string; unit: string } {
	return label === 'square meters'
		? {
				value: (units / ACRE_IN_SQUARE_METERS).toLocaleString('en-GB', {
					maximumFractionDigits: 1,
				}),
				unit: 'acres',
			}
		: { value: units.toLocaleString(), unit: label };
}

// Article categories
export type CategorySlug = keyof typeof siteConfig.categories;

export function getCategoryName(slug: CategorySlug): string {
	return siteConfig.categories[slug];
}

// Site API fetching
const SITES_API_URL = 'https://api.protect.earth/sites';
const SITES_FETCH_TIMEOUT_MS = 10_000;

let sitesPromise: Promise<SiteApiRecord[]> | undefined;

type SiteApiRecord = {
	id: string;
	name: string;
	[id: string]: unknown;
};

async function fetchResource(url: string): Promise<SiteApiRecord> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), SITES_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { accept: 'application/json' },
		});

		if (!response.ok) {
			throw new Error(`Unexpected status ${response.status}`);
		}

		return (await response.json()) as SiteApiRecord;
	} finally {
		clearTimeout(timeout);
	}
}

async function loadSites(): Promise<SiteApiRecord[]> {
	try {
		const payload = await fetchResource(SITES_API_URL);
		if (!Array.isArray(payload)) {
			throw new Error('Unexpected payload shape');
		}

		return payload as SiteApiRecord[];
	} catch (error) {
		console.warn(
			'[sites] Failed to fetch sites during build. Falling back to local content.',
			error,
		);
		return [];
	}
}

export function fetchSites(): Promise<SiteApiRecord[]> {
	sitesPromise ??= loadSites();
	return sitesPromise;
}

export const isSameDay = (start: any, end: any): boolean => {
	let starts, ends;
	let day = false;

	starts = start.toLocaleString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	});

	ends = end.toLocaleString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	});

	if (starts === ends) {
		day = true;
	}
	return day;
};
