#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import sharp from 'sharp';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Site configuration - keep in sync with src/config.ts
const ignoredSites = ['Burnsall', 'Donkeywell Farm', 'Newcastle Emlyn', 'Wraxall'];
const PHOTO_MANIFEST_FILENAME = '.manifest.json';

function isRemoteUrl(value) {
	return typeof value === 'string' && /^https?:\/\//.test(value);
}

function sanitizeLocalImagePaths(images) {
	if (!Array.isArray(images)) {
		return [];
	}

	return images.filter((img) => typeof img === 'string' && !isRemoteUrl(img));
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
		console.warn(`⚠️  Could not parse photo manifest at ${manifestPath}: ${error.message}`);
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

// Helper to convert to kebab-case
function toKebabCase(str) {
	return str
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/--+/g, '-')
		.trim();
}

function downloadImage(url, filepath) {
	return new Promise((resolve, reject) => {
		ensureParentDirectory(filepath);
		const file = fs.createWriteStream(filepath);

		const handleResponse = (response) => {
			if (response.statusCode === 302 || response.statusCode === 301) {
				const redirectUrl = response.headers.location;
				if (!redirectUrl) {
					reject(new Error('Redirect response without location header'));
					return;
				}
				https.get(redirectUrl, handleResponse).on('error', reject);
				return;
			}

			response.pipe(file);
			file.on('finish', () => {
				file.close();
				resolve(filepath);
			});
		};

		https.get(url, handleResponse).on('error', (err) => {
			fs.unlink(filepath, () => {});
			reject(err);
		});
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

async function localizeSiteImages(site, slug, imagesDir, tempDir) {
	const siteImagesDir = path.join(imagesDir, slug);
	const imageUrls = Array.isArray(site.images)
		? site.images.filter((imageUrl) => isRemoteUrl(imageUrl))
		: [];
	const previousManifest = loadPhotoManifest(siteImagesDir);
	const nextManifest = {};
	const usedFileNames = new Set();

	if (imageUrls.length === 0) {
		if (fs.existsSync(siteImagesDir)) {
			fs.rmSync(siteImagesDir, { recursive: true, force: true });
		}
		return [];
	}

	if (!fs.existsSync(siteImagesDir) && imageUrls.length > 0) {
		fs.mkdirSync(siteImagesDir, { recursive: true });
	}

	const localImages = [];

	for (let i = 0; i < imageUrls.length; i++) {
		const imageUrl = imageUrls[i];
		const imageNum = i + 1;
		const tempPath = path.join(tempDir, `${slug}-${imageNum}.jpg`);
		const sourceKey = `site:${getStableRemoteFileKey(imageUrl) || imageUrl}`;
		const previousEntry = previousManifest[sourceKey];
		const previousLocalName = getChecksumLocalImageName(previousEntry?.checksum || null);
		const previousPath = previousLocalName ? path.join(siteImagesDir, previousLocalName) : null;
		const previousContentPath = previousLocalName
			? `../../assets/sites/${slug}/${previousLocalName}`
			: null;
		const remoteChecksum = previousEntry?.sourceChecksum
			? await fetchRemoteChecksum(imageUrl)
			: null;

		if (
			previousPath &&
			fs.existsSync(previousPath) &&
			previousContentPath &&
			(!previousEntry?.sourceChecksum || remoteChecksum === previousEntry.sourceChecksum)
		) {
			console.log(`   ♻️  Reusing existing localized image ${previousLocalName}`);
			localImages.push(previousContentPath);
			nextManifest[sourceKey] = {
				localName: previousLocalName,
				checksum: previousEntry.checksum,
				sourceChecksum: previousEntry.sourceChecksum || remoteChecksum,
			};
			usedFileNames.add(previousLocalName);
			continue;
		}

		try {
			await downloadImage(imageUrl, tempPath);
			const processedPath = path.join(tempDir, `${slug}-${imageNum}-processed.jpg`);
			await processImage(tempPath, processedPath, 1200);
			const checksum = await hashFile(processedPath);
			const localFileName = getChecksumLocalImageName(checksum);
			const localPath = path.join(siteImagesDir, localFileName);
			const contentPath = `../../assets/sites/${slug}/${localFileName}`;

			if (fs.existsSync(localPath)) {
				fs.unlinkSync(processedPath);
			} else {
				fs.renameSync(processedPath, localPath);
			}

			localImages.push(contentPath);
			nextManifest[sourceKey] = {
				localName: localFileName,
				checksum,
				sourceChecksum: remoteChecksum,
			};
			usedFileNames.add(localFileName);
			console.log(`   🖼️  Wrote ${contentPath}`);

			if (fs.existsSync(tempPath)) {
				fs.unlinkSync(tempPath);
			}
			if (fs.existsSync(processedPath)) {
				fs.unlinkSync(processedPath);
			}
		} catch (error) {
			console.warn(`⚠️  Failed to localize image for ${slug}: ${imageUrl}`);
			console.warn(`   ${error.message}`);
			// Never preserve remote URLs in frontmatter.
		}
	}

	pruneUnusedLocalizedImages(siteImagesDir, usedFileNames);
	savePhotoManifest(siteImagesDir, nextManifest);

	return localImages;
}

async function syncSites() {
	console.log('🌳 Syncing sites from API...');
	console.log('🖼️  Image localization enabled (manifest-backed)');

	try {
		// Fetch sites from API
		const response = await fetch('https://api.protect.earth/sites');
		if (!response.ok) {
			throw new Error(`API returned ${response.status}: ${response.statusText}`);
		}

		const allSites = await response.json();

		// Filter out ignored sites
		const sites = allSites.filter((site) => !ignoredSites.includes(site.name));

		console.log(`📊 Found ${sites.length} sites (${allSites.length - sites.length} ignored)`);

		// Path to site metadata content directory
		const sitesDir = path.join(__dirname, '../src/content/siteMeta');
		const imagesDir = path.join(__dirname, '../src/assets/sites');
		const tempDir = path.join(__dirname, '../.temp-images');

		// Ensure directory exists
		if (!fs.existsSync(sitesDir)) {
			fs.mkdirSync(sitesDir, { recursive: true });
		}

		[imagesDir, tempDir].forEach((dir) => {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
		});

		// Get existing site files
		const existingFiles = new Set(
			fs
				.readdirSync(sitesDir)
				.filter((file) => file.endsWith('.md'))
				.map((file) => file.replace('.md', '')),
		);

		let createdCount = 0;
		let updatedCount = 0;
		let skippedCount = 0;

		// Create or update markdown files for sites
		for (const site of sites) {
			const slug = toKebabCase(site.name);

			if (!slug) {
				console.warn(`⚠️  Skipping site with invalid name: ${site.name}`);
				continue;
			}

			const filePath = path.join(sitesDir, `${slug}.md`);
			const fileExists = existingFiles.has(slug);

			let frontmatter = { tags: [] };
			let content = '';

			// If file exists, read existing data to preserve it
			if (fileExists) {
				try {
					const fileContent = fs.readFileSync(filePath, 'utf8');
					const parsed = matter(fileContent);
					frontmatter = parsed.data;
					content = parsed.content;
				} catch (error) {
					console.warn(`⚠️  Could not parse ${slug}.md:`, error.message);
				}
			}

			const sanitizedExistingImages = sanitizeLocalImagePaths(frontmatter.images);
			if (sanitizedExistingImages.length > 0) {
				frontmatter.images = sanitizedExistingImages;
			} else {
				delete frontmatter.images;
			}

			const localImages = await localizeSiteImages(site, slug, imagesDir, tempDir);
			if (localImages.length > 0) {
				frontmatter.images = localImages;
			} else {
				delete frontmatter.images;
			}

			// Write the file
			const newContent = matter.stringify(content, frontmatter);
			fs.writeFileSync(filePath, newContent, 'utf8');

			if (fileExists) {
				console.log(`🔄 Updated: ${slug}.md`);
				updatedCount++;
			} else {
				console.log(`✅ Created: ${slug}.md`);
				createdCount++;
			}
		}

		console.log(`\n✨ Complete!`);
		console.log(`   Created: ${createdCount} new file(s)`);
		console.log(`   Updated: ${updatedCount} existing file(s)`);
		console.log(`   Skipped: ${skippedCount} site(s)`);

		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	} catch (error) {
		console.error('❌ Error syncing sites:', error.message);
		process.exit(1);
	}
}

syncSites();
