# Concordia — Branding Guide

---

## What is Concordia?

Concordia is a **federated, decentralised, real-time chat and social platform**. It is conceptually similar to Discord but built around a philosophy of ownership, openness, and sovereignty — no single company controls the network.

### Core product ideas

- **Federated/decentralised chat** — The network is made up of independent servers that communicate directly with each other. There is no Concordia-owned infrastructure that everything must route through.
- **Global identity** — Users register a single global username on the federation. That identity works across every server on the network without needing separate accounts.
- **Global server registration** — Servers (groups of channels) are registered on the federation so they are discoverable and addressable across the network.
- **You control your data** — Every piece of content lives on the server the owner chooses — whether that is their own hardware at home or a cloud VPS. Data does not pass through or get stored by a central company.
- **Unlimited custom content** — Servers can host their own custom emotes, large file uploads, and full message history without artificial platform limits.
- **Cross-server interop** — Servers that trust each other can share things: emotes, messages, channel content. Communities can collaborate without being merged or owned by the same operator.
- **Real servers** — "Servers" are actual hardware — bare metal machines or virtualised instances. Operators choose their own infrastructure.
- **Self-hosted or cloud** — Anyone can run a Concordia server. Self-host it on your own machine, deploy it to a VPS, or use a managed cloud provider.
- **Fully open source** — All code is public. Anyone can audit it, fork it, contribute to it, or self-host it without restriction.

---

## Colors

| Role | Name | Hex |
|---|---|---|
| Primary / brand | Indigo 600 | `#4F46E5` |
| Primary hover | Indigo 700 | `#4338CA` |
| Primary light tint | Indigo 100 | `#E0E7FF` |
| Primary accent text | Indigo 400 | `#818CF8` |
| Background (hero gradient start) | Indigo 900 | `#1E1B4B` |
| Background (hero gradient end) | Indigo 700 | `#3730A3` |
| Neutral background | White | `#FFFFFF` |
| Body text | Gray 900 | `#111827` |
| Muted text | Gray 500 | `#6B7280` |
| Subtle text / footer | Gray 400 | `#9CA3AF` |
| Borders / dividers | Gray 100 | `#F3F4F6` |

---

## Typography

| Role | Family | Weight(s) |
|---|---|---|
| Global / body | Montserrat | 400, 600 |
| Headings | Montserrat | 700, 900 |
| Code / monospace | System monospace | — |

Montserrat is loaded via Google Fonts (preconnect + stylesheet in `index.html`) and set as the default `font-sans` in `tailwind.config.js`.

---

## Logo & wordmark assets

All assets live in `branding/` (source) and are copied to `frontend/public/branding/` for use in the app.

| File | Description | Status |
|---|---|---|
| `Logo - Indigo.svg` | Full lockup — icon + wordmark, square composition | ✅ |
| `Wordmark - Indigo.svg` | Landscape wordmark for navbar and horizontal layouts | ✅ |
| `Text Only - Indigo.svg` | Logotype text only, no icon | ✅ |
| `Icon - Indigo.png` | Icon/mark only, for favicons and small contexts | ✅ |
| `Hero - Indigo.svg` | 1440×600 hero banner — gradient background, animated (see below) | ✅ |
| Light/white variants | White versions of each asset for use on dark backgrounds | ❌ request when needed |

### Favicon set (in `frontend/public/`)

| File | Usage |
|---|---|
| `favicon.svg` | Modern browsers (scalable) |
| `favicon.ico` | Legacy browsers |
| `favicon-96x96.png` | General PNG fallback |
| `apple-touch-icon.png` | iOS home screen |
| `site.webmanifest` | PWA manifest (name, icons, theme color) |

---

## Hero banner animation

**File:** `Hero - Indigo.svg`  
**Dimensions:** 1440 × 600 px  
**Background:** Linear gradient — Indigo 900 → Indigo 700 (left → right)

The SVG contains an embedded `<style>` block with a CSS `@keyframes heroCIn` animation (opacity 0 → 1) applied to three named groups with staggered delays:

| Element | Group ID | Duration | Delay |
|---|---|---|---|
| Large "C" mark | `hero-c` | 1.0s | 0s |
| "oncordia" wordmark text | `hero-wordmark` | 0.9s | 0.35s |
| "Talk free" tagline | `hero-tagline` | 0.8s | 0.7s |

CSS keyframe animations inside SVGs work correctly when loaded via an `<img>` tag in all modern browsers.

---

## Tailwind animation utilities

Defined in `tailwind.config.js` under `theme.extend`:

| Class | Effect |
|---|---|
| `animate-fade-up` | Fade in + slide up, no delay |
| `animate-fade-up-d1` | Same, 0.2s delay |
| `animate-fade-up-d2` | Same, 0.4s delay |
| `animate-fade-up-d3` | Same, 0.6s delay |

All use `animation-fill-mode: both` so elements stay hidden before the animation starts.

---

## Still needed

| Asset | Spec | Notes |
|---|---|---|
| Light/white logo variants | Match existing assets, white fill | For dark UI sections |
| OG / social share image | 1200 × 630 px | Link previews on Discord, Twitter, etc. |
| App store icon | 1024 × 1024 px, no alpha | iOS / Android store listing |
| Empty state illustrations | 3 × thematic SVG | e.g. no messages, no servers joined, loading |
