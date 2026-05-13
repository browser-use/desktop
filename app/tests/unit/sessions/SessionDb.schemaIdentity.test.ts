import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_SCHEMA_VERSION } from '../../../src/main/sessions/db-constants';
import { SessionDb } from '../../../src/main/sessions/SessionDb';
import {
  SESSION_SCHEMA_CANONICAL_QUERY,
  computeSessionSchemaIdentity,
} from '../../../src/main/sessions/schemaIdentity';
import SESSION_DB_SCHEMA_MANIFEST from '../../../src/main/sessions/schema-manifest.json';

let tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-db-schema-'));
  tempDirs.push(dir);
  return path.join(dir, 'sessions.db');
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('SessionDb schema identity', () => {
  it('matches the tracked schema manifest after migrations', () => {
    const db = new SessionDb(tempDbPath());
    try {
      const identity = db.getSchemaIdentity();

      expect(SESSION_DB_SCHEMA_MANIFEST.version).toBe(DB_SCHEMA_VERSION);
      expect(identity.version).toBe(DB_SCHEMA_VERSION);
      expect(identity.id).toBe(SESSION_DB_SCHEMA_MANIFEST.schemaId);
    } finally {
      db.close();
    }
  });

  it('changes when schema shape changes without a version bump', () => {
    const dbPath = tempDbPath();
    const db = new SessionDb(dbPath);
    let originalId: string;
    try {
      originalId = db.getSchemaIdentity().id;
    } finally {
      db.close();
    }

    const raw = new Database(dbPath);
    try {
      raw.exec('CREATE TABLE unexpected_schema_drift (id TEXT PRIMARY KEY)');
      const changed = computeSessionSchemaIdentity(raw, DB_SCHEMA_VERSION);

      expect(changed.id).not.toBe(originalId);
      expect(changed.id).not.toBe(SESSION_DB_SCHEMA_MANIFEST.schemaId);
    } finally {
      raw.close();
    }
  });

  it('preserves whitespace inside quoted SQL literals when hashing schema SQL', () => {
    const left = new Database(tempDbPath());
    const right = new Database(tempDbPath());
    try {
      left.exec("CREATE TABLE literal_defaults (value TEXT DEFAULT 'a  b')");
      right.exec("CREATE TABLE literal_defaults (value TEXT DEFAULT 'a b')");

      const leftIdentity = computeSessionSchemaIdentity(left, DB_SCHEMA_VERSION);
      const rightIdentity = computeSessionSchemaIdentity(right, DB_SCHEMA_VERSION);

      expect(leftIdentity.objects[0].sql).toContain("'a  b'");
      expect(rightIdentity.objects[0].sql).toContain("'a b'");
      expect(leftIdentity.id).not.toBe(rightIdentity.id);
    } finally {
      left.close();
      right.close();
    }
  });

  it('documents the canonical SQLite schema source used for the hash', () => {
    expect(SESSION_SCHEMA_CANONICAL_QUERY).toContain('sqlite_schema');
    expect(SESSION_SCHEMA_CANONICAL_QUERY).toContain("name NOT LIKE 'sqlite_%'");
  });
});
