#!/usr/bin/env bash
# Downloads Austin, TX streets, water, parks, and the city boundary from the Overpass API into raw/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p raw

UA="austin-street-names-game/1.0"
API="https://overpass-api.de/api/interpreter"
# OSM relation 113314 is the City of Austin, TX; its Overpass area id is 3600000000 + 113314.
AREA="area(3600113314)->.a;"

fetch() {
  curl -sS --fail --max-time 600 -A "$UA" -X POST "$API" --data-urlencode "data=$2" -o "raw/$1.json"
  echo "raw/$1.json: $(wc -c < "raw/$1.json") bytes"
}

fetch streets "[out:json][timeout:300];$AREA
way(area.a)[highway~\"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$\"][name];
out tags geom;"

fetch water "[out:json][timeout:300];rel(113314);out geom;$AREA
(way(area.a)[natural=water];rel(area.a)[natural=water];);
out geom;"

fetch parks "[out:json][timeout:300];$AREA
(way(area.a)[leisure~\"^(park|nature_reserve)$\"];rel(area.a)[leisure~\"^(park|nature_reserve)$\"];);
out geom;"
