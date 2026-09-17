/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath: '/anonyproof',  // 重新启用 - 让Next.js知道自己在 /anonyproof 路径下
  assetPrefix: '/anonyproof',  // 重新启用 - 静态资源也使用这个前缀
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
}

module.exports = nextConfig
