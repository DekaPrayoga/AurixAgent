#!/usr/bin/env node
// Generate a reference PNG showing tile numbering for 3x3 and 4x4 grids
import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'training', 'tile-numbering.png');

const W = 1200, H = 700;

function makeGrid(cols, rows, tileSize, offsetX, offsetY) {
  const total = cols * rows;
  let svg = `<g transform="translate(${offsetX},${offsetY})">`;
  // Grid background
  svg += `<rect x="0" y="0" width="${cols * tileSize}" height="${rows * tileSize}" fill="#f0f0f0" stroke="#333" stroke-width="3"/>`;
  // Tiles and numbers
  for (let i = 0; i < total; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x = c * tileSize, y = r * tileSize;
    svg += `<rect x="${x}" y="${y}" width="${tileSize}" height="${tileSize}" fill="white" stroke="#666" stroke-width="2"/>`;
    const fontSize = Math.floor(tileSize * 0.5);
    svg += `<text x="${x + tileSize/2}" y="${y + tileSize/2 + fontSize/3}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="bold" fill="#222" text-anchor="middle">${i}</text>`;
  }
  svg += `</g>`;
  return svg;
}

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="white"/>
  
  <!-- Title -->
  <text x="${W/2}" y="50" font-family="Arial,sans-serif" font-size="40" font-weight="bold" fill="#111" text-anchor="middle">TILE NUMBERING REFERENCE</text>
  <text x="${W/2}" y="85" font-family="Arial,sans-serif" font-size="22" fill="#555" text-anchor="middle">Read left-to-right, top-to-bottom</text>
  
  <!-- 3x3 label -->
  <text x="250" y="145" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#2a6" text-anchor="middle">3x3 GRID (9 tiles)</text>
  ${makeGrid(3, 3, 120, 70, 170)}
  
  <!-- 4x4 label -->
  <text x="870" y="145" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#26a" text-anchor="middle">4x4 GRID (16 tiles)</text>
  ${makeGrid(4, 4, 100, 670, 170)}
  
  <!-- Input hints -->
  <text x="${W/2}" y="${H - 110}" font-family="Arial,sans-serif" font-size="22" font-weight="bold" fill="#111" text-anchor="middle">INPUT FORMAT:</text>
  <text x="${W/2}" y="${H - 75}" font-family="monospace" font-size="20" fill="#333" text-anchor="middle">2,5,6,8    or    skip    or    done</text>
  <text x="${W/2}" y="${H - 40}" font-family="Arial,sans-serif" font-size="18" fill="#777" text-anchor="middle">Tiles numbered from 0. Example: top-left = 0, bottom-right = 8 (3x3) or 15 (4x4)</text>
</svg>`;

const buf = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(outPath, buf);
console.log(`Written: ${outPath} (${buf.length} bytes)`);
