import { siteConfig } from '../config';

const { sponsorship, achievements } = siteConfig;

export type QuoteLine = {
	variantId: number;
	title: string;
	trees: number;
	quantity: number;
	subtotal: number;
};

export type Quote = {
	trees: number;
	total: number;
	perTree: number;
	acres: number;
	lines: QuoteLine[];
	cartUrl: string;
	needsInvoice: boolean;
	/** Set when we rounded up to a bundle because it came out cheaper. */
	roundedUpFrom?: number;
};

/**
 * Trees per acre, worked out from our own published totals so the acreage on the
 * calculator always agrees with the achievement figures shown alongside it.
 */
export const treesPerAcre = Math.round(achievements.treesPlanted / achievements.acresRestored);

/** Largest tier first, so filling a basket greedily picks up the volume pricing. */
const tiers = [...sponsorship.tiers].sort((a, b) => b.trees - a.trees);

export const treeSteps = sponsorship.steps;
export const minTrees = sponsorship.min;
export const maxTrees = sponsorship.max;
export const defaultTrees = sponsorship.defaultTrees;
export const presets = sponsorship.presets;

export function clampTrees(value: number): number {
	if (!Number.isFinite(value)) return defaultTrees;
	return Math.min(maxTrees, Math.max(minTrees, Math.round(value)));
}

/**
 * Fill a basket from the biggest bundle down. The discount curve already set up
 * on the shop then applies on its own, so this needs no corporate-only products.
 */
function fillBasket(trees: number): { lines: QuoteLine[]; total: number } {
	const lines: QuoteLine[] = [];
	let remaining = trees;
	let total = 0;

	for (const tier of tiers) {
		const quantity = Math.floor(remaining / tier.trees);
		if (quantity === 0) continue;

		remaining -= quantity * tier.trees;
		total += quantity * tier.price;
		lines.push({
			variantId: tier.variantId,
			title: tier.title,
			trees: tier.trees,
			quantity,
			subtotal: quantity * tier.price,
		});
	}

	return { lines, total };
}

export function quoteFor(requested: number): Quote {
	const asked = clampTrees(requested);

	// Filling greedily can leave an awkward tail: 99 trees in small bundles costs
	// more than the 100 bundle does. Nobody should pay more for fewer trees, so
	// also price each bundle size rounded up and take whichever is cheapest.
	let trees = asked;
	let basket = fillBasket(asked);

	for (const tier of tiers) {
		const roundedUp = Math.ceil(asked / tier.trees) * tier.trees;
		if (roundedUp === asked || roundedUp > maxTrees) continue;

		const candidate = fillBasket(roundedUp);
		if (candidate.total < basket.total) {
			trees = roundedUp;
			basket = candidate;
		}
	}

	const items = basket.lines.map((line) => `${line.variantId}:${line.quantity}`).join(',');

	return {
		trees,
		total: basket.total,
		perTree: basket.total / trees,
		acres: trees / treesPerAcre,
		lines: basket.lines,
		// storefront=true lands them on the shop's own cart so they can review and
		// amend. Without it Shopify sends cart links straight out to checkout.
		cartUrl: `${sponsorship.shopUrl}/cart/${items}?storefront=true`,
		needsInvoice: trees >= sponsorship.invoiceThreshold,
		roundedUpFrom: trees === asked ? undefined : asked,
	};
}

/** Where the "get a written quote" button goes, carrying the figure across. */
export function quoteEnquiryUrl(trees: number): string {
	return `/contact?topic=corporate&trees=${clampTrees(trees)}`;
}

/**
 * Planting runs November to March, so anything funded now goes in during the
 * season that is either under way or next up.
 */
export function plantingSeason(now = new Date()): { label: string; maintainedTo: number } {
	const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

	return {
		label: `winter ${startYear}/${String(startYear + 1).slice(2)}`,
		maintainedTo: startYear + 1 + sponsorship.maintenanceYears,
	};
}

const gbpWhole = new Intl.NumberFormat('en-GB', {
	style: 'currency',
	currency: 'GBP',
	maximumFractionDigits: 0,
});

const gbpExact = new Intl.NumberFormat('en-GB', {
	style: 'currency',
	currency: 'GBP',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const plain = new Intl.NumberFormat('en-GB');

export const formatTotal = (value: number) => gbpWhole.format(value);
export const formatPerTree = (value: number) => gbpExact.format(value);
export const formatCount = (value: number) => plain.format(value);
export const formatAcres = (value: number) =>
	value < 10 ? value.toFixed(1) : plain.format(Math.round(value));
