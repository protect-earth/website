#!/usr/bin/env node
import { config } from 'dotenv';
import { Client } from '@notionhq/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPropertyValue, toKebabCase } from './notion-utils.js';

const outputPath = fileURLToPath(new URL('../src/data/works.json', import.meta.url));
const brochureDir = fileURLToPath(new URL('../public/works/funding-brochures/', import.meta.url));
const brochureUrlPrefix = '/works/funding-brochures/';

const fields = {
	Name: 'name',
	Region: 'region',
	'Work Type': 'workType',
	'Total Planned': 'totalPlanned',
	Acres: 'acres',
	'Length (Hedgerow)': 'length',
	'Funding Required': 'fundingRequired',
	'Funding per Unit': 'fundingPerUnit',
	'tCO2e after 50yrs': 'tco2eAfter50Years',
};

async function getRegion(notion, pageId, property, regionNames) {
	const items = [];
	let cursor;
	let response;
	do {
		response = await notion.pages.properties.retrieve({
			page_id: pageId,
			property_id: property.id,
			page_size: 100,
			start_cursor: cursor,
		});
		if (response.object !== 'list' || response.property_item?.type !== 'rollup') {
			throw new Error(`Unexpected Region rollup response for ${pageId}`);
		}
		items.push(...response.results);
		cursor = response.next_cursor;
		if (response.has_more && !cursor) throw new Error(`Missing Region cursor for ${pageId}`);
	} while (response.has_more);

	if (response.property_item.rollup.type !== 'array') {
		throw new Error(`Unsupported Region rollup for ${pageId}`);
	}

	const names = [];
	for (const item of items) {
		if (item.type !== 'relation' || !item.relation?.id) {
			throw new Error(`Unexpected Region rollup item for ${pageId}`);
		}
		const id = item.relation.id;
		if (!regionNames.has(id)) {
			const region = await notion.pages.retrieve({ page_id: id });
			const title = Object.values(region.properties || {}).find((value) => value.type === 'title');
			if (!title) throw new Error(`Cannot read Region title for ${id}`);
			regionNames.set(id, await getPropertyValue(title));
		}
		const name = regionNames.get(id);
		if (name && !names.includes(name)) names.push(name);
	}
	return names;
}

