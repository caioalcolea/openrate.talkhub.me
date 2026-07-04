/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@openrate/shared'],
  eslint: { ignoreDuringBuilds: true },
};

module.exports = nextConfig;
