#!/usr/bin/env ts-node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DB_SCHEMA_VERSION } from '../src/main/sessions/db-constants';
import { SessionDb } from '../src/main/sessions/SessionDb';

interface SessionSchemaManifest {
  database: 'sessions';
  version: number;
  schemaId: string;
  hashAlgorithm: 'sha256';
  canonicalSource: string;
}

const MANIFEST_PATH = path.join(__dirname, '../src/main/sessions/schema-manifest.json');

function readManifest(): SessionSchemaManifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as SessionSchemaManifest;
}

function computeManifest(): SessionSchemaManifest {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-schema-manifest-'));
  const dbPath = path.join(tempDir, 'sessions.db');
  const db = new SessionDb(dbPath);

  try {
    const identity = db.getSchemaIdentity();
    return {
      database: 'sessions',
      version: DB_SCHEMA_VERSION,
      schemaId: identity.id,
      hashAlgorithm: 'sha256',
      canonicalSource: 'sqlite_schema: type,name,tbl_name,sql excluding sqlite_% internals',
    };
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeManifest(manifest: SessionSchemaManifest): void {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function assertManifestMatches(expected: SessionSchemaManifest, actual: SessionSchemaManifest): void {
  const expectedJson = JSON.stringify(expected, null, 2);
  const actualJson = JSON.stringify(actual, null, 2);

  if (expectedJson === actualJson) {
    console.log(`Session schema manifest matches ${actual.schemaId}`);
    return;
  }

  console.error('Session schema manifest is stale.');
  console.error(`Tracked:  ${expected.schemaId}`);
  console.error(`Current:  ${actual.schemaId}`);
  console.error('Run `npm run db:schema:update` after intentional SessionDb schema changes.');
  process.exitCode = 1;
}

function main(): void {
  const mode = process.argv[2] ?? '--check';
  const current = computeManifest();

  if (mode === '--write') {
    writeManifest(current);
    console.log(`Updated SessionDb schema manifest to ${current.schemaId}`);
    return;
  }

  if (mode === '--print') {
    console.log(JSON.stringify(current, null, 2));
    return;
  }

  if (mode !== '--check') {
    console.error(`Unknown mode: ${mode}`);
    console.error('Usage: ts-node scripts/session-schema-manifest.ts [--check|--write|--print]');
    process.exitCode = 2;
    return;
  }

  assertManifestMatches(readManifest(), current);
}

main();
