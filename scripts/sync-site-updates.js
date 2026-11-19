#!/usr/bin/env node
import { config } from 'dotenv';
import { Client } from '@notionhq/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import sharp from 'sharp';
import matter from 'gray-matter';
import { toKebabCase, formatDate, getPropertyValue, getPageContent } from './notion-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PHOTO_MANIFEST_FILENAME = '.manifest.json';
const MAX_SITE_UPDATE_PHOTOS = 12;
const isVerbose = process.argv.includes('--verbose');

config();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const SITE_UPDATES_DATABASE_ID = process.env.NOTION_SITE_UPDATES_DB_ID;

if (!NOTION_API_KEY) {
	console.error('Error: NOTION_API_KEY environment variable is required');
	process.exit(1);
}

if (!SITE_UPDATES_DATABASE_ID) {
	console.error('Error: NOTION_SITE_UPDATES_DB_ID environment variable is required');
	process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY });

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

function isImageFileName(fileName = '') {
	return /\.(avif|bmp|gif|jpe?g|png|tiff?|svg)$/i.test(fileName);
}

function isUnsupportedImageFormatForConversion(photo) {
	const mimeType = typeof photo?.mimeType === 'string' ? photo.mimeType.toLowerCase() : '';
	const fileName = typeof photo?.name === 'string' ? photo.name.toLowerCase() : '';

	if (mimeType === 'image/heic' || mimeType === 'image/heif' || mimeType === 'image/webp') {
		return true;
	}

	return fileName.endsWith('.heic') || fileName.endsWith('.heif') || fileName.endsWith('.webp');
}

function getStableRemoteFileKey(url) {
	if (!isRemoteUrl(url)) {
		return null;
	}

	try {
		const parsedUrl = new URL(url);
		return `${parsedUrl.origin}${parsedUrl.pathname}`;
	} catch {
		return null;
	}
}

