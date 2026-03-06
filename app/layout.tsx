import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '匿证 - 匿名反馈平台',
  description: '完全匿名·端到端加密·防偷看机制',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximumScale=1, user-scalable=no" />
      </head>
      <body>{children}</body>
    </html>
  )
}
