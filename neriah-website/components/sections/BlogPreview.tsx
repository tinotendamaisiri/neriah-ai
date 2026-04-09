import Link from 'next/link'
import Image from 'next/image'
import type { Post } from '@/types/sanity'
import { urlFor } from '@/lib/sanity/image'
import { ScrollReveal } from '@/components/ui/ScrollReveal'

// Placeholder posts shown when Sanity is not yet configured
const PLACEHOLDER_POSTS = [
  {
    title:   'Why I built Neriah: the problem I watched my whole childhood',
    excerpt: 'Teachers in Zimbabwe go home to 50 exercise books every evening. I grew up watching this. This is the story of why I decided to do something about it.',
    cat:     'Building in public',
    author:  'Tinotenda Maisiri',
    date:    'March 2026',
    bg:      'bg-teal-light',
  },
  {
    title:   "Zimbabwe's National AI Strategy 2026–2030: what it means for founders",
    excerpt: 'I read all 69 pages. Here are the 5 things that matter most for people building AI products in Zimbabwe right now.',
    cat:     'African AI',
    author:  'Tinotenda Maisiri',
    date:    'March 2026',
    bg:      'bg-off-white',
  },
  {
    title:   'How giving away exercise books builds a dataset no one can buy',
    excerpt: 'The Foundation is not charity. Every book collected is training data. Here is how we turned a social mission into a structural competitive moat.',
    cat:     'Neriah Foundation',
    author:  'Tinotenda Maisiri',
    date:    'March 2026',
    bg:      'bg-dark',
  },
]

interface Props {
  posts: Post[]
}

export function BlogPreview({ posts }: Props) {
  const usePlaceholders = posts.length === 0

  return (
    <section className="bg-white py-20 px-6" aria-labelledby="blog-title">
      <div className="section-inner">

        {/* Header */}
        <ScrollReveal direction="up">
          <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
            <div>
              <span className="section-tag bg-teal-light text-teal-dark">From the blog</span>
              <h2 className="display-lg text-dark" id="blog-title">
                Building in public.<br />From Zimbabwe.
              </h2>
            </div>
            <Link href="/blog" className="btn-teal">
              All articles →
            </Link>
          </div>
        </ScrollReveal>

        {/* Blog cards — staggered cascade, slight rotation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {usePlaceholders
            ? PLACEHOLDER_POSTS.map((p, i) => (
                <ScrollReveal key={i} direction="up" delay={i * 100} duration={700} distance={60} rotate={1}>
                  <article className="border border-black/[0.08] rounded-[14px] overflow-hidden hover:-translate-y-1 transition-transform duration-200 h-full flex flex-col">
                    <div className={`h-40 ${p.bg} flex items-center justify-center`} aria-hidden="true">
                      <div className="w-14 h-14 bg-teal/20 rounded-full" />
                    </div>
                    <div className="p-5 flex-1">
                      <p className="text-[10px] font-medium text-teal uppercase tracking-[0.5px] mb-2">{p.cat}</p>
                      <h3 className="font-display text-[17px] font-bold text-dark leading-[1.35] mb-2">{p.title}</h3>
                      <p className="text-[13px] text-mid leading-relaxed">{p.excerpt}</p>
                    </div>
                    <div className="px-5 py-3 border-t border-black/[0.06] flex justify-between text-[12px] text-mid">
                      <span>{p.author}</span>
                      <span>{p.date}</span>
                    </div>
                  </article>
                </ScrollReveal>
              ))
            : posts.map((post, i) => (
                <ScrollReveal key={post._id} direction="up" delay={i * 100} duration={700} distance={60} rotate={1}>
                  <article className="border border-black/[0.08] rounded-[14px] overflow-hidden hover:-translate-y-1 transition-transform duration-200 h-full flex flex-col">
                    {post.mainImage ? (
                      <div className="h-40 relative overflow-hidden">
                        <Image
                          src={urlFor(post.mainImage).width(600).height(320).format('webp').url()}
                          alt={post.mainImage.alt || post.title}
                          fill
                          className="object-cover"
                          sizes="(max-width: 768px) 100vw, 33vw"
                        />
                      </div>
                    ) : (
                      <div className="h-40 bg-teal-light flex items-center justify-center" aria-hidden="true">
                        <div className="w-14 h-14 bg-teal/20 rounded-full" />
                      </div>
                    )}
                    <div className="p-5 flex-1">
                      {post.categories?.[0] && (
                        <p className="text-[10px] font-medium text-teal uppercase tracking-[0.5px] mb-2">
                          {post.categories[0].title}
                        </p>
                      )}
                      <h3 className="font-display text-[17px] font-bold text-dark leading-[1.35] mb-2">
                        <Link href={`/blog/${post.slug.current}`} className="hover:text-teal transition-colors">
                          {post.title}
                        </Link>
                      </h3>
                      {post.excerpt && (
                        <p className="text-[13px] text-mid leading-relaxed line-clamp-3">{post.excerpt}</p>
                      )}
                    </div>
                    <div className="px-5 py-3 border-t border-black/[0.06] flex justify-between text-[12px] text-mid">
                      <span>{post.author?.name || 'Neriah Africa'}</span>
                      <span>
                        {post.publishedAt
                          ? new Date(post.publishedAt).toLocaleDateString('en-ZW', { month: 'long', year: 'numeric' })
                          : ''}
                      </span>
                    </div>
                  </article>
                </ScrollReveal>
              ))}
        </div>

      </div>
    </section>
  )
}
