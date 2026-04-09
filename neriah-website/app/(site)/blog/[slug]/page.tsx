import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { getPostBySlug, getAllPostSlugs } from '@/lib/sanity/queries'
import { PortableText } from '@/components/blog/PortableText'
import { urlFor } from '@/lib/sanity/image'
import { ScrollReveal } from '@/components/ui/ScrollReveal'
import { BlogPostJsonLd, BreadcrumbJsonLd } from '@/components/seo/JsonLd'

export const revalidate = 3600
export const dynamicParams = true
export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  try {
    const slugs = await getAllPostSlugs()
    return slugs.map(s => ({ slug: s.slug }))
  } catch (err) {
    console.error('[generateStaticParams] Failed to fetch blog slugs from Sanity:', err)
    return []
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  try {
    const post = await getPostBySlug(slug)
    if (!post) return { title: 'Post not found' }
    return {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt,
    }
  } catch {
    return { title: 'Blog' }
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let post = null
  try {
    post = await getPostBySlug(slug)
    console.log(`[blog/${slug}] query result:`, post ? 'found' : 'null')
  } catch (err) {
    console.error(`[blog/${slug}] getPostBySlug threw:`, err)
  }
  if (!post) notFound()

  const imageUrl = post.mainImage
    ? urlFor(post.mainImage).width(1200).format('webp').url()
    : undefined

  return (
    <>
      <BlogPostJsonLd
        title={post.title}
        description={post.seoDescription || post.excerpt}
        slug={slug}
        publishedAt={post.publishedAt}
        authorName={post.author?.name}
        imageUrl={imageUrl}
      />
      <BreadcrumbJsonLd items={[
        { name: 'Home', url: 'https://neriah.ai' },
        { name: 'Blog', url: 'https://neriah.ai/blog' },
        { name: post.title, url: `https://neriah.ai/blog/${slug}` },
      ]} />
      <Navbar />
      <main id="main-content">
        <article className="max-w-2xl mx-auto px-6 py-16">
          <ScrollReveal direction="up" duration={700}>
            {post.categories?.[0] && (
              <p className="text-[11px] font-medium text-teal uppercase tracking-[0.5px] mb-4">
                {post.categories[0].title}
              </p>
            )}
            <h1 className="font-display text-[36px] md:text-[44px] font-bold text-dark leading-[1.15] tracking-tight mb-6">
              {post.title}
            </h1>
            <div className="flex items-center gap-3 text-[13px] text-mid mb-12 border-b border-black/[0.06] pb-6">
              <span>{post.author?.name || 'Neriah Africa'}</span>
              <span>·</span>
              {post.publishedAt && (
                <span>{new Date(post.publishedAt).toLocaleDateString('en-ZW', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              )}
              {post.estimatedReadingTime && (
                <><span>·</span><span>{post.estimatedReadingTime} min read</span></>
              )}
            </div>
          </ScrollReveal>
          {post.mainImage && (
            <ScrollReveal direction="up" delay={150} duration={800}>
              <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden mb-12">
                <Image
                  src={urlFor(post.mainImage).width(1200).format('webp').url()}
                  alt={post.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 700px"
                  priority
                />
              </div>
            </ScrollReveal>
          )}
          <ScrollReveal direction="up" delay={200} duration={800}>
            {post.body ? (
              <PortableText value={post.body} />
            ) : (
              post.excerpt && <p className="text-[17px] text-dark leading-relaxed">{post.excerpt}</p>
            )}
          </ScrollReveal>
        </article>
      </main>
      <Footer />
    </>
  )
}
