import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ALLOWED_BINS = new Set([
  '/usr/bin/docker',
  '/usr/sbin/nginx',
  '/usr/bin/ss',
  '/usr/bin/sudo'
]);

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export async function run(bin, args, { timeout = 30000 } = {}) {
  if (!ALLOWED_BINS.has(bin)) {
    throw new Error(`Binary not allowed: ${bin}`);
  }
  for (const a of args) {
    if (typeof a !== 'string') throw new Error('All args must be strings');
  }
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout,
      maxBuffer: 8 * 1024 * 1024
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    // execFile throws on non-zero exit; surface stdout/stderr + code rather than swallow
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
      code: typeof err.code === 'number' ? err.code : 1,
      error: err
    };
  }
}

export function validateName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

// Validate a compose project name — same regex as container names
export function validateProjectName(name) {
  return validateName(name);
}
