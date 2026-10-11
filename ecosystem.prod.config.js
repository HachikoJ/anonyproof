const path = require('path')

const projectRoot = __dirname
const role = process.env.INSTANCE_ROLE
if (!['demo', 'formal'].includes(role)) throw new Error('Set INSTANCE_ROLE=demo or formal before PM2 start')
function port(name, fallback) {
  const value = process.env[name] || String(fallback)
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${name} must be a valid TCP port`)
  return Number(value)
}
const frontendPort = port('FRONTEND_PORT', role === 'demo' ? 3000 : 3100)
const backendPort = port('BACKEND_PORT', role === 'demo' ? 4000 : 4100)
if (frontendPort === backendPort) throw new Error('Frontend and backend require separate ports')

module.exports = {
  apps: [
    {
      name: `anonyproof-${role}-frontend`,
      script: 'npm',
      args: 'run start',
      cwd: projectRoot,
      env: {
        NODE_ENV: 'production',
        INSTANCE_ROLE: role,
        PORT: frontendPort,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: `anonyproof-${role}-backend`,
      script: 'npm',
      args: 'run start',
      cwd: path.join(projectRoot, 'server'),
      env: {
        NODE_ENV: 'production',
        INSTANCE_ROLE: role,
        PORT: backendPort,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
