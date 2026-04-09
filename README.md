# protect.earth

Protect Earth is a charity working on ecosystem creation and restoration all over the UK, starting with woodland creation but expanding into ancient woodland restoration, grassland and wetland restoration. We're even working with beavers to fix up their habitat in Bath.

Our founders are techies, and we're using tech to improve transparency and show what we're doing, but we're all unpaid and absolutely overwhelmed trying to _do all the actual rewilding work_ leaving our website in a bit of a state. With the help of some volunteers we are rewriting it from horrible Squarespace static site, to Astro powered by our existing amazing REST API built with Laravel PHP. This will help us cut down on wasting money hiring data entry "webmasters" (who would rather be doing anything else), and let us drastically improve transparency to show everyone exactly what we're up to and exactly where.

The website needs your help so we can launch it. Replacing [protect.earth](https://protect.earth/) with [protect-earth-website.netlify.app](https://protect-earth-website.netlify.app/) as soon as it is ready to go, then onwards and upwards improving everything.

## Goals

- Show GIS areas on the maps instead of a pin. See exactly what we did on exactly what land.
- Fundraising - particular sites have trees or square meters that need sponsorship, so why not sponsor a site you like the look of.
- Replace the shopify store, if we do the above, why give any money to the AI warlord running Shopify.

## Current state

The website currently includes all the basic marketing type stuff you'd expect from a charity.

- Editorial content (articles, team, press)
- Map-driven "sites" pages to show our ecosystem restoration work, pulled from our "Tree Tracker API"
- "Site update" content synced from Notion (for now) to show progress over 30 years

We've built some utility scripts to pull data from the API and Notion into this Astro static site, but you cannot and should not bother with those. Just treat this like a static site and let us phase that awkward sync out.

## Documentation

Use these docs as your starting point:

- Concepts: [docs/concepts.md](docs/concepts.md)
- Scripts: [docs/scripts.md](docs/scripts.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Quick Start

1. Install dependencies

```
pnpm install
```

2. Create your local environment file

```
cp .env.example .env
```

3. Start development server

```
pnpm dev
```

4. Build production output

```
pnpm build
```

## Core Concepts

Start here if you are new to this repository:

- Sites: [docs/concepts.md#sites](docs/concepts.md#sites)
- Site Updates: [docs/concepts.md#site-updates](docs/concepts.md#site-updates)
- Content Collections: [docs/concepts.md#content-collections](docs/concepts.md#content-collections)

## Scripts

Script workflows are documented in [docs/scripts.md](docs/scripts.md) but they are best avoided unless you're core team.

## Linting

Run Prettier (including the [Prettier Astro plugin](https://github.com/withastro/prettier-plugin-astro)) using:

```bash
pnpm format:check
pnpm format:write
```

## Thanks

Huge work from the following legends got us this far, and have nearly freed us from Squarespace.

- [Jon Park](https://github.com/jonspark) - Most of this rewrite was Jon. 🥰
