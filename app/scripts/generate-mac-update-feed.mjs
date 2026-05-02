#!/usr/bin/env node

import { createHash } from 'crypto';
import { readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';

function usage() {
  console.error(
    'Usage: node scripts/generate-mac-update-feed.mjs --version <semver> --release-date <iso> --output <latest-mac.yml> <asset...>',
  );
}

const args = process.argv.slice(2);
let version = '';
let releaseDate = '';
let output = '';
const assets = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--version') {
    version = args[++i] ?? '';
  } else if (arg === '--release-date') {
    releaseDate = args[++i] ?? '';
  } else if (arg === '--output') {
    output = args[++i] ?? '';
  } else if (arg.startsWith('--')) {
    console.error(`Unknown option: ${arg}`);
    usage();
    process.exit(2);
  } else {
    assets.push(arg);
  }
}

if (!version || !releaseDate || !output || assets.length === 0) {
  usage();
  process.exit(2);
}

const zipAssets = assets.filter((asset) => path.basename(asset).toLowerCase().endsWith('.zip'));
if (zipAssets.length === 0) {
  console.error('latest-mac.yml requires at least one .zip asset for Squirrel.Mac updates.');
  process.exit(1);
}

function sha512Base64(file) {
  const data = statSync(file);
  return {
    size: data.size,
    sha512: createHash('sha512').update(readFileSync(file)).digest('base64'),
  };
}

function yamlString(value) {
  return JSON.stringify(value);
}

const fileEntries = assets.map((asset) => {
  const name = path.basename(asset);
  const { size, sha512 } = sha512Base64(asset);
  return { url: name, sha512, size };
});

const primaryZip = fileEntries.find((entry) => entry.url.toLowerCase().endsWith('.zip'));
const lines = [
  `version: ${yamlString(version)}`,
  'files:',
  ...fileEntries.flatMap((entry) => [
    `  - url: ${yamlString(entry.url)}`,
    `    sha512: ${yamlString(entry.sha512)}`,
    `    size: ${entry.size}`,
  ]),
  `path: ${yamlString(primaryZip.url)}`,
  `sha512: ${yamlString(primaryZip.sha512)}`,
  `releaseDate: ${yamlString(releaseDate)}`,
  '',
];

writeFileSync(output, lines.join('\n'));
console.log(`Wrote ${output} for ${version} with ${fileEntries.length} asset(s).`);
