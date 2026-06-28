#!/usr/bin/env node
import { config } from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import matter from 'gray-matter';
import TurndownService from 'turndown';
import mailchimp from '@mailchimp/mailchimp_marketing';
import { fileURLToPath } from 'url';

config();

const MANIFEST_FILENAME = '.manifest.json';
const DEFAULT_AUTHOR = 'Protect Earth';
const DEFAULT_CATEGORY = 'updates-progress';
const DEFAULT_FETCH_COUNT = 200;
const DEFAULT_SYNC_MONTHS = 6;

const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_SERVER_PREFIX = process.env.MAILCHIMP_SERVER_PREFIX;
const MAILCHIMP_NEWSLETTER_FETCH_COUNT = Number.parseInt(
	process.env.MAILCHIMP_NEWSLETTER_FETCH_COUNT || String(DEFAULT_FETCH_COUNT),
	10,
);
const MAILCHIMP_NEWSLETTER_SYNC_MONTHS = Number.parseInt(
	process.env.MAILCHIMP_NEWSLETTER_SYNC_MONTHS || String(DEFAULT_SYNC_MONTHS),
	10,
);
const MAILCHIMP_SKIP_REGIONAL_NEWSLETTERS =
	String(process.env.MAILCHIMP_SKIP_REGIONAL_NEWSLETTERS || 'true').toLowerCase() !== 'false';

if (!MAILCHIMP_API_KEY) {
	console.error('Error: MAILCHIMP_API_KEY environment variable is required');
	process.exit(1);
}

if (!MAILCHIMP_SERVER_PREFIX) {
	console.error('Error: MAILCHIMP_SERVER_PREFIX environment variable is required (example: us2)');
	process.exit(1);
}

