#!/usr/bin/env node
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import matter from 'gray-matter';
import TurndownService from 'turndown';
import eventbrite from 'eventbrite';
import { fileURLToPath } from 'url';

config();

const MANIFEST_FILENAME = '.manifest.json';
const DEFAULT_STATUSES = 'live,started';

const EVENTBRITE_PRIVATE_TOKEN = process.env.EVENTBRITE_PRIVATE_TOKEN;
const EVENTBRITE_ORGANIZATION_ID = process.env.EVENTBRITE_ORGANIZATION_ID;
const EVENTBRITE_EVENT_STATUSES = process.env.EVENTBRITE_EVENT_STATUSES || DEFAULT_STATUSES;

if (!EVENTBRITE_PRIVATE_TOKEN) {
	console.error('Error: EVENTBRITE_PRIVATE_TOKEN environment variable is required');
	process.exit(1);
}

const createEventbriteSdk = typeof eventbrite === 'function' ? eventbrite : eventbrite?.default;
if (!createEventbriteSdk) {
	console.error('Error: Could not initialize Eventbrite SDK');
	process.exit(1);
}
const sdk = createEventbriteSdk({ token: EVENTBRITE_PRIVATE_TOKEN });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EVENTS_CONTENT_DIR = path.join(__dirname, '../src/content/events');
const EVENTS_PUBLIC_DIR = path.join(__dirname, '../public/events');
const LOCAL_IMAGES_DIR = path.join(__dirname, '../src/assets/events');
const TEMP_DIR = path.join(__dirname, '../.temp-eventbrite-images');
const MANIFEST_PATH = path.join(LOCAL_IMAGES_DIR, MANIFEST_FILENAME);
const EVENT_ASSET_PATH_PREFIX = '../../assets/events';
const turndown = new TurndownService({
	headingStyle: 'atx',
	bulletListMarker: '-',
	codeBlockStyle: 'fenced',
});

