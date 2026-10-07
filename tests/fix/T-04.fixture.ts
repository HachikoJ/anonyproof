import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startBackend } from './helpers'

export async function cipherFaultFixture(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anonyproof-T04-cipher-'))
  const control = path.join(dir, 'cipher-fault.control')
  const preload = path.join(dir, 'cipher-fault.cjs')
  writeFileSync(control, '')
  // Only this fixture child uses the preload. No production fault header,
  // endpoint, configuration knob or error containing body/key material.
  writeFileSync(preload, `
    const fs = require('node:fs'); const crypto = require('node:crypto');
    const control = ${JSON.stringify(control)};
    const create = crypto.createCipheriv;
    crypto.createCipheriv = function(...args) {
      const cipher = Reflect.apply(create, this, args); const update = cipher.update;
      cipher.update = function(data, ...rest) {
        const fault = fs.readFileSync(control, 'utf8');
        if (fault && (fault === '*' || (typeof data === 'string' && data.includes(fault)))) {
          throw new Error('T04_FIXTURE_ENCRYPTION_FAILURE');
        }
        return Reflect.apply(update, this, [data, ...rest]);
      };
      return cipher;
    };
    require('node:module').syncBuiltinESMExports();
  `)
  const service = await startBackend({ ...overrides, NODE_OPTIONS: `--require=${preload}` })
  return { service, control, fault: (value: string) => writeFileSync(control, value) }
}

