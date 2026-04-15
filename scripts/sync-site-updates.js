#!/usr/bin/env node
import { config } from 'dotenv';
import { Client } from '@notionhq/client';
import { google } from 'googleapis';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import sharp from 'sharp';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const replaceImages = process.argv.includes('--replace-images');
const PHOTO_MANIFEST_FILENAME = '.manifest.json';
const MAX_SITE_UPDATE_PHOTOS = 12;

config();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const SITE_UPDATES_DATABASE_ID = process.env.NOTION_SITE_UPDATES_DB_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!NOTION_API_KEY) {
	console.error('Error: NOTION_API_KEY environment variable is required');
	process.exit(1);
}

if (!SITE_UPDATES_DATABASE_ID) {
	console.error('Error: NOTION_SITE_UPDATES_DB_ID environment variable is required');
	process.exit(1);
}

if (replaceImages && (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY)) {
	console.error(
		'Error: GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are required with --replace-images',
	);
	process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY });

const drive = replaceImages
	? google.drive({
			version: 'v3',
			auth: new google.auth.GoogleAuth({
				credentials: {
					client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
					private_key: GOOGLE_PRIVATE_KEY,
				},
				scopes: ['https://www.googleapis.com/auth/drive.readonly'],
			}),
		})
	: null;

function toKebabCase(str) {
	return str
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/--+/g, '-')
		.trim();
}

function getRichText(richTextArray) {
	if (!Array.isArray(richTextArray)) return '';
	return richTextArray.map((text) => text.plain_text).join('');
}

function formatDate(dateString) {
	if (!dateString) return null;
	return new Date(dateString).toISOString();
}

function isRemoteUrl(value) {
	return typeof value === 'string' && /^https?:\/\//.test(value);
}

function sanitizeLocalPhotoPaths(photos) {
	if (!Array.isArray(photos)) {
		return [];
	}

	return photos.filter((photo) => typeof photo === 'string' && !isRemoteUrl(photo));
}

function isGoogleDriveLink(url) {
	return typeof url === 'string' && url.includes('drive.google.com');
}

function extractFolderId(url) {
	if (typeof url !== 'string') {
		return null;
	}

	try {
		const parsedUrl = new URL(url);
		const idParam = parsedUrl.searchParams.get('id');
		if (idParam) {
			return idParam;
		}
	} catch {
		// Fall through to regex parsing for malformed URLs.
	}

	const folderMatch = url.match(/folders\/([a-zA-Z0-9_-]+)/);
	if (folderMatch) {
		return folderMatch[1];
	}

	const genericIdMatch = url.match(/[-\w]{25,}/);
	return genericIdMatch ? genericIdMatch[0] : null;
}

function ensureParentDirectory(filePath) {
	const parentDir = path.dirname(filePath);
	if (!fs.existsSync(parentDir)) {
		fs.mkdirSync(parentDir, { recursive: true });
	}
}

function loadPhotoManifest(outputDir) {
	const manifestPath = path.join(outputDir, PHOTO_MANIFEST_FILENAME);
	if (!fs.existsSync(manifestPath)) {
		return {};
	}

	try {
		return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		console.warn(`Warning: Could not parse photo manifest at ${manifestPath}: ${error.message}`);
		return {};
	}
}

