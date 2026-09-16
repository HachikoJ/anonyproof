/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  // Next.js 16 blocks dev assets for hostnames that are not explicitly allowed.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  basePath: '/anonyproof',
  assetPrefix: '/anonyproof',
  async rewrites() {
    const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000'
    return [{
      source: '/api/:path*',
      destination: `${apiTarget}/api/:path*`,
    }]
  },
}

module.exports = nextConfig
