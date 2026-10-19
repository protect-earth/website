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
	roundedUpFrom?: number;
};

export const treesPerAcre = Math.round(achievements.treesPlanted / achievements.acresRestored);

// largest tier first, so that volume pricing can be applied
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
		cartUrl: `${sponsorship.shopUrl}/cart/${items}?storefront=true`,
		needsInvoice: trees >= sponsorship.invoiceThreshold,
		roundedUpFrom: trees === asked ? undefined : asked,
	};
}

export function quoteEnquiryUrl(trees: number): string {
	return `/contact?topic=corporate&trees=${clampTrees(trees)}`;
}

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
