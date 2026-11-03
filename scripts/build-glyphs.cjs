// Builds MapLibre glyph files (SDF .pbf) for map labels from a TTF.
// Usage: npx -p fontnik@0.7.7 node scripts/build-glyphs.cjs <Inter-Medium.ttf> "fonts/Inter Medium"
const fs = require('fs');
const path = require('path');
const fontnik = require('fontnik');

const [ttf, outDir] = process.argv.slice(2);
const font = fs.readFileSync(ttf);
fs.mkdirSync(outDir, { recursive: true });

// Latin, Latin Extended, combining marks, Latin Extended Additional, and punctuation.
const starts = [0, 256, 512, 768, 7680, 7936, 8192, 8448];
for (const start of starts) {
  fontnik.range({ font, start, end: start + 255 }, (err, pbf) => {
    if (err) throw err;
    fs.writeFileSync(path.join(outDir, `${start}-${start + 255}.pbf`), pbf);
  });
}
