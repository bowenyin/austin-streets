# Name Austin Streets

How much of Austin's street network can you name from memory? Type a street name and press Return; matching streets light up on the map, and your score is the share of total street miles you've named. Progress is saved in your browser.

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
