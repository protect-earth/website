# Blog Post Categories

This document lists all available categories for blog articles. Categories should be added to article frontmatter as an array using their slug identifiers.

Category configuration is defined in `/src/config.ts` in the `CATEGORY_MAP` constant.

## Available Categories

| Slug                        | Display Name                    | Description                                                                                                                                                          |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `woodland-management`       | **Woodland Management**         | Articles about coppicing, hedge laying, thinning, maintenance techniques, traditional woodland practices, and how-to guides for woodland care                        |
| `woodland-creation`         | **Woodland Creation**           | Tree planting guides, restoration projects, planting techniques, best practices, and establishing new woodlands                                                      |
| `conservation-biodiversity` | **Conservation & Biodiversity** | Biodiversity importance, habitat creation, ancient woodlands, hedgerows, species protection, ecological topics, educational explainers, and misconceptions addressed |
| `invasive-species`          | **Invasive Species**            | Articles about tackling invasive plants (Japanese knotweed, bamboo, rhododendrons, balsam, etc.), their impact, and practical removal guides                         |
| `updates-progress`          | **Updates & Progress**          | Annual reports, site-specific updates (High Wood, Goytre Wood, Nannerch), seasonal summaries, and achievements                                                       |
| `community-volunteering`    | **Community & Volunteering**    | Corporate volunteering, volunteer experiences, community courses, events, team building, and personal stories                                                        |
| `sustainable-farming`       | **Sustainable Farming**         | Agroforestry, regenerative farming, case studies (like Pontbren), and balancing food production with nature                                                          |
| `climate-environment`       | **Climate & Environment**       | Climate crisis impacts, flooding, droughts, storms, carbon sequestration, environmental challenges, thought pieces, and book reviews                                 |
| `policy-funding`            | **Policy & Funding**            | Government schemes, regulations, funding challenges, land management policies, and policy analysis                                                                   |
| `wildlife-habitats`         | **Wildlife & Habitats**         | Specific species (red squirrels, beavers, birds), wildlife habitats, ecosystem relationships, and species guides                                                     |

## Usage

Add categories to your article frontmatter using the **slug** identifiers:

```yaml
---
title: 'Your Article Title'
description: 'Your article description'
pubDate: 2026-05-14T12:00:00.000Z
author: 'Author Name'
thumbnail: ../../articles/your-image.jpg
categories:
  - woodland-creation
  - conservation-biodiversity
---
```

## Notes

- Categories are optional but recommended for better organization
- Articles can have multiple categories (typically 1-3 is ideal)
- Use the **slug** (left column) in frontmatter, not the display name
- Category slugs must match exactly as listed above (case-sensitive, lowercase with hyphens)
- Categories will be displayed with their full names as badges on both article listing pages and individual article pages
- Category badges are clickable and link to category pages (e.g., `/articles/category/woodland-management`) where readers can find all articles in that category
