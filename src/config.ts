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
		treesPlanted: 158178,
		acresRestored: 400,
		acresUnderManagement: 248,
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
} as const;