function ensureDirectory(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

function slugify(value) {
	return value
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

function eventSlug(event) {
	const titleSlug = slugify(event.name?.text || `event-${event.id}`);
	const suffix = String(event.id || '').trim();
	if (!suffix) {
		return titleSlug || `event-${Date.now()}`;
	}

	const maxTitleLength = Math.max(20, 90 - suffix.length - 1);
	const trimmed = titleSlug.slice(0, maxTitleLength).replace(/-+$/g, '');
	return `${trimmed || 'event'}-${suffix}`;
}

function cleanText(value) {
	if (typeof value !== 'string') {
		return '';
	}

	return value
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/\u00a0/g, ' ')
		.trim();
}

function normalizeMarkdownArtifacts(markdown) {
	if (!markdown) {
		return '';
	}

	return cleanText(markdown)
		.split('\n')
		.map((line) => {
			let normalizedLine = line.replace(/\*{4,}([^\n*]+?)\*{4,}/g, '**$1**');
			normalizedLine = normalizedLine.replace(/\*{4,}/g, '**');

			if (/\w\*\*|\*\*\w/.test(normalizedLine)) {
				return normalizedLine.replace(/\*\*/g, '');
			}

			return normalizedLine;
		})
		.join('\n');
}

function toIsoDate(value, fallbackDate = new Date()) {
	const parsed = value ? new Date(value) : fallbackDate;
	if (Number.isNaN(parsed.valueOf())) {
		return fallbackDate.toISOString();
	}
	return parsed.toISOString();
}

function asDate(value, fallbackDate = new Date()) {
	const parsed = value ? new Date(value) : fallbackDate;
	if (Number.isNaN(parsed.valueOf())) {
		return fallbackDate;
	}
	return parsed;
}

function normalizeAddress(address = {}) {
	const locality = cleanText(address.city || address.region || '');
	const postcode = cleanText(address.postal_code || '');

	if (locality && postcode) {
		return `${locality}, ${postcode}`;
	}

	return locality || postcode;
}

function buildMapUrl(address, latitude, longitude) {
	if (latitude && longitude) {
		return `https://maps.google.com/?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
	}

	if (!address) {
		return '';
	}

	return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

function htmlDescriptionToMarkdown(html, summary) {
	if (!html) {
		return '';
	}

	const markdown = normalizeMarkdownArtifacts(turndown.turndown(html));
	const trimmedMarkdown = trimLeadingSummaryFromText(markdown, summary);
	return trimmedMarkdown || markdown;
}
function extractMediaIdsFromWidgets(widgets) {
	const mediaIds = new Set();
	const mediaUrls = new Set();
	const widgetList = Array.isArray(widgets) ? widgets : [];

	for (const widget of widgetList) {
		const slides = Array.isArray(widget?.data?.slides) ? widget.data.slides : [];
		for (const slide of slides) {
			const image = slide?.image;
			if (!image || typeof image !== 'object') {
				continue;
			}

			if (image.image_id) {
				mediaIds.add(String(image.image_id));
			}

			if (typeof image?.original?.url === 'string' && image.original.url) {
				mediaUrls.add(image.original.url);
			} else if (typeof image?.url === 'string' && image.url) {
				mediaUrls.add(image.url);
			}
		}
	}

	return {
		mediaIds: [...mediaIds],
		mediaUrls: [...mediaUrls],
	};
}

async function fetchEventStructuredContentData(eventId) {
	if (!eventId) {
		return { html: '', mediaIds: [], mediaUrls: [] };
	}

	try {
		const payload = await requestEventbrite(`/events/${eventId}/structured_content/`);
		const modules = Array.isArray(payload?.modules) ? payload.modules : [];
		const html = modules
			.filter((module) => module?.type === 'text')
			.map((module) => module?.data?.body?.text || '')
			.join('\n');
		const { mediaIds, mediaUrls } = extractMediaIdsFromWidgets(payload?.widgets);

		return { html, mediaIds, mediaUrls };
	} catch {
		return { html: '', mediaIds: [], mediaUrls: [] };
	}
}

function extractMediaIdsFromHtml(html) {
	const mediaIds = new Set();
	const text = String(html || '');

	for (const match of text.matchAll(/\/images\/(\d+)\//g)) {
		if (match?.[1]) {
			mediaIds.add(match[1]);
		}
	}

	for (const match of text.matchAll(/%2Fimages%2F(\d+)%2F/gi)) {
		if (match?.[1]) {
			mediaIds.add(match[1]);
		}
	}

	return [...mediaIds];
}

function getEventMediaIds(event, structuredContentHtml) {
	const mediaIds = new Set();

	for (const mediaId of extractMediaIdsFromHtml(structuredContentHtml)) {
		mediaIds.add(mediaId);
	}

	return [...mediaIds];
}

async function fetchMediaUrl(mediaId, width = 1200, height = 1200) {
	if (!mediaId) {
		return '';
	}

	try {
		const payload = await requestEventbrite(`/media/${mediaId}/?width=${width}&height=${height}`);
		return payload?.original?.url || payload?.url || '';
	} catch {
		return '';
	}
}

function trimLeadingSummaryFromText(descriptionText, summary) {
	const bodyText = cleanText(descriptionText);
	if (!bodyText) {
		return '';
	}

	const normalizedSummary = cleanText(summary);
	if (!normalizedSummary) {
		return bodyText;
	}

	const paragraphs = bodyText
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.filter(Boolean);

	if (paragraphs.length > 0 && paragraphs[0] === normalizedSummary) {
		return paragraphs.slice(1).join('\n\n').trim();
	}

	return bodyText;
}

function loadManifest() {
	if (!fs.existsSync(MANIFEST_PATH)) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
	} catch (error) {
		console.warn(`Warning: could not parse ${MANIFEST_PATH}: ${error.message}`);
		return {};
	}
}

function saveManifest(manifest) {
	ensureDirectory(LOCAL_IMAGES_DIR);
	fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function hashFile(filePath) {
	return await new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

async function requestEventbrite(endpoint, options) {
	try {
		return await sdk.request(endpoint, options);
	} catch (error) {
		const status = error?.response?.status_code || 'unknown';
		const detail =
			error?.response?.error_description || error?.message || 'Unexpected Eventbrite SDK error';
		throw new Error(`Eventbrite API ${status}: ${detail}`);
	}
}

async function fetchAllEvents() {
	const encodedStatuses = encodeURIComponent(EVENTBRITE_EVENT_STATUSES);
	const baseEndpoint = EVENTBRITE_ORGANIZATION_ID
		? `/organizations/${EVENTBRITE_ORGANIZATION_ID}/events/?status=${encodedStatuses}&order_by=start_asc&page_size=50&expand=venue,logo`
		: `/users/me/owned_events/?status=${encodedStatuses}&order_by=start_asc&page_size=50&expand=venue,logo`;
	let endpoint = baseEndpoint;

	const allEvents = [];

	while (endpoint) {
		const payload = await requestEventbrite(endpoint);
		const events = Array.isArray(payload.events) ? payload.events : [];
		allEvents.push(...events);

		if (payload.pagination?.has_more && payload.pagination?.continuation) {
			const continuation = encodeURIComponent(payload.pagination.continuation);
			endpoint = `${baseEndpoint}&continuation=${continuation}`;
		} else {
			endpoint = '';
		}
	}

	return allEvents;
}

async function fetchVenue(venueId) {
	if (!venueId) {
		return null;
	}

	try {
		return await requestEventbrite(`/venues/${venueId}/`);
	} catch (error) {
		console.warn(`Warning: failed to fetch venue ${venueId}: ${error.message}`);
		return null;
	}
}

async function downloadToFile(url, outputPath) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	ensureDirectory(path.dirname(outputPath));
	fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
}

async function localizeEventImage({ eventId, slug, imageUrl, previousEntry }) {
	if (!imageUrl) {
		return '';
	}

	const existingPath = resolveThumbnailAbsolutePath(previousEntry?.thumbnail || '');
	if (
		existingPath &&
		fs.existsSync(existingPath) &&
		previousEntry?.sourceImageUrl &&
		previousEntry.sourceImageUrl === imageUrl
	) {
		return previousEntry.thumbnail;
	}

	ensureDirectory(TEMP_DIR);
	ensureDirectory(LOCAL_IMAGES_DIR);
	ensureDirectory(path.join(LOCAL_IMAGES_DIR, slug));

	const tempInputPath = path.join(TEMP_DIR, `${eventId}.tmp`);
	const tempOutputPath = path.join(TEMP_DIR, `${eventId}.jpg`);
	await downloadToFile(imageUrl, tempInputPath);
	await sharp(tempInputPath)
		.rotate()
		.resize(1200, null, {
			fit: 'inside',
			withoutEnlargement: true,
		})
		.jpeg({ quality: 85, progressive: true })
		.toFile(tempOutputPath);

	const checksum = await hashFile(tempOutputPath);
	const imageFileName = `${checksum.slice(0, 12)}.jpg`;
	const finalImagePath = path.join(LOCAL_IMAGES_DIR, slug, imageFileName);

	if (!fs.existsSync(finalImagePath)) {
		fs.renameSync(tempOutputPath, finalImagePath);
	} else {
		fs.unlinkSync(tempOutputPath);
	}

	if (fs.existsSync(tempInputPath)) {
		fs.unlinkSync(tempInputPath);
	}

	return `${EVENT_ASSET_PATH_PREFIX}/${slug}/${imageFileName}`;
}

async function localizeEventMediaImages({ eventId, slug, mediaIds, previousEntry }) {
	const uniqueMediaIds = [...new Set((mediaIds || []).filter(Boolean))];
	const localized = [];

	for (const mediaId of uniqueMediaIds) {
		const mediaUrl = await fetchMediaUrl(mediaId);
		if (!mediaUrl) {
			continue;
		}

		const imagePath = await localizeEventImage({
			eventId: `${eventId}-${mediaId}`,
			slug,
			imageUrl: mediaUrl,
			previousEntry,
		});

		if (imagePath) {
			localized.push(imagePath);
		}
	}

	return [...new Set(localized)];
}

async function localizeEventMediaUrls({ eventId, slug, mediaUrls, previousEntry }) {
	const uniqueMediaUrls = [...new Set((mediaUrls || []).filter(Boolean))];
	const localized = [];

	for (const mediaUrl of uniqueMediaUrls) {
		if (!mediaUrl) {
			continue;
		}

		const imagePath = await localizeEventImage({
			eventId: `${eventId}-${crypto.createHash('sha1').update(mediaUrl).digest('hex').slice(0, 10)}`,
			slug,
			imageUrl: mediaUrl,
			previousEntry,
		});

		if (imagePath) {
			localized.push(imagePath);
		}
	}

	return [...new Set(localized)];
}

function resolveThumbnailAbsolutePath(thumbnailPath) {
	if (!thumbnailPath || typeof thumbnailPath !== 'string') {
		return '';
	}

	if (thumbnailPath.startsWith('../../assets/')) {
		return path.resolve(EVENTS_CONTENT_DIR, thumbnailPath);
	}

	if (thumbnailPath.startsWith('/')) {
		return path.join(__dirname, '..', 'public', thumbnailPath.replace(/^\//, ''));
	}

	return '';
}

function pruneEmptyDirectories(startDir, stopDir) {
	let currentDir = startDir;
	const resolvedStopDir = path.resolve(stopDir);

	while (currentDir && path.resolve(currentDir).startsWith(resolvedStopDir)) {
		if (path.resolve(currentDir) === resolvedStopDir) {
			return;
		}

		if (!fs.existsSync(currentDir)) {
			currentDir = path.dirname(currentDir);
			continue;
		}

		if (fs.readdirSync(currentDir).length > 0) {
			return;
		}

		fs.rmdirSync(currentDir);
		currentDir = path.dirname(currentDir);
	}
}

function readExistingFrontmatter(markdownPath) {
	if (!markdownPath || !fs.existsSync(markdownPath)) {
		return {};
	}

	try {
		return matter.read(markdownPath).data || {};
	} catch {
		return {};
	}
}

function markdownBody({ descriptionText, summary, structuredContentHtml }) {
	const lines = [];
	const primaryHtml = cleanText(structuredContentHtml);

	if (primaryHtml) {
		const overviewMarkdown = htmlDescriptionToMarkdown(primaryHtml, summary);
		if (overviewMarkdown) {
			lines.push(overviewMarkdown);
			return `${lines.join('\n\n').trim()}\n`;
		}
	}

	const remainingText = trimLeadingSummaryFromText(descriptionText, summary);
	const fallbackText = remainingText || cleanText(descriptionText);
	if (fallbackText) {
		if (lines.length > 0) {
			lines.push('');
		}
		lines.push(...fallbackText.split(/\n{2,}/));
	}

	return `${lines.join('\n\n').trim()}\n`;
}

function removeFileIfExists(filePath) {
	if (filePath && fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
		const resolvedFilePath = path.resolve(filePath);
		if (resolvedFilePath.startsWith(path.resolve(LOCAL_IMAGES_DIR))) {
			pruneEmptyDirectories(path.dirname(resolvedFilePath), LOCAL_IMAGES_DIR);
		}
	}
}

async function syncEvents() {
	console.log('Syncing events from Eventbrite...');

	ensureDirectory(EVENTS_CONTENT_DIR);
	ensureDirectory(EVENTS_PUBLIC_DIR);
	ensureDirectory(LOCAL_IMAGES_DIR);
	ensureDirectory(TEMP_DIR);

	const previousManifest = loadManifest();
	const nextManifest = {};
	const events = await fetchAllEvents();
	const activeEventIds = new Set();
	let created = 0;
	let updated = 0;

	console.log(`Found ${events.length} Eventbrite event(s)`);

	for (const event of events) {
		if (!event?.id) {
			continue;
		}

		const eventId = String(event.id);
		activeEventIds.add(eventId);

		const slug = eventSlug(event);
		const markdownPath = path.join(EVENTS_CONTENT_DIR, `${slug}.md`);
		const previousEntry = previousManifest[eventId];

		const venue = event.venue || (await fetchVenue(event.venue_id));
		const address = event.online_event ? 'Online event' : normalizeAddress(venue?.address);
		const map = event.online_event
			? ''
			: buildMapUrl(address, venue?.address?.latitude, venue?.address?.longitude);

		const startDate = asDate(event.start?.utc, new Date());
		const endDate = asDate(event.end?.utc, startDate);
		const pubDate = toIsoDate(event.created?.utc || event.start?.utc, startDate);
		const title = cleanText(event.name?.text || 'Untitled Event');
		const descriptionText = cleanText(event.description?.text || event.summary || '');
		const description = cleanText(event.summary || descriptionText.split('\n')[0] || '');
		const structuredContent = await fetchEventStructuredContentData(eventId);
		const mediaIds = getEventMediaIds(event, structuredContent.html);
		const mediaUrls = structuredContent.mediaUrls;
		const mediaImages = await localizeEventMediaUrls({
			eventId,
			slug,
			mediaUrls,
			previousEntry,
		});
		const apiMediaImages = await localizeEventMediaImages({
			eventId,
			slug,
			mediaIds,
			previousEntry,
		});
		const allMediaImages = [...new Set([...mediaImages, ...apiMediaImages])];
		const thumbnail = allMediaImages[0] || '';
		const existingFrontmatter = readExistingFrontmatter(markdownPath);

		const frontmatter = {
			title,
			description,
			pubDate: new Date(pubDate),
			startDate,
			endDate,
			address: address || 'TBC',
			eventbriteLink: event.url || '',
		};

		if (typeof existingFrontmatter.customCta === 'string' && existingFrontmatter.customCta.trim()) {
			frontmatter.customCta = existingFrontmatter.customCta.trim();
		}

		if (thumbnail) {
			frontmatter.thumbnail = thumbnail;
		}
		if (allMediaImages.length > 0) {
			frontmatter.images = allMediaImages;
		}

		const body = markdownBody({
			descriptionText,
			summary: description,
			structuredContentHtml: structuredContent.html,
		});
		const markdown = matter.stringify(body, frontmatter, {
			lineWidth: 10000,
		});

		const hadExisting = fs.existsSync(markdownPath);
		fs.writeFileSync(markdownPath, markdown, 'utf8');

		const previousMarkdownPath = previousEntry?.markdown
			? path.join(__dirname, '..', previousEntry.markdown)
			: '';
		if (previousMarkdownPath && previousMarkdownPath !== markdownPath) {
			removeFileIfExists(previousMarkdownPath);
		}

		const previousImages = new Set([
			...(Array.isArray(previousEntry?.galleryImages) ? previousEntry.galleryImages : []),
			previousEntry?.thumbnail || '',
		]);
		const currentImages = new Set([...(allMediaImages || []), thumbnail || '']);

		for (const imagePath of previousImages) {
			if (!imagePath || currentImages.has(imagePath)) {
				continue;
			}
			removeFileIfExists(resolveThumbnailAbsolutePath(imagePath));
		}

		nextManifest[eventId] = {
			slug,
			markdown: `src/content/events/${slug}.md`,
			thumbnail,
			mediaIds,
			galleryImages: allMediaImages,
		};

		if (hadExisting) {
			updated += 1;
			console.log(`   Updated ${slug}`);
		} else {
			created += 1;
			console.log(`   Created ${slug}`);
		}
	}

	for (const [eventId, previousEntry] of Object.entries(previousManifest)) {
		if (activeEventIds.has(eventId)) {
			continue;
		}

		const markdownPath = previousEntry?.markdown
			? path.join(__dirname, '..', previousEntry.markdown)
			: '';
		const galleryImages = Array.isArray(previousEntry?.galleryImages)
			? previousEntry.galleryImages
			: [];
		const thumbnailPath = resolveThumbnailAbsolutePath(previousEntry?.thumbnail || '');

		removeFileIfExists(markdownPath);
		removeFileIfExists(thumbnailPath);
		for (const imagePath of galleryImages) {
			removeFileIfExists(resolveThumbnailAbsolutePath(imagePath));
		}

		if (previousEntry?.slug) {
			console.log(`   Removed stale event ${previousEntry.slug}`);
		}
	}

	saveManifest(nextManifest);

	if (fs.existsSync(TEMP_DIR)) {
		fs.rmSync(TEMP_DIR, { recursive: true, force: true });
	}

	console.log('');
	console.log(
		`Sync complete: ${created} created, ${updated} updated, ${events.length} total active`,
	);
}

syncEvents().catch((error) => {
	console.error(`\nFailed to sync Eventbrite events: ${error.message}`);
	process.exit(1);
});
