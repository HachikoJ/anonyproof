import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '匿证 - 匿名反馈平台',
  description: '完全匿名·端到端加密·防偷看机制',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
