import type { Metadata } from 'next'
import Image from 'next/image'
import { Navbar }  from '@/components/layout/Navbar'
import { Footer }  from '@/components/layout/Footer'
import { getAllPosts } from '@/lib/sanity/queries'
import type { Post } from '@/types/sanity'
import Link from 'next/link'
import { urlFor } from '@/lib/sanity/image'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Building in public from Zimbabwe. Articles on African AI, EdTech, and the Neriah Foundation.',
}

export const revalidate = 3600

export default async function BlogPage() {
  let posts: Post[] = []
  try { posts = await getAllPosts() } catch { /* Sanity not configured yet */ }

  return (
    <>
      <Navbar />
      <main id="main-content">
        <section className="bg-teal py-20 px-6" aria-labelledby="blog-page-title">
          <div className="section-inner">
            <ScrollReveal direction="up" duration={700}>
              <h1 className="font-display text-[40px] md:text-[56px] font-bold text-white leading-[1.1] tracking-tight mb-4" id="blog-page-title">
                Building in public.<br />From Zimbabwe.
              </h1>
            </ScrollReveal>
            <ScrollReveal direction="up" delay={120} duration={700}>
              <p className="text-teal-mid text-[17px] max-w-xl">
                Articles on African AI, EdTech, the Neriah Foundation, and what it is really like to
                build a startup from Harare.
              </p>
            </ScrollReveal>
          </div>
        </section>

        <section className="bg-off-white py-16 px-6">
          <div className="section-inner">
            {posts.length === 0 ? (
              <div className="text-center py-20">
                <p className="font-display text-[24px] text-dark mb-3">Articles coming soon</p>
                <p className="text-mid text-[15px]">
                  The blog launches with the site. Check back shortly, or{' '}
                  <Link href="/contact?subject=demo" className="text-teal hover:underline">subscribe to updates</Link>.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {posts.map((post, i) => (
                  <ScrollReveal key={post._id} direction="up" delay={i * 100} duration={700} scale>
                  <article className="bg-white border border-black/[0.08] rounded-[14px] overflow-hidden hover:-translate-y-1 transition-transform duration-200">
                    {post.mainImage ? (
                      <div className="relative h-40 w-full overflow-hidden">
                        <Image
                          src={urlFor(post.mainImage).width(600).height(320).format('webp').url()}
                          alt={post.title}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        />
                      </div>
                    ) : (
                      <div className="h-40 bg-teal-light" aria-hidden="true" />
                    )}
                    <div className="p-5">
                      {post.categories?.[0] && (
                        <p className="text-[10px] font-medium text-teal uppercase tracking-[0.5px] mb-2">
                          {post.categories[0].title}
                        </p>
                      )}
                      <h2 className="font-display text-[18px] font-bold text-dark leading-[1.35] mb-2">
                        <Link href={`/blog/${post.slug.current}`} className="hover:text-teal transition-colors">
                          {post.title}
                        </Link>
                      </h2>
                      {post.excerpt && <p className="text-[13px] text-mid leading-relaxed line-clamp-3">{post.excerpt}</p>}
                    </div>
                    <div className="px-5 py-3 border-t border-black/[0.06] flex justify-between text-[12px] text-mid">
                      <span>{post.author?.name || 'Neriah Africa'}</span>
                      {post.estimatedReadingTime && <span>{post.estimatedReadingTime} min read</span>}
                    </div>
                  </article>
                  </ScrollReveal>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
