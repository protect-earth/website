// Site configuration
export const siteConfig = {
	name: 'Protect Earth',
	tagline: 'Creating and restoring ecosystems in the UK',
	charityNumber: '1192453',

	contact: {
		email: 'help@protect.earth',
		phone: { label: '+44 (0) 300 302 0065', link: 'tel:+443003020065' },
	},

	social: {
		threads: 'https://www.threads.net/@protectearthuk',
		instagram: 'https://instagram.com/ProtectEarthUK',
		facebook: 'https://facebook.com/ProtectEarthUK',
	},

	achievements: {
		treesPlanted: 161028,
		survivalRate: 79.9,
		hedgerowsMeters: 5180,
		acresRestored: 400,
		acresUnderManagement: 248,
		volunteerHours: 14236,
	},

	// Corporate sponsorship pricing, used by the calculator
	//
	// Tiers point at products currently live on shop.protect.earth and must stay up-to-date with them
	// Variant IDs and prices come from shop.protect.earth/products.json
	// The calculator fills a basket from the biggest tier down, so the volume pricing already set up on the shop gets applied
	sponsorship: {
		shopUrl: 'https://shop.protect.earth',
		tiers: [
			{ trees: 100, price: 460, variantId: 45583700623661, title: 'Plant 100 Trees in the UK' },
			{ trees: 25, price: 120, variantId: 45583702130989, title: 'Plant 25 Trees in the UK' },
			{ trees: 5, price: 25, variantId: 45583702393133, title: 'Plant 5 Trees in the UK' },
			{ trees: 1, price: 5, variantId: 45583702491437, title: 'Plant a Tree' },
		],
		steps: [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
		presets: [100, 500, 1000, 5000],
		min: 25,
		max: 50000,
		defaultTrees: 1000,
		invoiceThreshold: 5000,
		maintenanceYears: 3,
	},

	analytics: {
		fathomSiteId: 'OHKWVQNB',
	},

	// Sites to ignore from API data
	ignoredSites: ['Burnsall', 'Donkeywell Farm', 'Newcastle Emlyn', 'Wraxall'],

	categories: {
		'woodland-management': 'Woodland Management',
		'woodland-creation': 'Woodland Creation',
		'conservation-biodiversity': 'Conservation & Biodiversity',
		'invasive-species': 'Invasive Species',
		'updates-progress': 'Updates & Progress',
		'community-volunteering': 'Community & Volunteering',
		'sustainable-farming': 'Sustainable Farming',
		'climate-environment': 'Climate & Environment',
		'policy-funding': 'Policy & Funding',
		'wildlife-habitats': 'Wildlife & Habitats',
	},

	timezone: 'Europe/London',
} as const;