function isDownloadableNotionPhoto(photo) {
	if (!photo || photo.sourceType !== 'file') {
		return false;
	}

	if (!isRemoteUrl(photo.url) || isGoogleDriveLink(photo.url)) {
		return false;
	}

	if (isUnsupportedImageFormatForConversion(photo)) {
		return false;
	}

	if (typeof photo.mimeType === 'string' && photo.mimeType.toLowerCase().startsWith('image/')) {
		return true;
	}

	return isImageFileName(photo.name);
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
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const manifestPath = path.join(outputDir, PHOTO_MANIFEST_FILENAME);
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function pruneUnusedLocalizedImages(outputDir, usedFileNames) {
	if (!fs.existsSync(outputDir)) {
		return;
	}

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

function normalizeChecksum(value) {
	if (typeof value !== 'string') {
		return null;
	}

	return value.replace(/^W\//, '').replace(/"/g, '').trim() || null;
}

function fetchRemoteChecksum(url) {
	return new Promise((resolve) => {
		const request = https.request(url, { method: 'HEAD' }, (response) => {
			if ([301, 302, 307, 308].includes(response.statusCode || 0)) {
				const redirectUrl = response.headers.location;
				if (!redirectUrl) {
					resolve(null);
					return;
				}

				resolve(fetchRemoteChecksum(redirectUrl));
				return;
			}

			if (response.statusCode && response.statusCode >= 400) {
				resolve(null);
				return;
			}

			resolve(normalizeChecksum(response.headers.etag));
		});

		request.on('error', () => resolve(null));
		request.end();
	});
}

async function processImage(inputPath, outputPath, maxWidth = 1200) {
	await sharp(inputPath)
		.rotate()
		.resize(maxWidth, null, {
			withoutEnlargement: true,
			fit: 'inside',
		})
		.jpeg({ quality: 85, progressive: true })
		.toFile(outputPath);
}

function getTempImageExtension(mimeType, fileName = '') {
	const normalizedMimeType = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
	const normalizedFileName = typeof fileName === 'string' ? fileName.toLowerCase() : '';

	if (normalizedMimeType === 'image/png' || normalizedFileName.endsWith('.png')) {
		return 'png';
	}

	return 'jpg';
}

function getChecksumLocalImageName(checksum) {
	if (typeof checksum !== 'string') {
		return null;
	}

	const normalized = checksum.trim().toLowerCase();
	if (!/^[a-f0-9]{64}$/.test(normalized)) {
		return null;
	}

	return `${normalized}.jpg`;
}

async function localizeSiteUpdatePhotos(photos, slug, imagesDir, tempDir) {
	const photoList = Array.isArray(photos) ? photos : [];
	const notionPhotos = photoList.filter(isDownloadableNotionPhoto);
	const ignoredPhotos = photoList.length - notionPhotos.length;
	const outputDir = path.join(imagesDir, slug);
	const previousManifest = loadPhotoManifest(outputDir);
	const nextManifest = {};
	const usedFileNames = new Set();
	const hadExistingLocalizedPhotos =
		fs.existsSync(outputDir) || Object.keys(previousManifest).length > 0;

	if (isVerbose) {
		console.log(`  Localizing ${notionPhotos.length} Notion photo file(s) for ${slug}...`);
	}
	if (isVerbose && ignoredPhotos > 0) {
		console.log(`  Ignoring ${ignoredPhotos} non-image or external photo reference(s)`);
	}

	if (notionPhotos.length === 0 && !hadExistingLocalizedPhotos) {
		return [];
	}

	if (!fs.existsSync(outputDir) && notionPhotos.length > 0) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const localized = [];
	let index = 1;

	for (const photo of notionPhotos) {
		if (localized.length >= MAX_SITE_UPDATE_PHOTOS) {
			console.log(
				`  Reached max photo limit (${MAX_SITE_UPDATE_PHOTOS}) for ${slug}; skipping remaining photo sources`,
			);
			break;
		}

		const stableKey = getStableRemoteFileKey(photo.url);
		const sourceKey = `notion:${photo.sourceId || stableKey || photo.name}`;
		const ext = getTempImageExtension(photo.mimeType, photo.name);
		const tempPath = path.join(tempDir, `${slug}-${index}.${ext}`);
		const previousEntry = previousManifest[sourceKey];
		const previousLocalName = getChecksumLocalImageName(previousEntry?.checksum || null);
		const previousPath = previousLocalName ? path.join(outputDir, previousLocalName) : null;
		const contentPath = previousLocalName
			? `../../assets/site-updates/${slug}/${previousLocalName}`
			: null;
		const remoteChecksum = previousEntry?.sourceChecksum
			? await fetchRemoteChecksum(photo.url)
			: null;

		if (
			previousPath &&
			fs.existsSync(previousPath) &&
			contentPath &&
			(!previousEntry?.sourceChecksum || remoteChecksum === previousEntry.sourceChecksum)
		) {
			if (isVerbose) {
				console.log(
					`  Reusing existing localized image ${previousLocalName} for unchanged Notion file`,
				);
			}
			localized.push(contentPath);
			nextManifest[sourceKey] = {
				localName: previousLocalName,
				checksum: previousEntry.checksum,
				sourceChecksum: previousEntry.sourceChecksum || remoteChecksum,
				fileName: photo.name,
			};
			usedFileNames.add(previousLocalName);
			index++;
			continue;
		}

		try {
			console.log(`  Downloading Notion image ${photo.name}`);
			await downloadImage(photo.url, tempPath);
			const processedPath = path.join(tempDir, `${slug}-${index}-processed.jpg`);
			await processImage(tempPath, processedPath);
			const checksum = await hashFile(processedPath);
			const downloadedLocalName = getChecksumLocalImageName(checksum);
			const downloadedLocalPath = path.join(outputDir, downloadedLocalName);
			const downloadedContentPath = `../../assets/site-updates/${slug}/${downloadedLocalName}`;

			if (fs.existsSync(downloadedLocalPath)) {
				fs.unlinkSync(processedPath);
			} else {
				fs.renameSync(processedPath, downloadedLocalPath);
			}

			localized.push(downloadedContentPath);
			nextManifest[sourceKey] = {
				localName: downloadedLocalName,
				checksum,
				sourceChecksum: remoteChecksum,
				fileName: photo.name,
			};
			usedFileNames.add(downloadedLocalName);
			index++;
			console.log(`  Wrote ${downloadedContentPath}`);

			if (fs.existsSync(tempPath)) {
				fs.unlinkSync(tempPath);
			}
			if (fs.existsSync(processedPath)) {
				fs.unlinkSync(processedPath);
			}
		} catch (error) {
			console.warn(`Warning: Failed to localize Notion image ${photo.name}: ${error.message}`);
		}
	}

	pruneUnusedLocalizedImages(outputDir, usedFileNames);
	savePhotoManifest(outputDir, nextManifest);

	return localized;
}

async function syncSiteUpdates() {
	console.log('Syncing Site Updates from Notion...');

	try {
		const siteUpdatesDir = path.join(__dirname, '../src/content/site-updates');
		const siteMetaDir = path.join(__dirname, '../src/content/siteMeta');
		const imagesDir = path.join(__dirname, '../src/assets/site-updates');
		const tempDir = path.join(__dirname, '../.temp-images');
		const siteNotionIdLookup = getSiteNotionIdLookup(siteMetaDir);

		if (!fs.existsSync(siteUpdatesDir)) fs.mkdirSync(siteUpdatesDir, { recursive: true });
		if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
		if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

		// Get database info to find the data source ID
		const database = await notion.databases.retrieve({
			database_id: SITE_UPDATES_DATABASE_ID,
		});

		const dataSourceId = database.data_sources?.[0]?.id;
		if (!dataSourceId) {
			throw new Error('Could not find data source ID in database');
		}

		let allResults = [];
		let hasMore = true;
		let startCursor;

		while (hasMore) {
			const response = await notion.dataSources.query({
				data_source_id: dataSourceId,
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
		let unmatchedSiteNotionIdWarnings = 0;

		for (const [index, page] of allResults.entries()) {
			const properties = page.properties;

			const title = await getPropertyValue(properties.Title || properties.Name);
			if (!title) continue;

			const type = await getPropertyValue(properties['Update Type']);
			const photos = await getPropertyValue(properties.Photos);
			const siteRelation = await getPropertyValue(
				properties['Sites'] || properties['🏝️ Sites'] || properties.Site,
			);
			const siteNotionId = siteRelation?.length > 0 ? siteRelation[0] : null;
			if (siteNotionId && !siteNotionIdLookup.has(siteNotionId)) {
				console.warn(
					`Warning: Site update "${title}" (${page.id}) references siteNotionId "${siteNotionId}" that does not exist in any site metadata notionIds`,
				);
				unmatchedSiteNotionIdWarnings++;
			}
			const date = await getPropertyValue(properties['Update Date']);
			const treesPlanted = await getPropertyValue(properties['If new planting, how many trees?']);
			const survivalRate = await getPropertyValue(properties['If survival survey, what % alive?']);
			const treesRestocked = await getPropertyValue(properties['If restocking, how many trees?']);

			const description = await getPageContent(page.id);
			const baseSlug = toKebabCase(title);
			const shortId = page.id.replace(/-/g, '').slice(-8);
			const slug = `${baseSlug}-${shortId}`;
			if (isVerbose) {
				console.log(`[${index + 1}/${allResults.length}] ${title} -> ${slug}`);
			}
			const filePath = path.join(siteUpdatesDir, `${slug}.md`);
			const existingBody = getExistingBody(filePath);

			const notionPhotoFiles = Array.isArray(photos) ? photos : [];
			let photosToUse = [];

			photosToUse = await localizeSiteUpdatePhotos(notionPhotoFiles, slug, imagesDir, tempDir);

			photosToUse = photosToUse.filter(
				(photo) => typeof photo === 'string' && photo.length > 0 && photo !== 'null',
			);

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
				...(siteNotionId && { siteNotionId }),
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
			const bodyToWrite = hasDescription ? description : normalizePageContent(existingBody);
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
				if (isVerbose) {
					console.log(`  Updated ${slug}.md`);
				}
				updatedCount++;
			} else {
				if (isVerbose) {
					console.log(`  Created ${slug}.md`);
				}
				createdCount++;
			}
		}

		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}

		console.log('Complete');
		console.log(`Created: ${createdCount}`);
		console.log(`Updated: ${updatedCount}`);
		console.log(`Total: ${allResults.length}`);
		if (unmatchedSiteNotionIdWarnings > 0) {
			console.warn(
				`Warnings: ${unmatchedSiteNotionIdWarnings} site update(s) had an unmapped siteNotionId`,
			);
		}
	} catch (error) {
		console.error(`Error syncing site updates: ${error.message}`);
		process.exit(1);
	}
}

syncSiteUpdates();
