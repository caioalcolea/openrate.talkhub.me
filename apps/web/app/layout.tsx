import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RegisterSW } from '../components/register-sw';

export const metadata: Metadata = {
  title: 'OpenRate',
  description: 'Transforme atendentes em creators — roteiros por IA, gravação guiada e comissão via Pix.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'OpenRate', statusBarStyle: 'default' },
  // padrão atual (o apple-mobile-web-app-capable está deprecado no Chrome)
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  themeColor: '#2e7d32',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