mailchimp.setConfig({
	apiKey: MAILCHIMP_API_KEY,
	server: MAILCHIMP_SERVER_PREFIX,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARTICLES_CONTENT_DIR = path.join(__dirname, '../src/content/articles');
const LOCAL_IMAGES_DIR = path.join(__dirname, '../src/assets/articles/newsletters');
const TEMP_DIR = path.join(__dirname, '../.temp-mailchimp-images');
const MANIFEST_PATH = path.join(LOCAL_IMAGES_DIR, MANIFEST_FILENAME);
const ARTICLE_ASSET_PATH_PREFIX = '../../assets/articles/newsletters';

const turndown = new TurndownService({
	headingStyle: 'atx',
	bulletListMarker: '-',
	codeBlockStyle: 'fenced',
});

turndown.addRule('removeEmptyParagraphs', {
	filter: 'p',
	replacement(content) {
		return content.trim() ? `\n\n${content}\n\n` : '';
	},
});

function ensureDirectory(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
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

function slugify(value) {
	return cleanText(value)
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

function escapeRegExp(value) {
	return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function campaignSlug(campaign) {
	const titleSlug = slugify(
		campaign?.settings?.title || campaign?.settings?.subject_line || 'newsletter',
	);
	const suffix = String(campaign?.id || '').trim();
	if (!suffix) {
		return titleSlug || `newsletter-${Date.now()}`;
	}

	const maxTitleLength = Math.max(20, 95 - suffix.length - 1);
	const trimmed = titleSlug.slice(0, maxTitleLength).replace(/-+$/g, '');
	return `${trimmed || 'newsletter'}-${suffix}`;
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

function normalizeWhitespace(markdown) {
	return normalizeMarkdownArtifacts(markdown)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function stripMarkdownFormatting(value) {
	return cleanText(String(value || ''))
		.replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
		.replace(/\]\([^\)]+\)/g, '')
		.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
		.replace(/^[#>\-\*\s]+/gm, '')
		.replace(/[_*`~]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripInvisibleCharacters(value) {
	return String(value || '').replace(
		/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u2000-\u200f\u2028-\u202e\u205f\u2060-\u206f\u3000\ufeff]/g,
		'',
	);
}

function cleanupMailchimpMarkdown(markdown, title = '') {
	let output = stripInvisibleCharacters(markdown);
	const normalizedTitle = normalizeForMatch(title);
	const escapedTitle = escapeRegExp(cleanText(title));

	if (escapedTitle) {
		output = output.replace(
			new RegExp(
				`^${escapedTitle}\\s*\\n+!\\[[^\\]]*\\]\\([^\\)]+\\)\\s*\\n+\\]\\(https?:\\/\\/(?:www\\.)?protect\\.earth\\/?\\)\\s*\\n*`,
				'i',
			),
			'',
		);
		output = output.replace(new RegExp(`^${escapedTitle}\\s*\\n+`, 'i'), '');
	}

	output = output.replace(
		/^!\[[^\]]*\]\([^\)]+\)\s*\n+\]\(https?:\/\/(?:www\.)?protect\.earth\/?\)\s*\n*/i,
		'',
	);
	output = output.replace(/^\]\(https?:\/\/(?:www\.)?protect\.earth\/?\)\s*$/gim, '');

	let lines = output.split('\n');

	while (lines.length > 0 && !cleanText(lines[0])) {
		lines.shift();
	}

	if (lines.length > 0 && normalizeForMatch(lines[0]) === normalizedTitle) {
		lines.shift();
		while (lines.length > 0 && !cleanText(lines[0])) {
			lines.shift();
		}
	}

	const firstSubstantiveIndex = lines.findIndex((line) => cleanText(line));
	const secondSubstantiveIndex = lines.findIndex(
		(line, index) => index > firstSubstantiveIndex && cleanText(line),
	);
	if (
		firstSubstantiveIndex >= 0 &&
		secondSubstantiveIndex >= 0 &&
		/^!\[[^\]]*\]\([^\)]+\)$/.test(cleanText(lines[firstSubstantiveIndex])) &&
		/^#\s+[A-Za-z]+\s+\d{4}$/.test(cleanText(lines[secondSubstantiveIndex]))
	) {
		lines.splice(firstSubstantiveIndex, 1);
	}

	const firstContentIndex = lines.findIndex((line) => cleanText(line));
	const secondContentIndex = lines.findIndex(
		(line, index) => index > firstContentIndex && cleanText(line),
	);
	if (
		firstContentIndex >= 0 &&
		secondContentIndex >= 0 &&
		/^!\[[^\]]*\]\([^\)]+\)$/.test(cleanText(lines[firstContentIndex])) &&
		/^\]\(https?:\/\/(?:www\.)?protect\.earth\/?\)$/.test(cleanText(lines[secondContentIndex]))
	) {
		lines.splice(secondContentIndex, 1);
		lines.splice(firstContentIndex, 1);
	}

	const greetingIndex = lines.findIndex((line) => /^hello everyone[!,]?$/i.test(cleanText(line)));
	if (greetingIndex >= 0) {
		lines = lines.slice(greetingIndex + 1);
		while (lines.length > 0 && !cleanText(lines[0])) {
			lines.shift();
		}
	}

	output = lines.join('\n');
	lines = output.split('\n');
	const footerIndex = lines.findIndex((line) => {
		const normalizedLine = cleanText(line).toLowerCase();
		return (
			normalizedLine.startsWith('copyright (c)') ||
			normalizedLine.startsWith('our mailing address is:') ||
			normalizedLine.startsWith('we are emailing you because') ||
			normalizedLine.startsWith('[view this email in your browser]')
		);
	});

	if (footerIndex >= 0) {
		let trimIndex = footerIndex;
		while (trimIndex > 0) {
			const previousLine = cleanText(lines[trimIndex - 1]);
			if (!previousLine || /^!\[[^\]]*\]\([^\)]+\)$/.test(previousLine) || previousLine === '[') {
				trimIndex -= 1;
				continue;
			}
			break;
		}

		output = lines.slice(0, trimIndex).join('\n');
	}

	output = output
		.split('\n')
		.map((line) => cleanText(line))
		.filter((line, index, array) => {
			if (line === '[' || line === ']') {
				return false;
			}

			if (line !== '') {
				return true;
			}

			return index > 0 && array[index - 1] !== '';
		})
		.join('\n');

	return normalizeWhitespace(output);
}

function cleanStringArray(value) {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.map((item) => cleanText(item)).filter(Boolean);
}

function toIsoDate(value, fallbackDate = new Date()) {
	const parsed = value ? new Date(value) : fallbackDate;
	if (Number.isNaN(parsed.valueOf())) {
		return fallbackDate.toISOString();
	}
	return parsed.toISOString();
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

function removeFileIfExists(filePath) {
	if (filePath && fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}
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

function decodeHtmlEntities(value) {
	if (typeof value !== 'string') {
		return '';
	}

	return value
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function stripHtmlTags(value) {
	return String(value || '').replace(/<[^>]*>/g, ' ');
}

function normalizeForMatch(value) {
	return decodeHtmlEntities(stripHtmlTags(value)).toLowerCase().replace(/\s+/g, ' ').trim();
}

function campaignRegionMatchSnippet(campaign) {
	const recipientsText = normalizeForMatch(campaign?.recipients?.segment_text || '');
	const match = recipientsText.match(/\bregions?\b\s*(?::|is|contains|one of)\s*[^,.;)\]}]+/);
	if (!match) {
		return '';
	}

	return cleanText(match[0]).slice(0, 140);
}

function campaignTargetsRegion(campaign) {
	return Boolean(campaignRegionMatchSnippet(campaign));
}

function campaignWithinSyncWindow(campaign, now = new Date()) {
	const months = Number.isFinite(MAILCHIMP_NEWSLETTER_SYNC_MONTHS)
		? Math.max(1, MAILCHIMP_NEWSLETTER_SYNC_MONTHS)
		: DEFAULT_SYNC_MONTHS;
	const sentAt = new Date(campaign?.send_time || campaign?.create_time || 0);
	if (Number.isNaN(sentAt.valueOf())) {
		return false;
	}

	const cutoff = new Date(now);
	cutoff.setMonth(cutoff.getMonth() - months);
	return sentAt >= cutoff;
}

function detectSiteTags({ campaign, slug, bodyMarkdown }) {
	const corpus = [
		campaign?.settings?.title,
		campaign?.settings?.subject_line,
		campaign?.settings?.preview_text,
		campaign?.recipients?.segment_text,
		slug,
		bodyMarkdown,
	]
		.map((value) => normalizeForMatch(value))
		.filter(Boolean)
		.join('\n');

	const tags = [];
	if (/\bhigh[\s_-]*wood\b/.test(corpus)) {
		tags.push('high-wood');
	}
	if (/\bwarleigh[\s_-]*nature[\s_-]*reserve\b|warleighnaturereserve\.org/.test(corpus)) {
		tags.push('warleigh-nature-reserve');
	}

	return tags;
}

function sanitizeImageUrl(value) {
	const decoded = decodeHtmlEntities(String(value || '').trim());
	if (!decoded || decoded.startsWith('data:') || decoded.startsWith('cid:')) {
		return '';
	}

	try {
		const parsed = new URL(decoded);
		if (!['http:', 'https:'].includes(parsed.protocol)) {
			return '';
		}
		return parsed.toString();
	} catch {
		return '';
	}
}

function inferImageExtension(url, contentType = '') {
	const type = String(contentType || '').toLowerCase();
	if (type.includes('image/png')) return 'png';
	if (type.includes('image/webp')) return 'webp';
	if (type.includes('image/gif')) return 'gif';
	if (type.includes('image/svg+xml')) return 'svg';
	if (type.includes('image/avif')) return 'avif';

	try {
		const parsed = new URL(url);
		const ext = path.extname(parsed.pathname).toLowerCase().replace('.', '');
		if (ext && /^[a-z0-9]+$/.test(ext)) {
			return ext;
		}
	} catch {
		return 'jpg';
	}

	return 'jpg';
}

function isSvgAsset(url, contentType = '') {
	if (
		String(contentType || '')
			.toLowerCase()
			.includes('image/svg+xml')
	) {
		return true;
	}

	return inferImageExtension(url, contentType) === 'svg';
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

async function downloadToFile(url, outputPath) {
	const response = await fetch(url, {
		headers: {
			'User-Agent': 'ProtectEarthWebsiteSync/1.0',
		},
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const contentType = response.headers.get('content-type') || '';
	ensureDirectory(path.dirname(outputPath));
	fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
	return contentType;
}

async function localizeImage({ campaignId, slug, imageUrl, previousEntry }) {
	const existingLocalization = previousEntry?.localizedBySourceUrl?.[imageUrl];
	const existingRelativePath = existingLocalization?.path || '';
	if (existingRelativePath) {
		const existingAbsolutePath = path.resolve(ARTICLES_CONTENT_DIR, existingRelativePath);
		if (fs.existsSync(existingAbsolutePath)) {
			return {
				path: existingRelativePath,
				checksum: existingLocalization?.checksum || '',
			};
		}
	}

	ensureDirectory(TEMP_DIR);
	ensureDirectory(path.join(LOCAL_IMAGES_DIR, slug));

	const inputExt = inferImageExtension(imageUrl);
	const imageHash = crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 16);
	const tempInputPath = path.join(TEMP_DIR, `${campaignId}-${imageHash}.${inputExt}`);
	const downloadedContentType = await downloadToFile(imageUrl, tempInputPath);
	const outputIsSvg = isSvgAsset(imageUrl, downloadedContentType);

	let finalPath = '';
	let finalRelativePath = '';
	let finalChecksum = '';

	if (outputIsSvg) {
		const checksum = await hashFile(tempInputPath);
		const finalFileName = `${checksum.slice(0, 12)}.svg`;
		finalPath = path.join(LOCAL_IMAGES_DIR, slug, finalFileName);
		if (!fs.existsSync(finalPath)) {
			fs.renameSync(tempInputPath, finalPath);
		} else {
			fs.unlinkSync(tempInputPath);
		}
		finalRelativePath = `${ARTICLE_ASSET_PATH_PREFIX}/${slug}/${finalFileName}`;
		finalChecksum = checksum;
	} else {
		const optimizedBuffer = await sharp(tempInputPath)
			.rotate()
			.resize(1400, null, {
				fit: 'inside',
				withoutEnlargement: true,
			})
			.jpeg({ quality: 85, progressive: true })
			.toBuffer();

		const checksum = crypto.createHash('sha256').update(optimizedBuffer).digest('hex');
		const finalFileName = `${checksum.slice(0, 12)}.jpg`;
		finalPath = path.join(LOCAL_IMAGES_DIR, slug, finalFileName);
		if (!fs.existsSync(finalPath)) {
			fs.writeFileSync(finalPath, optimizedBuffer);
		}

		removeFileIfExists(tempInputPath);
		finalRelativePath = `${ARTICLE_ASSET_PATH_PREFIX}/${slug}/${finalFileName}`;
		finalChecksum = checksum;
	}

	return {
		path: finalRelativePath,
		checksum: finalChecksum,
	};
}

async function localizeImagesInHtml({ campaignId, slug, html, previousEntry }) {
	const sourceToLocalized = {};
	const usedLocalizedPaths = new Set();
	const sourceUrlSet = new Set();

	const imgTagPattern = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
	for (const match of html.matchAll(imgTagPattern)) {
		const candidate = sanitizeImageUrl(match[2]);
		if (candidate) {
			sourceUrlSet.add(candidate);
		}
	}

	for (const imageUrl of sourceUrlSet) {
		try {
			const localized = await localizeImage({
				campaignId,
				slug,
				imageUrl,
				previousEntry,
			});
			if (localized?.path) {
				sourceToLocalized[imageUrl] = localized;
				usedLocalizedPaths.add(localized.path);
			}
		} catch (error) {
			console.warn(`Warning: failed to localize image ${imageUrl}: ${error.message}`);
		}
	}

	let localizedHtml = html;
	for (const [sourceUrl, localized] of Object.entries(sourceToLocalized)) {
		const escaped = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		localizedHtml = localizedHtml.replace(new RegExp(escaped, 'g'), localized.path);
	}

	return {
		html: localizedHtml,
		imagePaths: [...usedLocalizedPaths],
		localizedBySourceUrl: Object.fromEntries(
			Object.entries(sourceToLocalized).map(([sourceUrl, localized]) => [
				sourceUrl,
				{
					path: localized.path,
					checksum: localized.checksum,
				},
			]),
		),
	};
}

function extractFirstParagraph(markdown) {
	const parts = normalizeWhitespace(markdown)
		.split(/\n\n+/)
		.map((part) => cleanText(part))
		.filter(Boolean);

	for (const part of parts) {
		if (!part.startsWith('![') && !part.startsWith('#')) {
			return part.slice(0, 200);
		}
	}

	return '';
}

function extractParagraphsAfterGreeting(markdown) {
	const lines = normalizeWhitespace(markdown).split('\n');
	const greetingIndex = lines.findIndex((line) => /^hello everyone[!,]?$/i.test(cleanText(line)));
	const relevantLines = greetingIndex >= 0 ? lines.slice(greetingIndex + 1) : lines;

	return relevantLines
		.join('\n')
		.split(/\n\n+/)
		.map((part) => stripMarkdownFormatting(part))
		.filter(Boolean);
}

function extractDescription(markdown, title = '', previewText = '') {
	const cleanedPreview = stripMarkdownFormatting(previewText);
	if (cleanedPreview) {
		return cleanedPreview;
	}

	const cleanedTitle = stripMarkdownFormatting(title).toLowerCase();
	const parts = extractParagraphsAfterGreeting(markdown);

	for (const part of parts) {
		const normalizedPart = part.toLowerCase();
		if (normalizedPart === cleanedTitle) {
			continue;
		}
		if (/^(hello|hi|dear|good\s+(morning|afternoon|evening))\b/.test(normalizedPart)) {
			continue;
		}
		if (part.length < 25) {
			continue;
		}
		return part.slice(0, 200);
	}

	return extractFirstParagraph(markdown) || cleanedPreview || stripMarkdownFormatting(title);
}

function removeBoilerplateHtml(html) {
	let output = String(html || '');
	output = output.replace(/<style[\s\S]*?<\/style>/gi, '');
	output = output.replace(/<script[\s\S]*?<\/script>/gi, '');
	output = output.replace(
		/<a[^>]+href=["']https?:\/\/(?:www\.)?protect\.earth\/?["'][^>]*>[\s\S]*?<img[^>]*>[\s\S]*?<\/a>/gi,
		'',
	);
	output = output.replace(/<\/?(meta|link|head|html|body)[^>]*>/gi, '');
	return output;
}

function extractFirstImagePath(markdown) {
	const match = String(markdown || '').match(/!\[[^\]]*\]\(([^\)]+)\)/);
	return match ? cleanText(match[1]) : '';
}

function toMarkdown(html, title = '') {
	const normalizedHtml = removeBoilerplateHtml(html);
	const markdown = turndown.turndown(normalizedHtml);
	return `${cleanupMailchimpMarkdown(markdown, title)}\n`;
}

function resolveAssetAbsolutePath(relativeAssetPath) {
	if (!relativeAssetPath || typeof relativeAssetPath !== 'string') {
		return '';
	}

	if (!relativeAssetPath.startsWith('../../assets/')) {
		return '';
	}

	return path.resolve(ARTICLES_CONTENT_DIR, relativeAssetPath);
}

function removeAssetIfExists(relativeAssetPath) {
	const absolutePath = resolveAssetAbsolutePath(relativeAssetPath);
	if (!absolutePath || !fs.existsSync(absolutePath)) {
		return;
	}

	fs.unlinkSync(absolutePath);
	pruneEmptyDirectories(path.dirname(absolutePath), LOCAL_IMAGES_DIR);
}

function buildFrontmatter({ campaign, existingFrontmatter, thumbnail, bodyMarkdown }) {
	const title =
		cleanText(existingFrontmatter?.title) ||
		cleanText(campaign?.settings?.title) ||
		cleanText(campaign?.settings?.subject_line) ||
		'Protect Earth Newsletter';
	const existingDescription = cleanText(existingFrontmatter?.description);
	const reusableDescription =
		existingDescription &&
		existingDescription.toLowerCase() !== title.toLowerCase() &&
		!/^[\]\)]\(https?:\/\//i.test(existingDescription)
			? existingDescription
			: '';
	const description =
		reusableDescription ||
		extractDescription(bodyMarkdown, title, campaign?.settings?.preview_text) ||
		title;
	const author =
		cleanText(existingFrontmatter?.author) ||
		cleanText(campaign?.settings?.from_name) ||
		DEFAULT_AUTHOR;
	const pubDate = toIsoDate(campaign?.send_time || campaign?.create_time, new Date());

	const frontmatter = {
		title,
		description,
		pubDate: new Date(pubDate),
		author,
	};

	if (Array.isArray(existingFrontmatter?.categories) && existingFrontmatter.categories.length > 0) {
		frontmatter.categories = existingFrontmatter.categories;
	} else {
		frontmatter.categories = [DEFAULT_CATEGORY];
	}

	if (thumbnail) {
		frontmatter.thumbnail = thumbnail;
	}

	const existingTags = cleanStringArray(existingFrontmatter?.tags);
	const detectedTags = detectSiteTags({
		campaign,
		slug: campaignSlug(campaign),
		bodyMarkdown,
	});
	const mergedTags = [...new Set([...existingTags, ...detectedTags])];
	if (mergedTags.length > 0) {
		frontmatter.tags = mergedTags;
	}

	return frontmatter;
}

async function fetchSentCampaigns() {
	let offset = 0;
	const count = Number.isFinite(MAILCHIMP_NEWSLETTER_FETCH_COUNT)
		? Math.max(1, MAILCHIMP_NEWSLETTER_FETCH_COUNT)
		: DEFAULT_FETCH_COUNT;
	const campaigns = [];

	while (true) {
		const response = await mailchimp.campaigns.list({
			status: 'sent',
			count: Math.min(1000, count),
			offset,
			sort_field: 'send_time',
			sort_dir: 'DESC',
		});

		const page = Array.isArray(response?.campaigns) ? response.campaigns : [];
		campaigns.push(...page);

		if (page.length === 0 || campaigns.length >= count) {
			break;
		}

		offset += page.length;
	}

	return campaigns.slice(0, count);
}

async function fetchCampaignHtml(campaignId) {
	const payload = await mailchimp.campaigns.getContent(campaignId);
	return cleanText(payload?.archive_html || payload?.html || '');
}

async function syncNewsletters() {
	console.log('Syncing newsletters from Mailchimp...');

	ensureDirectory(ARTICLES_CONTENT_DIR);
	ensureDirectory(LOCAL_IMAGES_DIR);
	ensureDirectory(TEMP_DIR);

	const previousManifest = loadManifest();
	const nextManifest = {};
	const campaigns = await fetchSentCampaigns();
	const activeCampaignIds = new Set();
	let created = 0;
	let preserved = 0;
	let skippedRegional = 0;
	let skippedOld = 0;

	console.log(`Found ${campaigns.length} sent campaign(s)`);

	for (const campaign of campaigns) {
		const campaignId = String(campaign?.id || '').trim();
		if (!campaignId) {
			continue;
		}

		if (MAILCHIMP_SKIP_REGIONAL_NEWSLETTERS && campaignTargetsRegion(campaign)) {
			const title = cleanText(campaign?.settings?.title || campaign?.settings?.subject_line);
			const regionSnippet = campaignRegionMatchSnippet(campaign);
			const debugSuffix = regionSnippet ? ` [match: ${regionSnippet}]` : '';
			console.log(
				`   Skipped regional campaign ${campaignId}${title ? ` (${title})` : ''}${debugSuffix}`,
			);
			skippedRegional += 1;
			continue;
		}

		if (!campaignWithinSyncWindow(campaign)) {
			const title = cleanText(campaign?.settings?.title || campaign?.settings?.subject_line);
			console.log(`   Skipped old campaign ${campaignId}${title ? ` (${title})` : ''}`);
			skippedOld += 1;
			continue;
		}

		activeCampaignIds.add(campaignId);

		const slug = campaignSlug(campaign);
		const markdownPath = path.join(ARTICLES_CONTENT_DIR, `${slug}.md`);
		const previousEntry = previousManifest[campaignId];
		const hadExisting = fs.existsSync(markdownPath);

		if (hadExisting) {
			nextManifest[campaignId] = previousEntry || {
				slug,
				markdown: `src/content/articles/${slug}.md`,
				thumbnail: '',
				imagePaths: [],
				localizedBySourceUrl: {},
			};
			preserved += 1;
			console.log(`   Preserved existing ${slug}`);
			continue;
		}

		const existingFrontmatter = readExistingFrontmatter(markdownPath);

		let campaignHtml = '';
		try {
			campaignHtml = await fetchCampaignHtml(campaignId);
		} catch (error) {
			console.warn(`Warning: failed to fetch content for campaign ${campaignId}: ${error.message}`);
			continue;
		}

		if (!campaignHtml) {
			console.warn(`Warning: empty HTML for campaign ${campaignId}; skipping`);
			continue;
		}

		const localized = await localizeImagesInHtml({
			campaignId,
			slug,
			html: campaignHtml,
			previousEntry,
		});
		const bodyMarkdown = toMarkdown(
			localized.html,
			campaign?.settings?.title || campaign?.settings?.subject_line || '',
		);
		const thumbnail = extractFirstImagePath(bodyMarkdown) || localized.imagePaths[0] || '';
		const frontmatter = buildFrontmatter({
			campaign,
			existingFrontmatter,
			thumbnail,
			bodyMarkdown,
		});

		const markdown = matter.stringify(bodyMarkdown, frontmatter, {
			lineWidth: 10000,
		});
		fs.writeFileSync(markdownPath, markdown, 'utf8');

		const previousMarkdownPath = previousEntry?.markdown
			? path.join(__dirname, '..', previousEntry.markdown)
			: '';
		if (previousMarkdownPath && previousMarkdownPath !== markdownPath) {
			removeFileIfExists(previousMarkdownPath);
		}

		const previousImages = new Set([
			...(Array.isArray(previousEntry?.imagePaths) ? previousEntry.imagePaths : []),
			previousEntry?.thumbnail || '',
		]);
		const currentImages = new Set([...(localized.imagePaths || []), thumbnail || '']);

		for (const imagePath of previousImages) {
			if (!imagePath || currentImages.has(imagePath)) {
				continue;
			}
			removeAssetIfExists(imagePath);
		}

		nextManifest[campaignId] = {
			slug,
			markdown: `src/content/articles/${slug}.md`,
			thumbnail,
			imagePaths: localized.imagePaths,
			localizedBySourceUrl: localized.localizedBySourceUrl,
		};

		created += 1;
		console.log(`   Created ${slug}`);
	}

	for (const [campaignId, previousEntry] of Object.entries(previousManifest)) {
		if (activeCampaignIds.has(campaignId)) {
			continue;
		}

		const markdownPath = previousEntry?.markdown
			? path.join(__dirname, '..', previousEntry.markdown)
			: '';
		removeFileIfExists(markdownPath);

		const imagePaths = Array.isArray(previousEntry?.imagePaths) ? previousEntry.imagePaths : [];
		const thumbnailPath = previousEntry?.thumbnail || '';
		removeAssetIfExists(thumbnailPath);
		for (const imagePath of imagePaths) {
			removeAssetIfExists(imagePath);
		}

		if (previousEntry?.slug) {
			console.log(`   Removed stale newsletter ${previousEntry.slug}`);
		}
	}

	saveManifest(nextManifest);

	if (fs.existsSync(TEMP_DIR)) {
		fs.rmSync(TEMP_DIR, { recursive: true, force: true });
	}

	console.log('');
	console.log(
		`Sync complete: ${created} created, ${preserved} preserved, ${skippedRegional} regional skipped, ${skippedOld} old skipped, ${Object.keys(nextManifest).length} total active`,
	);
}

syncNewsletters().catch((error) => {
	console.error(`\nFailed to sync Mailchimp newsletters: ${error.message}`);
	process.exit(1);
});
