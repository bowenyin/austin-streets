# Name Austin Streets

How much of Austin's street network can you name from memory? Type a street name and press Return; matching streets light up on the map, and your score is the share of total street miles you've named. Progress is saved in your browser; use **Transfer & restore** to copy a link or code that restores it on another device. The code is a compressed list of street keys (`progress-code.js`), and a link carries it after `#p=`, so it never reaches the server.

Inspired by [Name SF Streets](https://carvin.github.io/sf-street-names/).

## Run locally

```bash
python3 -m http.server 8737
```

Then open http://localhost:8737.

## Data

Streets, water, and parks come from OpenStreetMap (© OpenStreetMap contributors, ODbL), clipped to the City of Austin boundary (OSM relation 113314). The street set covers named public roads (residential through motorway) and leaves out service roads, alleys, and paths.

To rebuild `data/`:

```bash
scripts/fetch-osm.sh
node scripts/build-data.mjs
```

`normalize.js` turns names into matching keys and is shared by the build script and the game. It drops directional prefixes, street-type suffixes, and route designations, so "S Lamar Blvd", "Lamar", "I-35", and "IH 35" all match. Divided highways count at half length so both carriageways aren't double-counted.

## Map label font

Map labels use Inter Medium, served as MapLibre glyph files from `fonts/Inter Medium/` (Inter is under the SIL Open Font License; see `fonts/Inter-LICENSE.txt`). To regenerate them from `Inter-Medium.ttf` in the [Inter release](https://github.com/rsms/inter/releases):

```bash
npx -p fontnik@0.7.7 node scripts/build-glyphs.cjs Inter-Medium.ttf "fonts/Inter Medium"
```
