import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Big Board',
  description: 'Betting relationships grid',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
