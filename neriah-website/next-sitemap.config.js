/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://neriah.ai',
  generateRobotsTxt: true,
  exclude: ['/studio', '/studio/*', '/api/*', '/admin/*', '/icon.png'],
  robotsTxtOptions: {
    policies: [
      { userAgent: '*', allow: '/' },
      { userAgent: '*', disallow: ['/api/', '/studio/', '/admin/'] },
    ],
    additionalSitemaps: [
      `${process.env.NEXT_PUBLIC_SITE_URL || 'https://neriah.ai'}/sitemap.xml`,
    ],
  },

  additionalPaths: async () => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://neriah.ai'
    const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
    const dataset   = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

    if (!projectId) return []

    try {
      const query = encodeURIComponent(
        `*[_type == "post" && status == "published"]{"slug": slug.current}`
      )
      const url = `https://${projectId}.api.sanity.io/v2024-03-01/data/query/${dataset}?query=${query}`
      const res  = await fetch(url)
      if (!res.ok) return []

      const { result } = await res.json()
      return (result || []).map(({ slug }) => ({
        loc:        `${siteUrl}/blog/${slug}`,
        changefreq: 'weekly',
        priority:   0.8,
        lastmod:    new Date().toISOString(),
      }))
    } catch {
      return []
    }
  },
}
