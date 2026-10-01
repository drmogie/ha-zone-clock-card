# Zone Clock Card

**Version:** 2026.09.30.01

A custom [Home Assistant](https://www.home-assistant.io/) Lovelace card - a "Weasley Clock" style widget that shows each tracked person's avatar next to whichever zone category they're currently in. Group real HA zones into named categories, pick a layout, and watch people move as their location changes.

## Features

- Two layouts, switchable from the visual editor:
  - **Clock face (circular)** - categories sit evenly around a clock face like hour marks; avatars move along the spoke to whichever zone category they're in, sweeping clockwise or counter-clockwise (whichever is shorter) when someone changes zones, with an arrival glow pulse.
  - **Columns (classic)** - the original layout: one column per category, avatars slide sideways between columns.
- Group multiple real HA zones into one named category (e.g. "Work" = `zone.office` + `zone.job_site`).
- A category left with no zones becomes the automatic fallback/catch-all column (e.g. "Away", "Traveling", "Lost").
- Person avatars use their HA profile photo, falling back to an initial letter if there's no photo.
- People sharing a zone stack in a chain instead of overlapping randomly - in Clock face mode they line up along the spoke toward the center; in Columns mode they compact vertically to fit the card's height.
- Full visual editor - no YAML required. Includes collapsible zone category boxes with up/down reordering, and a reorderable people list.
- Responsive: resizes cleanly in both Masonry and Sections dashboard views.

## Installation

### HACS

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=drmogie&repository=ha-zone-clock-card&category=plugin)

1. Open the badge above (or add `drmogie/ha-zone-clock-card` as a custom repository in HACS, category "Dashboard").
2. Install **Zone Clock Card**.
3. Add the resource to your dashboard (HACS does this automatically for most setups).

### Manual

1. Download `ha-zone-clock-card.js` from the [latest release](https://github.com/drmogie/ha-zone-clock-card/releases) or this repo.
2. Copy it to `config/www/ha-zone-clock-card/ha-zone-clock-card.js`.
3. Add it as a dashboard resource:

[![Open your Home Assistant instance and show your dashboard resources.](https://my.home-assistant.io/badges/lovelace_resources.svg)](https://my.home-assistant.io/redirect/lovelace_resources/)

   - URL: `/local/ha-zone-clock-card/ha-zone-clock-card.js`
   - Resource type: **JavaScript Module**
4. Hard-refresh your browser (**Ctrl/Cmd+Shift+R**) after installing or updating the file - the browser can cache the old version otherwise.

## Usage

Add the card via the dashboard UI card picker (search "Zone Clock Card"), or manually with YAML:

```yaml
type: custom:ha-zone-clock-card
title: Family Locations
layout: clock                # "clock" or "columns"
show_names: true             # show name labels under avatars
show_category_icons: true    # show icons on category labels
header_position: top         # "top" or "bottom" - Columns layout only
persons:
  - person.alice
  - person.bob
categories:
  - label: Home
    icon: mdi:home
    zones:
      - zone.home
  - label: Work
    icon: mdi:briefcase
    zones:
      - zone.office
      - zone.job_site
  - label: Away
    icon: mdi:help-circle
    zones: []                # empty zones list = fallback/catch-all category
```

Then click the card's edit (pencil) icon to configure title, layout, people, and zone categories through the visual editor - no YAML required.

### Configuration options

| Name                   | Type                    | Default | Description                                                             |
| ---------------------- | ----------------------- | ------- | ------------------------------------------------------------------------ |
| `title`                | string                  | -       | Card header title (optional).                                            |
| `layout`                | `clock` \| `columns`    | `clock` | Which visual layout to use.                                              |
| `show_names`            | boolean                 | `true`  | Show each person's name under their avatar.                              |
| `show_category_icons`   | boolean                 | `true`  | Show the `mdi:` icon on each category label.                             |
| `header_position`       | `top` \| `bottom`       | `top`   | Where the category header row sits. Columns layout only.                 |
| `persons`               | list of `person.*` entity IDs | `[]` | The people to track.                                                 |
| `categories`            | list of category objects | -      | See below.                                                                |

Each **category** object:

| Key     | Type                     | Description                                                                                                     |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `label` | string                   | Display name (e.g. "Home", "Work", "Away").                                                                        |
| `icon`  | string                   | Optional `mdi:` icon shown on the label.                                                                            |
| `zones` | list of `zone.*` entity IDs | The real HA zones grouped under this category. Leave empty to make this the fallback category for anyone not matching any other zone. |

## Layout notes

**Clock face** works best with `grid_options` that give it roughly square dimensions in Sections view (e.g. equal columns/rows), since the circle is sized to fit whichever dimension is smaller.

**Columns** works well in short/wide cards (e.g. `columns: full`, `rows: 2`), and will compact overlapping avatars as tightly as needed to fit the available height rather than clipping or scrolling.

## Changelog

- **2026.09.30.01** - Version number changed to the two-digit format. No other changes.
- **2026.09.13.1** - Initial release under the `ha-` naming convention. Current feature set: dual layouts (clock face + columns), collapsible/reorderable editor for categories and people, radial chain-stacking and clockwise/counter-clockwise arc animation in Clock face mode, proportional label/avatar scaling, and compaction-to-fit in Columns mode.

## License

MIT © 2026 drmogie
