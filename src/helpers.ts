export const toKebabCase = (str: string): string =>
	str
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/--+/g, '-')
		.trim();

const SITES_API_URL = 'https://api.protect.earth/sites';
const SITES_FETCH_TIMEOUT_MS = 10_000;

type SiteApiRecord = {
	name: string;
	[id: string]: unknown;
};

export async function fetchProtectEarthSitesSafely(): Promise<SiteApiRecord[]> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), SITES_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(SITES_API_URL, {
			signal: controller.signal,
			headers: { accept: 'application/json' },
		});

		if (!response.ok) {
			throw new Error(`Unexpected status ${response.status}`);
		}

		const payload = await response.json();
		if (!Array.isArray(payload)) {
			throw new Error('Unexpected payload shape');
		}

		return payload as SiteApiRecord[];
	} catch (error) {
		console.warn(
			'[sites] Failed to fetch Protect Earth sites API during build. Falling back to local content.',
			error,
		);
		return [];
	} finally {
		clearTimeout(timeout);
	}
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
