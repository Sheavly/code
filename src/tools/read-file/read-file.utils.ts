import path from 'node:path';

/** True for `.env`, `.env.local`, `.env.production`, ... (case-insensitive). */
export function isEnvFile(filePath: string): boolean {
  return /^\.env(\..*)?$/i.test(path.basename(filePath));
}

/** Throws if `filePath` is a .env file; `requested` is what the model asked for, for the error. */
export function assertNotEnvFile(params: { filePath: string; requested: string }): void {
  const { filePath, requested } = params;

  if (isEnvFile(filePath)) {
    throw new Error(`Reading .env files is not allowed (${requested}). They contain secrets.`);
  }
}
