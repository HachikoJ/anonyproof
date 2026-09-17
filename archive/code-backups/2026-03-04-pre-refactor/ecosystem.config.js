module.exports = {
  apps: [
    {
      name: 'anonyproof-frontend',
      script: 'npm',
      args: 'run dev',
      cwd: '/root/.openclaw/workspace/anonyproof',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_development: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'anonyproof-backend',
      script: 'npm',
      args: 'run dev',
      cwd: '/root/.openclaw/workspace/anonyproof/server',
      env: {
        NODE_ENV: 'development',
        PORT: 4000
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env_development: {
        NODE_ENV: 'development'
      }
    }
  ]
}
