import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectWorks, syncBrochures } from './sync-works.js';

const title = (text) => ({ type: 'title', title: [{ plain_text: text }] });
const column = (property_name, visible = true) => ({ property_name, visible });

function mockNotion() {
	const calls = [];
	const pages = {
		first: {
			id: 'first-12345678',
			url: 'https://notion.test/first',
			properties: {
				Name: title('First project'),
				Region: { type: 'rollup', id: 'region' },
				'Work Type': { type: 'multi_select', multi_select: [{ name: 'Woodland' }] },
				'Total Planned': { type: 'number', number: 0 },
				'Funding Required': { type: 'formula', formula: { type: 'number', number: 250 } },
				'Funding per Unit': { type: 'number', number: 5 },
				'Length (Hedgerow)': { type: 'number', number: 12 },
				'tCO2e after 50yrs': { type: 'formula', formula: { type: 'number', number: 7 } },
				'Funding Brochure': {
					type: 'files',
					files: [
						{
							type: 'file',
							name: 'notion-secret.pdf',
							file: { url: 'https://notion.test/secret' },
						},
					],
				},
				'Delivery Notes': { type: 'rich_text', rich_text: [{ plain_text: 'private' }] },
			},
		},
		second: {
			id: 'second-87654321',
			url: 'https://notion.test/second',
			properties: { Name: title('Second project') },
		},
		region1: { properties: { Name: title('South West') } },
		region2: { properties: { Name: title('Wales') } },
	};
	const view = {
		type: 'table',
		configuration: {
			properties: [
				...Object.keys(pages.first.properties)
					.filter((name) => name !== 'Delivery Notes')
					.filter((name) => name !== 'Funding Brochure')
					.map((name) => column(name)),
				column('Delivery Notes', false),
			],
		},
	};
	const notion = {
		views: {
			retrieve: async () => view,
			queries: {
				create: async () => ({
					id: 'query',
					results: [{ object: 'page', id: 'first' }],
					has_more: false,
				}),
				results: async (args) => {
					calls.push(args);
					return { results: [{ object: 'page', id: 'second' }], has_more: false };
				},
				delete: async (args) => calls.push(args),
			},
		},
		pages: {
			retrieve: async ({ page_id }) => {
				calls.push({ page_id });
				return pages[page_id];
			},
			properties: {
				retrieve: async ({ start_cursor }) => ({
					object: 'list',
					property_item: { type: 'rollup', rollup: { type: 'array' } },
					results: [{ type: 'relation', relation: { id: start_cursor ? 'region2' : 'region1' } }],
					has_more: !start_cursor,
					next_cursor: start_cursor ? null : 'next-region',
				}),
			},
		},
	};
	return { notion, pages, view, calls };
}

test('exports visible view columns, complete region rollup and numeric formulas', async () => {
	const { notion } = mockNotion();
	const { works, brochures } = await collectWorks(notion, 'view');
	assert.equal(brochures.length, 1);
	assert.match(brochures[0].filename, /^first-project-[a-f0-9]{10}-funding-brochure\.pdf$/);
	assert.deepEqual(works, [
		{
			id: 'first-12345678',
			slug: 'first-project-12345678',
			name: 'First project',
			region: ['South West', 'Wales'],
			workType: ['Woodland'],
			totalPlanned: 0,
			fundingRequired: 250,
			fundingPerUnit: 5,
			length: 12,
			tco2eAfter50Years: 7,
			fundingBrochures: [`/works/funding-brochures/${brochures[0].filename}`],
			notionUrl: 'https://notion.test/first',
		},
	]);
});

test('paginates the view and deletes the query', async () => {
	const { notion, view, calls } = mockNotion();
	view.configuration.properties = [column('Name')];
	notion.views.queries.create = async () => ({
		id: 'query',
		results: [{ object: 'page', id: 'first' }],
		has_more: true,
		next_cursor: 'next',
	});
	const { works } = await collectWorks(notion, 'view');
	assert.deepEqual(
		works.map((work) => work.name),
		['First project', 'Second project'],
	);
	assert.ok(calls.some((call) => call.query_id === 'query' && call.start_cursor === 'next'));
	assert.ok(calls.some((call) => call.query_id === 'query' && !call.start_cursor));
});

test('downloads PDFs, removes only old synced brochures, and rejects non-PDFs', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-brochures-'));
	const originalFetch = globalThis.fetch;
	try {
		fs.writeFileSync(path.join(dir, 'old.pdf'), 'old');
		fs.writeFileSync(path.join(dir, 'unrelated.pdf'), 'unrelated');
		const previous = [{ fundingBrochures: ['/works/funding-brochures/old.pdf'] }];
		globalThis.fetch = async () => new Response('%PDF-test');
		await syncBrochures(
			[{ url: 'https://notion.test/signed', filename: 'new.pdf' }],
			previous,
			dir,
		);
		assert.equal(fs.readFileSync(path.join(dir, 'new.pdf'), 'utf8'), '%PDF-test');
		assert.equal(fs.existsSync(path.join(dir, 'old.pdf')), false);
		assert.equal(fs.existsSync(path.join(dir, 'unrelated.pdf')), true);
		globalThis.fetch = async () => new Response('<html>not a PDF</html>');
		await assert.rejects(
			syncBrochures([{ url: 'https://notion.test/signed', filename: 'new.pdf' }], [], dir),
			/not a PDF/,
		);
		assert.equal(fs.readFileSync(path.join(dir, 'new.pdf'), 'utf8'), '%PDF-test');
	} finally {
		globalThis.fetch = originalFetch;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('rejects unknown visible columns and failed pagination', async () => {
	const { notion, view, calls } = mockNotion();
	view.configuration.properties.push(column('Delivery Notes'));
	await assert.rejects(collectWorks(notion, 'view'), /Unsupported visible view property/);
	view.configuration.properties.pop();
	notion.views.queries.create = async () => ({ id: 'query', results: [], has_more: true });
	await assert.rejects(collectWorks(notion, 'view'), /Missing view query cursor/);
	assert.ok(calls.some((call) => call.query_id === 'query'));
});
