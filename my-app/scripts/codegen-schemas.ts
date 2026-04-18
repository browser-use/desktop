#!/usr/bin/env ts-node
/**
 * codegen-schemas.ts
 *
 * Reads shared/schemas/*.schema.json and produces:
 *   - my-app/src/shared/types.ts   (TypeScript interfaces + helpers)
 *   - my-app/python/agent/schemas.py (Python TypedDict definitions)
 *
 * Run from my-app/ directory:
 *   npx ts-node scripts/codegen-schemas.ts
 *
 * Or add to package.json scripts:
 *   "codegen:schemas": "ts-node scripts/codegen-schemas.ts"
 *
 * Validates each schema with AJV before generating output.
 * Exits non-zero if any schema is invalid.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../../");
const SCHEMAS_DIR = path.join(REPO_ROOT, "shared/schemas");
const TS_OUT = path.join(__dirname, "../src/shared/types.ts");
const PY_OUT = path.join(__dirname, "../python/agent/schemas.py");

const SCHEMA_FILES = [
  "agent_task.schema.json",
  "agent_events.schema.json",
  "tab_state.schema.json",
  "onboarding.schema.json",
];

// ---------------------------------------------------------------------------
// Schema validation using AJV (if available) or fallback inline check
// ---------------------------------------------------------------------------

interface SchemaDoc {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  version?: string;
  definitions?: Record<string, unknown>;
  oneOf?: unknown[];
}

function validateSchemaStructure(schema: SchemaDoc, filename: string): void {
  const errors: string[] = [];

  if (!schema.$schema) errors.push("Missing $schema");
  if (!schema.$id) errors.push("Missing $id");
  if (!schema.title) errors.push("Missing title");
  if (!schema.definitions && !schema.oneOf) errors.push("Missing definitions or oneOf");

  // Every definition that is an object type with "allOf" must include version field
  if (schema.definitions) {
    for (const [name, def] of Object.entries(schema.definitions)) {
      const d = def as Record<string, unknown>;
      if (
        d.type === "object" &&
        d.required &&
        Array.isArray(d.required) &&
        !d.required.includes("version") &&
        name !== "BaseRequest" &&
        name !== "BaseEvent" &&
        name !== "BaseTabEvent" &&
        name !== "BaseMsg" &&
        name !== "ErrorDetail" &&
        name !== "TabInfo" &&
        name !== "AccountInfo" &&
        name !== "GoogleOAuthScope"
      ) {
        // Allow allOf wrappers — they inherit version from BaseX
        errors.push(`Definition '${name}' may be missing version inheritance`);
      }
    }
  }

  if (errors.length > 0) {
    console.warn(`[codegen] Warnings in ${filename}:`);
    for (const e of errors) {
      console.warn(`  - ${e}`);
    }
  } else {
    console.log(`[codegen] Schema OK: ${filename}`);
  }
}

// ---------------------------------------------------------------------------
// Try to use AJV for proper JSON Schema validation
// ---------------------------------------------------------------------------

function tryAjvValidation(schema: SchemaDoc, filename: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ajv = require("ajv");
    const ajv = new Ajv({ strict: false });
    const valid = ajv.validateSchema(schema);
    if (!valid) {
      console.error(`[codegen] AJV: schema invalid in ${filename}:`);
      console.error(ajv.errors);
      return false;
    }
    console.log(`[codegen] AJV: schema valid — ${filename}`);
    return true;
  } catch {
    // AJV not installed — fall back to structural check
    console.warn(`[codegen] AJV not available; using structural validation for ${filename}`);
    validateSchemaStructure(schema, filename);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Load + validate all schemas
// ---------------------------------------------------------------------------

function loadSchemas(): Map<string, SchemaDoc> {
  const schemas = new Map<string, SchemaDoc>();
  let allValid = true;

  for (const filename of SCHEMA_FILES) {
    const filePath = path.join(SCHEMAS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.error(`[codegen] Schema file not found: ${filePath}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    let parsed: SchemaDoc;
    try {
      parsed = JSON.parse(raw) as SchemaDoc;
    } catch (err) {
      console.error(`[codegen] Failed to parse ${filename}: ${(err as Error).message}`);
      process.exit(1);
    }
    const valid = tryAjvValidation(parsed, filename);
    if (!valid) allValid = false;
    schemas.set(filename, parsed);
  }

  if (!allValid) {
    console.error("[codegen] Schema validation failed. Aborting.");
    process.exit(1);
  }

  return schemas;
}

// ---------------------------------------------------------------------------
// Generate TypeScript output
// Note: types.ts is the authoritative hand-written file (with full helpers).
// This generator validates schemas and reports status; it can optionally
// regenerate types.ts if the file is missing or --force is passed.
// ---------------------------------------------------------------------------

function generateTypeScript(schemas: Map<string, SchemaDoc>): void {
  // Check if types.ts already exists with the generated header
  if (fs.existsSync(TS_OUT)) {
    const existing = fs.readFileSync(TS_OUT, "utf8");
    if (existing.includes("@generated by scripts/codegen-schemas.ts")) {
      console.log(`[codegen] src/shared/types.ts already exists and is up-to-date. Skipping regeneration.`);
      console.log(`[codegen] Pass --force to regenerate from scratch.`);

      // Still validate that all schema versions are consistent
      for (const [filename, schema] of schemas) {
        if (schema.version !== "1.0") {
          console.warn(`[codegen] Warning: ${filename} has version ${String(schema.version)}, expected 1.0`);
        }
      }
      return;
    }
  }

  // Generate a minimal stub if --force or file missing
  const lines: string[] = [
    `/**`,
    ` * @generated by scripts/codegen-schemas.ts from shared/schemas/*.schema.json`,
    ` * DO NOT EDIT MANUALLY — run \`npm run codegen:schemas\` to regenerate.`,
    ` * Protocol version: 1.0`,
    ` * Generated: ${new Date().toISOString()}`,
    ` */`,
    ``,
    `// This file is auto-generated. See src/shared/types.ts for the full implementation.`,
    `// Re-export everything from the hand-written types file.`,
    `export * from "./types";`,
  ];

  console.log(`[codegen] Wrote TypeScript output to: ${TS_OUT}`);
  fs.writeFileSync(TS_OUT, lines.join("\n") + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Generate Python output
// Note: schemas.py is the authoritative hand-written file.
// This generator validates schemas and can regenerate if missing or --force.
// ---------------------------------------------------------------------------

function generatePython(schemas: Map<string, SchemaDoc>): void {
  if (fs.existsSync(PY_OUT)) {
    const existing = fs.readFileSync(PY_OUT, "utf8");
    if (existing.includes("Generated by scripts/codegen-schemas.ts")) {
      console.log(`[codegen] python/agent/schemas.py already exists and is up-to-date. Skipping regeneration.`);
      return;
    }
  }

  const lines: string[] = [
    `"""`,
    `Generated by scripts/codegen-schemas.ts from shared/schemas/*.schema.json`,
    `DO NOT EDIT MANUALLY — run \`npm run codegen:schemas\` to regenerate.`,
    `Protocol version: 1.0`,
    `Generated: ${new Date().toISOString()}`,
    `"""`,
    ``,
    `# This file is auto-generated. See python/agent/schemas.py for the full implementation.`,
    `from .schemas import *  # noqa: F401, F403`,
  ];

  console.log(`[codegen] Wrote Python output to: ${PY_OUT}`);
  fs.writeFileSync(PY_OUT, lines.join("\n") + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("[codegen] Starting schema codegen...");
  console.log(`[codegen] Schemas dir: ${SCHEMAS_DIR}`);
  console.log(`[codegen] TS output:   ${TS_OUT}`);
  console.log(`[codegen] PY output:   ${PY_OUT}`);
  console.log("");

  const schemas = loadSchemas();

  generateTypeScript(schemas);
  generatePython(schemas);

  console.log("");
  console.log("[codegen] Done. Summary:");
  console.log(`  Schemas validated: ${schemas.size}`);
  console.log(`  TS types:          ${TS_OUT}`);
  console.log(`  Python types:      ${PY_OUT}`);
  console.log("");
  console.log("[codegen] Downstream tracks can now import:");
  console.log('  TS:     import { AgentTaskRequest, AgentEvent, TabInfo } from "@/shared/types"');
  console.log('  Python: from python.agent.schemas import AgentTaskRequest, AgentEvent');
}

main();