function savePhotoManifest(outputDir, manifest) {
	const manifestPath = path.join(outputDir, PHOTO_MANIFEST_FILENAME);
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function pruneUnusedLocalizedImages(outputDir, usedFileNames) {
	const allowed = new Set([...usedFileNames, PHOTO_MANIFEST_FILENAME]);
	for (const entry of fs.readdirSync(outputDir)) {
		if (allowed.has(entry)) {
			continue;
		}

		const entryPath = path.join(outputDir, entry);
		if (fs.statSync(entryPath).isFile()) {
			fs.unlinkSync(entryPath);
		}
	}
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

function downloadImage(url, filePath) {
	return new Promise((resolve, reject) => {
		ensureParentDirectory(filePath);
		const file = fs.createWriteStream(filePath);

		const handleResponse = (response) => {
			if ([301, 302, 307, 308].includes(response.statusCode)) {
				const redirectUrl = response.headers.location;
				if (!redirectUrl) {
					reject(new Error('Redirect response without location header'));
					return;
				}
				https.get(redirectUrl, handleResponse).on('error', reject);
				return;
			}

			if (response.statusCode && response.statusCode >= 400) {
				reject(new Error(`HTTP ${response.statusCode}`));
				return;
			}

			response.pipe(file);
			file.on('finish', () => {
				file.close();
				resolve(filePath);
			});
		};

		https.get(url, handleResponse).on('error', (error) => {
			fs.unlink(filePath, () => {});
			reject(error);
		});
	});
}

async function processImage(inputPath, outputPath, maxWidth = 1200) {
	try {
		await sharp(inputPath)
			.rotate()
			.resize(maxWidth, null, {
				withoutEnlargement: true,
				fit: 'inside',
			})
			.jpeg({ quality: 85, progressive: true })
			.toFile(outputPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const lowerPath = inputPath.toLowerCase();
		const looksLikeHeic = lowerPath.endsWith('.heic') || lowerPath.endsWith('.heif');
		const mentionsHeic = /heic|heif|unsupported|no decode delegate/i.test(message);

		if (looksLikeHeic && mentionsHeic) {
			throw new Error(
				`HEIC conversion failed for ${path.basename(inputPath)}. This sharp/libvips build may not include HEIC/HEIF support. Original error: ${message}`,
			);
		}

		throw error;
	}
}

function getTempImageExtension(mimeType, fileName = '') {
	const normalizedMimeType = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
	const normalizedFileName = typeof fileName === 'string' ? fileName.toLowerCase() : '';

	if (normalizedMimeType === 'image/png' || normalizedFileName.endsWith('.png')) {
		return 'png';
	}

	if (
		normalizedMimeType === 'image/heic' ||
		normalizedMimeType === 'image/heif' ||
		normalizedFileName.endsWith('.heic') ||
		normalizedFileName.endsWith('.heif')
	) {
		return 'heic';
	}

	if (normalizedMimeType === 'image/webp' || normalizedFileName.endsWith('.webp')) {
		return 'webp';
	}

	return 'jpg';
}

async function fetchImagesFromDriveFolder(folderId, depth = 0) {
	if (!drive) return [];

	try {
		if (depth === 0) {
			console.log(`  Looking up Google Drive folder ${folderId}...`);
		}

		const response = await drive.files.list({
			q: `'${folderId}' in parents and trashed=false`,
			fields: 'files(id,name,mimeType,md5Checksum)',
			pageSize: 100,
			supportsAllDrives: true,
			includeItemsFromAllDrives: true,
		});

		const files = response.data.files || [];
		let images = files.filter((file) => file.mimeType?.includes('image/'));

		if (depth < 2) {
			const folders = files.filter(
				(file) => file.mimeType === 'application/vnd.google-apps.folder',
			);
			for (const folder of folders) {
				const nested = await fetchImagesFromDriveFolder(folder.id, depth + 1);
				images = images.concat(nested);
			}
		}

		if (depth === 0) {
			console.log(`  Found ${images.length} image file(s) in Google Drive folder ${folderId}`);
		}

		return images;
	} catch (error) {
		console.warn(`Warning: Could not fetch Google Drive folder ${folderId}: ${error.message}`);
		return [];
	}
}

async function localizeSiteUpdatePhotos(photos, slug, imagesDir, tempDir) {
	if (!photos || photos.length === 0) return [];

	console.log(`  Localizing ${photos.length} photo reference(s) for ${slug}...`);

	const outputDir = path.join(imagesDir, slug);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}
	const previousManifest = loadPhotoManifest(outputDir);
	const nextManifest = {};
	const usedFileNames = new Set();

	const localized = [];
	let index = 1;

	for (const photoUrl of photos) {
		if (localized.length >= MAX_SITE_UPDATE_PHOTOS) {
			console.log(
				`  Reached max photo limit (${MAX_SITE_UPDATE_PHOTOS}) for ${slug}; skipping remaining photo sources`,
			);
			break;
		}

		if (!isRemoteUrl(photoUrl)) {
			console.log(`  Keeping existing local photo path for ${slug}`);
			localized.push(photoUrl);
			usedFileNames.add(path.basename(photoUrl));
			continue;
		}

		if (isGoogleDriveLink(photoUrl)) {
			console.log(`  Resolving Google Drive photo source for ${slug}: ${photoUrl}`);
			const folderId = extractFolderId(photoUrl);
			if (!folderId) {
				console.warn(`Warning: Could not extract Google Drive folder ID from ${photoUrl}`);
				continue;
			}

			const driveImages = await fetchImagesFromDriveFolder(folderId);
			for (const driveImage of driveImages) {
				if (localized.length >= MAX_SITE_UPDATE_PHOTOS) {
					console.log(
						`    Reached max photo limit (${MAX_SITE_UPDATE_PHOTOS}) while processing Drive images`,
					);
					break;
				}

				const sourceKey = `drive:${driveImage.id}`;
				const ext = getTempImageExtension(driveImage.mimeType, driveImage.name);
				const tempPath = path.join(tempDir, `${slug}-${driveImage.id}.${ext}`);
				const localName = `${index}.jpg`;
				const localPath = path.join(outputDir, localName);
				const contentPath = `../../assets/site-updates/${slug}/${localName}`;
				const previousEntry = previousManifest[sourceKey];
				const previousPath = previousEntry?.localName
					? path.join(outputDir, previousEntry.localName)
					: null;

				if (
					previousEntry?.checksum &&
					driveImage.md5Checksum &&
					previousEntry.checksum === driveImage.md5Checksum &&
					previousPath &&
					fs.existsSync(previousPath)
				) {
					if (previousPath !== localPath) {
						if (fs.existsSync(localPath)) {
							fs.unlinkSync(localPath);
						}
						fs.renameSync(previousPath, localPath);
					}

					console.log(`    Reusing localized image ${localName} via checksum match`);
					localized.push(contentPath);
					nextManifest[sourceKey] = {
						localName,
						checksum: driveImage.md5Checksum,
					};
					usedFileNames.add(localName);
					index++;
					continue;
				}

				try {
					console.log(`    Downloading ${driveImage.name} -> ${localName}`);
					const response = await drive.files.get(
						{ fileId: driveImage.id, alt: 'media' },
						{ responseType: 'stream' },
					);

					ensureParentDirectory(tempPath);
					const writer = fs.createWriteStream(tempPath);
					response.data.pipe(writer);
					await new Promise((resolve, reject) => {
						writer.on('finish', resolve);
						writer.on('error', reject);
					});

					await processImage(tempPath, localPath);
					localized.push(contentPath);
					nextManifest[sourceKey] = {
						localName,
						checksum: driveImage.md5Checksum || (await hashFile(localPath)),
					};
					usedFileNames.add(localName);
					index++;
					console.log(`    Wrote ${contentPath}`);

					if (fs.existsSync(tempPath)) {
						fs.unlinkSync(tempPath);
					}
				} catch (error) {
					console.warn(
						`Warning: Failed to localize Drive image ${driveImage.name}: ${error.message}`,
					);
				}
			}
			continue;
		}

		const tempPath = path.join(tempDir, `${slug}-${index}.jpg`);
		const localName = `${index}.jpg`;
		const localPath = path.join(outputDir, localName);
		const contentPath = `../../assets/site-updates/${slug}/${localName}`;
		const sourceKey = `url:${photoUrl}`;
		const previousEntry = previousManifest[sourceKey];
		const previousPath = previousEntry?.localName
			? path.join(outputDir, previousEntry.localName)
			: null;

		if (previousPath && fs.existsSync(previousPath) && previousEntry?.sourceUrl === photoUrl) {
			if (previousPath !== localPath) {
				if (fs.existsSync(localPath)) {
					fs.unlinkSync(localPath);
				}
				fs.renameSync(previousPath, localPath);
			}

			console.log(`  Reusing existing localized image ${localName} for unchanged URL`);
			localized.push(contentPath);
			nextManifest[sourceKey] = {
				localName,
				checksum: previousEntry.checksum,
				sourceUrl: photoUrl,
			};
			usedFileNames.add(localName);
			index++;
			continue;
		}

		try {
			console.log(`  Downloading direct image ${photoUrl}`);
			await downloadImage(photoUrl, tempPath);
			await processImage(tempPath, localPath);
			localized.push(contentPath);
			nextManifest[sourceKey] = {
				localName,
				checksum: await hashFile(localPath),
				sourceUrl: photoUrl,
			};
			usedFileNames.add(localName);
			index++;
			console.log(`  Wrote ${contentPath}`);

			if (fs.existsSync(tempPath)) {
				fs.unlinkSync(tempPath);
			}
		} catch (error) {
			console.warn(`Warning: Failed to localize image ${photoUrl}: ${error.message}`);
		}
	}

	pruneUnusedLocalizedImages(outputDir, usedFileNames);
	savePhotoManifest(outputDir, nextManifest);

	return localized;
}

async function getPropertyValue(property) {
	if (!property) return null;

	switch (property.type) {
		case 'title':
			return getRichText(property.title);
		case 'rich_text':
			return getRichText(property.rich_text);
		case 'select':
			return property.select?.name || null;
		case 'multi_select':
			return property.multi_select?.map((item) => item.name) || [];
		case 'date':
			return property.date?.start || null;
		case 'number':
			return property.number;
		case 'files':
			return (
				property.files?.map((file) => ({
					name: file.name,
					url: file.type === 'external' ? file.external?.url : file.file?.url,
				})) || []
			);
		case 'relation':
			return property.relation?.map((rel) => rel.id) || [];
		default:
			return null;
	}
}

function convertBlockToMarkdown(block) {
	if (!block) return '';

	switch (block.type) {
		case 'paragraph':
			return getRichText(block.paragraph.rich_text) + '\n\n';
		case 'heading_1':
			return '# ' + getRichText(block.heading_1.rich_text) + '\n\n';
		case 'heading_2':
			return '## ' + getRichText(block.heading_2.rich_text) + '\n\n';
		case 'heading_3':
			return '### ' + getRichText(block.heading_3.rich_text) + '\n\n';
		case 'bulleted_list_item':
			return '- ' + getRichText(block.bulleted_list_item.rich_text) + '\n';
		case 'numbered_list_item':
			return '1. ' + getRichText(block.numbered_list_item.rich_text) + '\n';
		case 'quote':
			return '> ' + getRichText(block.quote.rich_text) + '\n\n';
		case 'code': {
			const code = getRichText(block.code.rich_text);
			const lang = block.code.language || '';
			return '```' + lang + '\n' + code + '\n```\n\n';
		}
		case 'divider':
			return '---\n\n';
		default:
			return '';
	}
}

function normalizePageContent(content) {
	if (!content) {
		return '';
	}

	return (
		content
			// Normalize line endings from Notion/API payloads first.
			.replace(/\r\n?/g, '\n')
			// Normalize non-breaking spaces that often appear from pasted Notion content.
			.replace(/\u00a0/g, ' ')
			// Remove trailing spaces/tabs on each line.
			.replace(/[\t ]+$/gm, '')
			// Collapse whitespace-only lines into plain blank lines.
			.replace(/^[\t ]+$/gm, '')
			// Prevent large runs of blank lines in the middle of content.
			.replace(/\n{3,}/g, '\n\n')
			// Remove leading/trailing whitespace/newlines for the full body.
			.replace(/^[\t \n]+|[\t \n]+$/g, '')
	);
}

async function listAllBlocks(blockId) {
	let allBlocks = [];
	let hasMore = true;
	let startCursor;

	while (hasMore) {
		const response = await notion.blocks.children.list({
			block_id: blockId,
			start_cursor: startCursor,
		});

		allBlocks = allBlocks.concat(response.results || []);
		hasMore = response.has_more;
		startCursor = response.next_cursor;
	}

	return allBlocks;
}

function getExistingBody(filePath) {
	if (!fs.existsSync(filePath)) {
		return '';
	}

	try {
		const existingRaw = fs.readFileSync(filePath, 'utf8');
		const parsed = matter(existingRaw);
		return parsed.content || '';
	} catch (error) {
		console.warn(`Warning: Could not parse existing file body at ${filePath}: ${error.message}`);
		return '';
	}
}

function getExistingLocalPhotos(filePath) {
	if (!fs.existsSync(filePath)) {
		return [];
	}

	try {
		const existingRaw = fs.readFileSync(filePath, 'utf8');
		const parsed = matter(existingRaw);
		return sanitizeLocalPhotoPaths(parsed.data.photos);
	} catch (error) {
		console.warn(`Warning: Could not parse existing file photos at ${filePath}: ${error.message}`);
		return [];
	}
}

async function getPageContent(pageId) {
	try {
		const blocks = await listAllBlocks(pageId);
		const rawContent = blocks.map((block) => convertBlockToMarkdown(block)).join('');
		return normalizePageContent(rawContent);
	} catch (error) {
		console.warn(`Warning: Could not fetch content for page ${pageId}: ${error.message}`);
		return '';
	}
}

async function syncSiteUpdates() {
	console.log('Syncing Site Updates from Notion...');
	if (replaceImages) {
		console.log('Image replacement enabled (--replace-images)');
	}

	try {
		const siteUpdatesDir = path.join(__dirname, '../src/content/site-updates');
		const imagesDir = path.join(__dirname, '../src/assets/site-updates');
		const tempDir = path.join(__dirname, '../.temp-images');

		if (!fs.existsSync(siteUpdatesDir)) fs.mkdirSync(siteUpdatesDir, { recursive: true });
		if (replaceImages) {
			if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
			if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
		}

		let allResults = [];
		let hasMore = true;
		let startCursor;

		while (hasMore) {
			const response = await notion.databases.query({
				database_id: SITE_UPDATES_DATABASE_ID,
				start_cursor: startCursor,
			});

			allResults = allResults.concat(response.results);
			hasMore = response.has_more;
			startCursor = response.next_cursor;
			console.log(
				`Fetched ${response.results.length} update(s) from Notion (${allResults.length} total so far)`,
			);
		}

		console.log(`Processing ${allResults.length} site update(s)...`);

		let createdCount = 0;
		let updatedCount = 0;

		for (const [index, page] of allResults.entries()) {
			const properties = page.properties;

			const title = await getPropertyValue(properties.Title || properties.Name);
			if (!title) continue;

			const type = await getPropertyValue(properties['Update Type']);
			const photos = await getPropertyValue(properties.Photos || properties.Images);
			const siteRelation = await getPropertyValue(
				properties['Sites'] || properties['🏝️ Sites'] || properties.Site,
			);
			const date = await getPropertyValue(properties['Update Date']);
			const treesPlanted = await getPropertyValue(properties['If new planting, how many trees?']);
			const survivalRate = await getPropertyValue(
				properties['If beatup survey, Alive % Survival rate?'],
			);
			const treesRestocked = await getPropertyValue(properties['If restocking, how many trees?']);

			const description = await getPageContent(page.id);
			const baseSlug = toKebabCase(title);
			const shortId = page.id.replace(/-/g, '').slice(-8);
			const slug = `${baseSlug}-${shortId}`;
			console.log(`[${index + 1}/${allResults.length}] ${title} -> ${slug}`);
			const filePath = path.join(siteUpdatesDir, `${slug}.md`);
			const existingBody = getExistingBody(filePath);
			const existingLocalPhotos = getExistingLocalPhotos(filePath);

			const notionPhotoUrls = (photos || []).map((p) => p.url).filter(Boolean);
			let photosToUse = [];

			if (replaceImages) {
				photosToUse = await localizeSiteUpdatePhotos(notionPhotoUrls, slug, imagesDir, tempDir);
				if (photosToUse.length === 0 && existingLocalPhotos.length > 0) {
					console.log(
						`  No new localized photos produced; keeping ${existingLocalPhotos.length} existing local photo(s)`,
					);
					photosToUse = existingLocalPhotos;
				}
			} else {
				// Never write Notion remote URLs during normal sync.
				photosToUse = existingLocalPhotos;
				if (notionPhotoUrls.length > 0 && existingLocalPhotos.length === 0) {
					console.log('  Remote Notion photo URLs detected but omitted during plain sync');
				}
			}

			if (photosToUse.length > MAX_SITE_UPDATE_PHOTOS) {
				console.log(
					`  Trimming photos from ${photosToUse.length} to ${MAX_SITE_UPDATE_PHOTOS} for ${slug}`,
				);
				photosToUse = photosToUse.slice(0, MAX_SITE_UPDATE_PHOTOS);
			}

			const frontmatter = {
				title,
				notionId: page.id,
				...(type && { type }),
				...(date && { date: formatDate(date) }),
				...(siteRelation?.length > 0 && { siteNotionId: siteRelation[0] }),
				...(treesPlanted != null && { treesPlanted }),
				...(survivalRate != null && { survivalRate }),
				...(treesRestocked != null && { treesRestocked }),
				...(photosToUse.length > 0 && { photos: photosToUse }),
			};

			let content = '---\n';
			content += Object.entries(frontmatter)
				.map(([key, value]) => {
					if (Array.isArray(value)) {
						return `${key}:\n${value.map((v) => `  - "${v}"`).join('\n')}`;
					}
					if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
						return `${key}: ${value}`;
					}
					return `${key}: "${value}"`;
				})
				.join('\n');
			content += '\n---\n\n';

			const hasDescription = description && description.trim().length > 0;
			const bodyToWrite = hasDescription ? description : existingBody;
			if (!hasDescription && existingBody.trim().length > 0) {
				console.warn(
					`Warning: Preserving existing body for ${slug}.md because Notion body was empty`,
				);
			}

			if (bodyToWrite) {
				content += `${bodyToWrite}\n`;
			}

			const existed = fs.existsSync(filePath);
			fs.writeFileSync(filePath, content, 'utf8');
			if (existed) {
				console.log(`  Updated ${slug}.md`);
				updatedCount++;
			} else {
				console.log(`  Created ${slug}.md`);
				createdCount++;
			}
		}

		if (replaceImages && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}

		console.log('Complete');
		console.log(`Created: ${createdCount}`);
		console.log(`Updated: ${updatedCount}`);
		console.log(`Total: ${allResults.length}`);
	} catch (error) {
		console.error(`Error syncing site updates: ${error.message}`);
		process.exit(1);
	}
}

syncSiteUpdates();
