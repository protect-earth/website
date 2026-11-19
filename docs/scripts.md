# Scripts

This document describes the content sync scripts used by the website.

## Overview

Scripts are in `scripts/` and are intended to keep content files aligned with external systems:

- Protect Earth API for site data
- Notion for site updates
- Optional image download and optimization workflows

## Prerequisites

1. Install dependencies:

```bash
pnpm install
```

2. Create local environment file:

```bash
cp .env.example .env
```

3. Populate required values in .env for Notion integrations.

## Script Reference

### sync-sites.js

Command:

```bash
pnpm sync-sites
```

With image localization:

```bash
pnpm sync-sites:replace-images
```

Purpose:

- Fetches sites from `https://api.protect.earth/sites`
- Applies ignore list from script config
- Creates/updates local site markdown files
- Preserves existing local frontmatter values
- Rebuilds each site's local image list from API sources and rewrites frontmatter to local paths only

Primary output location:

- src/content/siteMeta

### sync-site-updates.js

Command:

```bash
pnpm sync-site-updates
```

With image localization:

```bash
pnpm sync-site-updates:replace-images
```

Required env vars:

- NOTION_API_KEY
- NOTION_SITE_UPDATES_DB_ID

Purpose:

- Reads Site Updates from Notion database
- Converts fields + page blocks to markdown
- Writes one markdown file per update
- Localizes image files from the Notion Photos field to `src/assets/site-updates`
- Ignores Google Drive/external links and only downloads image files
- Uses manifest checksums to reuse unchanged images and removes local images no longer present in Notion

Primary output location:

- src/content/site-updates

### sync-events.js

Command:

```bash
pnpm sync-events
```

Required env vars:

- EVENTBRITE_PRIVATE_TOKEN

Optional env vars:

- EVENTBRITE_ORGANIZATION_ID
- EVENTBRITE_EVENT_STATUSES (default: `live,started`)

Purpose:

- Reads events from Eventbrite (owned events, or organization events when configured)
- Creates/updates one markdown file per active Eventbrite event in the same frontmatter shape as existing events
- Generates local ICS calendar files in `public/events`
- Downloads and localizes event images into `src/assets/events`
- Tracks generated files in a manifest and removes stale synced events/assets no longer returned by Eventbrite

Primary output locations:

- src/content/events
- public/events

### sync-works.js

Command:

```bash
pnpm sync-works
```

Required env vars:

- NOTION_API_KEY
- NOTION_NEEDS_FUNDING_VIEW_ID

Purpose:

- Queries the saved "Needs Funding" view, including its filters and sort order
- Exports its visible columns: name, region, work type, planned quantity, acres, hedgerow length, funding required, funding per unit, and carbon impact
- Resolves region names from the Region rollup; the Notion connection must also have access to the related region pages
- Adds each record's ID, generated slug, and Notion URL; does not export hidden columns or page content, except for Funding Brochure files
- Downloads Funding Brochure PDFs to `public/works/funding-brochures` using project-based filenames, and records their local URLs in `fundingBrochures`. Removes previously synced brochures when they no longer appear in the view
- Fails if the view exposes an unsupported column or property type, rather than silently publishing incomplete data
- Replaces the JSON data file with the current view results, including an empty array when no records match
- The corporate tree planting page displays these projects for sponsorship; run the sync and rebuild the site to update the listing

Primary output location:

- src/data/works.json
