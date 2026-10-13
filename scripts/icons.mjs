// Makes the app icons from assets/icon.svg: icon.png (Linux and the window), icon.ico (Windows),
// icon.icns (macOS), and the phone page's icons. Run after changing the SVG: node scripts/icons.mjs
import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pngToIco from 'png-to-ico';

const root = resolve(import.meta.dirname, '..');
const svg = await readFile(resolve(root, 'assets/icon.svg'));
const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

await writeFile(resolve(root, 'assets/icon.png'), png(512));
await writeFile(resolve(root, 'assets/icon.ico'), await pngToIco([16, 24, 32, 48, 64, 128, 256].map(png)));
await writeFile(
  resolve(root, 'assets/icon.icns'),
  icns([
    ['icp4', png(16)],
    ['icp5', png(32)],
    ['ic11', png(32)],
    ['ic12', png(64)],
    ['ic07', png(128)],
    ['ic08', png(256)],
    ['ic13', png(256)],
    ['ic09', png(512)],
    ['ic14', png(512)],
    ['ic10', png(1024)],
  ]),
);
await mkdir(resolve(root, 'src/phone/public'), { recursive: true });
await writeFile(resolve(root, 'src/phone/public/icon-192.png'), png(192));
await writeFile(resolve(root, 'src/phone/public/apple-touch-icon.png'), png(180));
console.log('Icons written.');

/** Apple's icon format: a header, then one PNG per size, each tagged with its type. */
function icns(entries) {
  const chunks = entries.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}
