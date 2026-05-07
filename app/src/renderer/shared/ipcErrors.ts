export function userFacingIpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/u, '')
    .trim();
}