export async function collectWorks(notion, viewId) {
	const view = await notion.views.retrieve({ view_id: viewId });
	if (view.type !== 'table' || !Array.isArray(view.configuration?.properties)) {
		throw new Error('Needs Funding must be a table view with visible property configuration');
	}
	const visible = view.configuration.properties.filter((property) => property.visible);
	for (const property of visible) {
		if (
			!Object.hasOwn(fields, property.property_name) &&
			property.property_name !== 'Funding Brochure'
		) {
			throw new Error(`Unsupported visible view property: ${property.property_name}`);
		}
	}
	if (!visible.some((property) => property.property_name === 'Name')) {
		throw new Error('The Name property must be visible in the view');
	}

	const query = await notion.views.queries.create({ view_id: viewId, page_size: 100 });
	const results = [...query.results];
	try {
		let response = query;
		while (response.has_more) {
			if (!response.next_cursor) throw new Error('Missing view query cursor');
			response = await notion.views.queries.results({
				view_id: viewId,
				query_id: query.id,
				start_cursor: response.next_cursor,
				page_size: 100,
			});
			results.push(...response.results);
		}
	} finally {
		await notion.views.queries.delete({ view_id: viewId, query_id: query.id });
	}

	const works = [];
	const brochures = [];
	const regionNames = new Map();
	for (const result of results) {
		if (result.object !== 'page') throw new Error('Unexpected non-page view result');
		const page = await notion.pages.retrieve({ page_id: result.id });
		if (!page.properties || !page.url) throw new Error(`Cannot read work ${result.id}`);
		const values = {};
		for (const column of visible) {
			if (column.property_name === 'Funding Brochure') continue;
			const property = page.properties[column.property_name];
			if (!property) throw new Error(`Missing ${column.property_name} on work ${page.id}`);
			let value;
			if (column.property_name === 'Region') {
				if (property.type !== 'rollup') throw new Error('Region must be a rollup');
				value = await getRegion(notion, page.id, property, regionNames);
			} else if (property.type === 'formula') {
				if (property.formula.type !== 'number') {
					throw new Error(`Unsupported formula for ${column.property_name} on work ${page.id}`);
				}
				value = property.formula.number;
			} else {
				const expectedType =
					column.property_name === 'Name'
						? 'title'
						: column.property_name === 'Work Type'
							? 'multi_select'
							: 'number';
				if (property.type !== expectedType) {
					throw new Error(`Unexpected ${column.property_name} type on work ${page.id}`);
				}
				value = await getPropertyValue(property);
			}
			if (value !== null && value !== undefined && (!Array.isArray(value) || value.length)) {
				values[fields[column.property_name]] = value;
			}
		}
		const name = values.name?.trim();
		if (!name) throw new Error(`Work ${page.id} has no name`);
		const brochureProperty = page.properties['Funding Brochure'];
		if (brochureProperty && brochureProperty.type !== 'files') {
			throw new Error(`Unexpected Funding Brochure type on work ${page.id}`);
		}
		const projectName = toKebabCase(name).replace(/-+$/, '') || 'project';
		const identifier = crypto.createHash('sha256').update(page.id).digest('hex').slice(0, 10);
		const brochurePaths = (brochureProperty?.files || []).map((file, index) => {
			const url = file.type === 'file' ? file.file?.url : file.external?.url;
			if (!url || !['file', 'external'].includes(file.type)) {
				throw new Error(`Cannot read Funding Brochure on work ${page.id}`);
			}
			const suffix = brochureProperty.files.length > 1 ? `-${index + 1}` : '';
			const filename = `${projectName}-${identifier}-funding-brochure${suffix}.pdf`;
			brochures.push({ url, filename });
			return brochureUrlPrefix + filename;
		});
		works.push({
			id: page.id,
			slug: `${projectName}-${page.id.replace(/-/g, '').slice(-8)}`,
			...values,
			name,
			...(brochurePaths.length && { fundingBrochures: brochurePaths }),
			notionUrl: page.url,
		});
	}
	return { works, brochures };
}

export async function syncBrochures(brochures, previousWorks, directory = brochureDir) {
	const downloaded = [];
	for (const brochure of brochures) {
		const response = await fetch(brochure.url);
		if (!response.ok)
			throw new Error(`Failed to download ${brochure.filename}: HTTP ${response.status}`);
		const data = Buffer.from(await response.arrayBuffer());
		if (data.subarray(0, 5).toString('ascii') !== '%PDF-') {
			throw new Error(`Funding Brochure ${brochure.filename} is not a PDF`);
		}
		downloaded.push({ filename: brochure.filename, data });
	}
	if (downloaded.length) fs.mkdirSync(directory, { recursive: true });
	for (const brochure of downloaded) {
		fs.writeFileSync(path.join(directory, brochure.filename), brochure.data);
	}
	const current = new Set(downloaded.map((brochure) => brochure.filename));
	for (const work of previousWorks) {
		for (const url of work.fundingBrochures || []) {
			if (typeof url !== 'string' || !url.startsWith(brochureUrlPrefix)) continue;
			const filename = url.slice(brochureUrlPrefix.length);
			if (
				filename !== path.basename(filename) ||
				!filename.endsWith('.pdf') ||
				current.has(filename)
			)
				continue;
			const filePath = path.join(directory, filename);
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		}
	}
}

async function main() {
	config({ quiet: true });
	if (!process.env.NOTION_API_KEY || !process.env.NOTION_NEEDS_FUNDING_VIEW_ID) {
		throw new Error('NOTION_API_KEY and NOTION_NEEDS_FUNDING_VIEW_ID are required');
	}
	const notion = new Client({ auth: process.env.NOTION_API_KEY });
	const { works, brochures } = await collectWorks(notion, process.env.NOTION_NEEDS_FUNDING_VIEW_ID);
	const previousWorks = fs.existsSync(outputPath)
		? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
		: [];
	await syncBrochures(brochures, previousWorks);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, JSON.stringify(works, null, 2) + '\n', 'utf8');
	console.log(`Synced ${works.length} work(s) to ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error('Error syncing works:', error);
		process.exitCode = 1;
	});
}
