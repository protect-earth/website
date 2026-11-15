/**
 * Shared utilities for Notion sync scripts
 */

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
		case 'checkbox':
			return property.checkbox;
		case 'url':
			return property.url;
		case 'email':
			return property.email;
		case 'files':
			return (
				property.files?.map((file) => ({
					name: file.name,
					url: file.type === 'file' ? file.file?.url : file.external?.url,
					sourceType: file.type,
					sourceId: file.file_upload?.id || null,
					mimeType: file.file?.mime_type || null,
				})) || []
			);
		case 'relation':
			return property.relation?.map((rel) => rel.id) || [];
		default:
			return null;
	}
}

function getBlockRichText(block) {
	if (!block || !block.type || !block[block.type]) {
		return '';
	}

	const blockValue = block[block.type];
	if (!Array.isArray(blockValue.rich_text)) {
		return '';
	}

	return getRichText(blockValue.rich_text);
}

function convertBlockToMarkdown(block, depth = 0) {
	if (!block) return '';

	const richText = getBlockRichText(block);
	const listIndent = '  '.repeat(Math.max(depth, 0));

	switch (block.type) {
		case 'paragraph':
			return richText ? richText + '\n\n' : '\n';
		case 'heading_1':
			return richText ? '# ' + richText + '\n\n' : '';
		case 'heading_2':
			return richText ? '## ' + richText + '\n\n' : '';
		case 'heading_3':
			return richText ? '### ' + richText + '\n\n' : '';
		case 'bulleted_list_item':
			return listIndent + '- ' + richText + '\n';
		case 'numbered_list_item':
			return listIndent + '1. ' + richText + '\n';
		case 'to_do':
			return `${listIndent}- [${block.to_do.checked ? 'x' : ' '}] ${richText}\n`;
		case 'toggle':
			return richText ? `${listIndent}- ${richText}\n` : '';
		case 'quote':
			return richText ? '> ' + richText + '\n\n' : '';
		case 'callout':
			return richText ? '> ' + richText + '\n\n' : '';
		case 'code': {
			const code = richText;
			const lang = block.code.language || '';
			return '```' + lang + '\n' + code + '\n```\n\n';
		}
		case 'divider':
			return '---\n\n';
		case 'image': {
			const caption = getRichText(block.image.caption);
			return caption ? `![${caption}]()\n\n` : '';
		}
		default:
			return richText ? richText + '\n\n' : '';
	}
}

async function renderBlocksToMarkdown(blocks) {
	let markdown = '';
	for (const block of blocks) {
		markdown += convertBlockToMarkdown(block);
	}
	return markdown;
}

async function listAllBlocks(notion, blockId) {
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

function normalizeContent(content) {
	return (
		content
			// Normalize line endings
			.replace(/\r\n?/g, '\n')
			// Normalize non-breaking spaces
			.replace(/\u00a0/g, ' ')
			// Remove trailing spaces/tabs on each line
			.replace(/[\t ]+$/gm, '')
			// Collapse whitespace-only lines into plain blank lines
			.replace(/^[\t ]+$/gm, '')
			// Remove leading/trailing whitespace/newlines
			.replace(/^[\t \n]+|[\t \n]+$/g, '')
	);
}

async function getPageContent(notion, pageId) {
	try {
		const blocks = await listAllBlocks(notion, pageId);
		const rawContent = await renderBlocksToMarkdown(blocks);
		return normalizeContent(rawContent);
	} catch (error) {
		return '';
	}
}

export {
	toKebabCase,
	getRichText,
	formatDate,
	getPropertyValue,
	getBlockRichText,
	convertBlockToMarkdown,
	renderBlocksToMarkdown,
	listAllBlocks,
	normalizeContent,
	getPageContent,
};
