export const toKebabCase = (str: string): string =>
	str
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/--+/g, '-')
		.trim();

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
