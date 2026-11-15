#!/usr/bin/env node
import { config } from 'dotenv';
import { Client } from '@notionhq/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
	toKebabCase,
	formatDate,
	getPropertyValue,
	getPageContent,
} from './notion-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVerbose = process.argv.includes('--verbose');

config();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NEEDS_FUNDING_VIEW_ID = process.env.NOTION_NEEDS_FUNDING_VIEW_ID;

if (!NOTION_API_KEY) {
	console.error('Error: NOTION_API_KEY environment variable is required');
	process.exit(1);
}

if (!NEEDS_FUNDING_VIEW_ID) {
	console.error('Error: NOTION_NEEDS_FUNDING_VIEW_ID environment variable is required');
	process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY });

async function syncWorks() {
	console.log('Syncing Works from Notion "Needs Funding" view...');

	try {
		const dataDir = path.join(__dirname, '../src/data');

		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		if (isVerbose) {
			console.log(`Querying view: ${NEEDS_FUNDING_VIEW_ID}`);
		}

		let allResults = [];
		let hasMore = true;
		let startCursor;

		while (hasMore) {
			const response = await notion.views.queries.results({
				view_id: NEEDS_FUNDING_VIEW_ID,
				start_cursor: startCursor,
			});

			allResults = allResults.concat(response.results);
			hasMore = response.has_more;
			startCursor = response.next_cursor;
			console.log(
				`Fetched ${response.results.length} work(s) from Notion (${allResults.length} total so far)`,
			);
		}

		console.log(`Processing ${allResults.length} work(s)...`);

		const works = [];

		for (const [index, page] of allResults.entries()) {
			const properties = page.properties;

			const name = await getPropertyValue(properties.Name);
			if (!name) {
				console.warn(`Warning: Skipping work without name at index ${index}`);
				continue;
			}

			const slug = `${toKebabCase(name)}-${page.id.replace(/-/g, '').slice(-8)}`;

			if (isVerbose) {
				console.log(`[${index + 1}/${allResults.length}] ${name} -> ${slug}`);
			}

			const region = await getPropertyValue(properties.Region);
			const workType = await getPropertyValue(properties['Work Type']);
			const totalPlanned = await getPropertyValue(properties['Total Planned']);
			const acres = await getPropertyValue(properties.Acres);
			const length = await getPropertyValue(properties.Length);
			const fundingRequired = await getPropertyValue(properties['Funding Required']);
			const tco2eAfter50Years = await getPropertyValue(properties['tCO2e after 50 years']);
			const description = await getPageContent(notion, page.id);

			const work = {
				id: page.id,
				slug,
				name: name.trim(),
				...(region && { region }),
				...(workType && { workType }),
				...(totalPlanned !== null && { totalPlanned }),
				...(acres !== null && { acres }),
				...(length !== null && { length }),
				...(fundingRequired !== null && { fundingRequired }),
				...(tco2eAfter50Years !== null && { tco2eAfter50Years }),
				...(description && { description }),
				notionUrl: page.url,
			};

			works.push(work);
		}

		const outputPath = path.join(dataDir, 'works.json');
		fs.writeFileSync(outputPath, JSON.stringify(works, null, 2) + '\n', 'utf8');

		console.log(`✅ Successfully synced ${works.length} work(s) to ${outputPath}`);

		if (works.length === 0) {
			console.warn('⚠️  No works were synced. Check your Notion database configuration.');
		}
	} catch (error) {
		console.error('Error syncing works:', error);
		process.exit(1);
	}
}

syncWorks();
