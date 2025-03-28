/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self' https://api.openai.com; frame-ancestors 'self' https://plantz.io https://*.plantz.io; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.openai.com; media-src 'self' https:;"
          }
        ],
      },
    ]
  },
}

module.exports = nextConfig 