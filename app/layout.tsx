import type { Metadata, Viewport } from 'next'
import './globals.css'
import './admin.css'

export const metadata: Metadata = {
  title: '匿证 - 线索提交与跟进',
  description: '无需实名提交 · 处理进度可查 · 沟通记录留存',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
