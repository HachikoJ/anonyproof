// Read-only startup checks; never install dependencies or rewrite environment files.
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error('AnonyProof requires Node.js 20 or higher.')
  process.exit(1)
}
for (const cwd of [root, path.join(root, 'server')]) {
  const result = spawnSync('npm', ['ls', '--depth=0'], { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(`Dependency tree is inconsistent in ${path.relative(root, cwd) || '.'}. Run npm ci with the intended Node version.`)
    process.exit(1)
  }
  try {
    const requireFromProject = createRequire(path.join(cwd, 'package.json'))
    const Database = requireFromProject('better-sqlite3')
    const db = new Database(':memory:')
    db.prepare('SELECT 1').get()
    db.close()
  } catch {
    console.error(`SQLite native module cannot load in ${path.relative(root, cwd) || '.'} under Node ${process.versions.node}. Reinstall using that runtime.`)
    process.exit(1)
  }
}
console.log(`Runtime and dependency trees verified (Node ${process.versions.node}).`)
