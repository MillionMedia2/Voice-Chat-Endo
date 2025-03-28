/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOW-FROM https://plantz.io'
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://plantz.io"
          }
        ],
      },
    ]
  },
}

module.exports = nextConfig 