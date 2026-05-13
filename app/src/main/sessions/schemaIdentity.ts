import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export const SESSION_SCHEMA_CANONICAL_QUERY = `
  SELECT type, name, tbl_name, sql
  FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%'
    AND type IN ('table', 'index', 'view', 'trigger')
  ORDER BY type, name, tbl_name
`.trim();

export interface SessionSchemaObject {
  type: string;
  name: string;
  tblName: string;
  sql: string | null;
}

export interface SessionSchemaIdentity {
  version: number;
  hash: string;
  id: string;
  objects: SessionSchemaObject[];
}

interface SchemaRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

export function readSessionSchemaObjects(db: Database.Database): SessionSchemaObject[] {
  const rows = db.prepare(SESSION_SCHEMA_CANONICAL_QUERY).all() as SchemaRow[];
  return rows.map((row) => ({
    type: row.type,
    name: row.name,
    tblName: row.tbl_name,
    sql: row.sql,
  }));
}

export function hashSessionSchemaObjects(objects: SessionSchemaObject[]): string {
  return createHash('sha256')
    .update(JSON.stringify(objects))
    .digest('hex');
}

export function sessionSchemaId(version: number, hash: string): string {
  return `sessions:v${version}:sha256-${hash}`;
}

export function computeSessionSchemaIdentity(
  db: Database.Database,
  version: number,
): SessionSchemaIdentity {
  const objects = readSessionSchemaObjects(db);
  const hash = hashSessionSchemaObjects(objects);
  return {
    version,
    hash,
    id: sessionSchemaId(version, hash),
    objects,
  };
}
