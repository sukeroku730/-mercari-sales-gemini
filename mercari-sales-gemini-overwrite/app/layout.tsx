import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'メルカリ売上管理',
  description: 'メルカリ売上を作品別に管理',
  manifest: '/manifest.json'
}
export const viewport: Viewport = { themeColor: '#ff5a5f', width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>
}
