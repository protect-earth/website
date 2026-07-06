# Concepts

This page explains the key content concepts used in the Protect Earth website.

## Sites

A Site represents a real-world project location.

In this repository, site metadata is currently stored in the siteMeta collection at src/content/siteMeta.
Each site metadata file can include:

- tags: categorization labels shown in UI
- fundingPartners: partner names
- notionIds: Notion IDs used to link Site Updates
- images: local image references

Site pages use this metadata with API data and render:

- site map and coordinates
- key facts and stats
- related images
- related updates where available

## Site Updates

A Site Update is a time-based update for a site (planting, survey, maintenance, milestone, etc.).

Site Updates are stored as markdown files in src/content/site-updates and are synced from Notion by scripts/sync-site-updates.js.

Each update can include:

- title
- notionId
- type
- date
- siteNotionId (link back to a Site)
- treesPlanted, treesRestocked, survivalRate
- photos

The update body is markdown content extracted from Notion blocks.

## Content Collections

Collections are defined in src/content.config.ts and validated with Zod schemas.

Current collections include:

- articles
- members
- press
- siteMeta
- siteUpdates

## Article Image Attribution

Articles can include a local `thumbnail` and an optional `thumbnailAttribution` object in frontmatter for the hero image credit.

Inline article images should use `figure` and `figcaption` markup so attribution is visible on the page. The convention is to keep the credit inside a `span.image-attribution` line within the caption.

When adding or changing a content type, update both:

- the collection schema in src/content.config.ts
- any pages/components that read from getCollection(...)
