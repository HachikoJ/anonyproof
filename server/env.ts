import path from 'path'
import process from 'process'

const envPath = path.resolve(__dirname, '..', '.env.local')

try {
  process.loadEnvFile(envPath)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
