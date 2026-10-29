const domain = import.meta.env.PUBLIC_SHOPIFY_STORE_DOMAIN;
const token = import.meta.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
const apiVersion = import.meta.env.PUBLIC_SHOPIFY_API_VERSION || '2025-01';

// Must match the line item property used by the previous Shopify theme, so fulfilment is unchanged
export const RECIPIENT_NAME_KEY = 'Names';
export const RECIPIENT_EMAIL_KEY = 'Emails';

export type Money = { amount: string; currencyCode: string };
export type Image = { url: string; altText: string | null };

export type SellingPlanAllocation = {
	sellingPlan: { id: string; name: string };
	priceAdjustments: { price: Money }[];
};

export type Variant = {
	id: string;
	title: string;
	availableForSale: boolean;
	price: Money;
	sellingPlanAllocations: { nodes: SellingPlanAllocation[] };
};

export type ProductSummary = {
	handle: string;
	title: string;
	description: string;
	availableForSale: boolean;
	featuredImage: Image | null;
	priceRange: { minVariantPrice: Money };
};

export type Product = ProductSummary & {
	descriptionHtml: string;
	requiresSellingPlan: boolean;
	images: { nodes: Image[] };
	variants: { nodes: Variant[] };
};

export const isConfigured = Boolean(domain && token);

export async function storefront<T>(
	query: string,
	variables: Record<string, unknown> = {},
): Promise<T> {
	if (!isConfigured) throw new Error('Shopify env vars are not set');

	const res = await fetch(`https://${domain}/api/${apiVersion}/graphql.json`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Shopify-Storefront-Access-Token': token,
		},
		body: JSON.stringify({ query, variables }),
	});
	if (!res.ok) throw new Error(`Storefront API ${res.status}`);

	const json = await res.json();
	if (json.errors) throw new Error(JSON.stringify(json.errors));
	return json.data as T;
}

const SUMMARY_FIELDS = `
	handle
	title
	description
	availableForSale
	featuredImage { url altText }
	priceRange { minVariantPrice { amount currencyCode } }
`;

const PRODUCT_FIELDS = `
	${SUMMARY_FIELDS}
	descriptionHtml
	requiresSellingPlan
	images(first: 6) { nodes { url altText } }
	variants(first: 50) {
		nodes {
			id
			title
			availableForSale
			price { amount currencyCode }
			sellingPlanAllocations(first: 5) {
				nodes {
					sellingPlan { id name }
					priceAdjustments { price { amount currencyCode } }
				}
			}
		}
	}
`;

// Returns false (dev) or throws (production build) when Shopify isn't configured
function ensureConfigured(): boolean {
	if (isConfigured) return true;
	if (import.meta.env.PROD) {
		throw new Error('PUBLIC_SHOPIFY_STORE_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN must be set');
	}
	console.warn('[shopify] env vars not set, the store will be empty');
	return false;
}

export async function getProducts(): Promise<ProductSummary[]> {
	if (!ensureConfigured()) return [];

	const data = await storefront<{ products: { nodes: ProductSummary[] } }>(
		`{ products(first: 50, sortKey: BEST_SELLING) { nodes { ${SUMMARY_FIELDS} } } }`,
	);
	return data.products.nodes;
}

export async function getProduct(handle: string): Promise<Product | null> {
	const data = await storefront<{ product: Product | null }>(
		`query($handle: String!) { product(handle: $handle) { ${PRODUCT_FIELDS} } }`,
		{ handle },
	);
	return data.product;
}

export type CheckoutLine = {
	merchandiseId: string;
	quantity: number;
	sellingPlanId?: string;
	attributes?: { key: string; value: string }[];
};

// Creates a Shopify-hosted cart and returns its URL, so Shopify handles the cart and checkout
export async function createCheckout(line: CheckoutLine): Promise<string> {
	const { cartCreate } = await storefront<{
		cartCreate: { cart: { checkoutUrl: string } | null; userErrors: { message: string }[] };
	}>(
		`mutation($lines: [CartLineInput!]!) {
			cartCreate(input: { lines: $lines }) { cart { checkoutUrl } userErrors { message } }
		}`,
		{ lines: [line] },
	);

	if (!cartCreate.cart) throw new Error(cartCreate.userErrors[0]?.message ?? 'Cart failed');
	return cartCreate.cart.checkoutUrl;
}

export function formatMoney({ amount, currencyCode }: Money): string {
	const value = Number(amount);
	return new Intl.NumberFormat('en-GB', {
		style: 'currency',
		currency: currencyCode,
		minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
		maximumFractionDigits: 2,
	}).format(value);
}

export function imageUrl(url: string, width: number): string {
	return `${url}${url.includes('?') ? '&' : '?'}width=${width}`;
}
