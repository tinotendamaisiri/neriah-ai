import { PortableText as SanityPortableText } from '@portabletext/react'
import Image from 'next/image'
import type { PortableTextBlock } from '@portabletext/types'
import { urlFor } from '@/lib/sanity/image'

const components = {
  types: {
    image: ({ value }: { value: { asset: unknown; alt?: string; caption?: string } }) => (
      <figure className="my-8">
        <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden">
          <Image
            src={urlFor(value).width(1200).format('webp').url()}
            alt={value.alt || ''}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 700px"
          />
        </div>
        {value.caption && (
          <figcaption className="text-center text-sm text-mid mt-3">{value.caption}</figcaption>
        )}
      </figure>
    ),
  },
  block: {
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="font-display text-[28px] font-bold text-dark mt-12 mb-4 leading-tight tracking-tight">
        {children}
      </h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="font-display text-[22px] font-bold text-dark mt-10 mb-3 leading-tight">
        {children}
      </h3>
    ),
    normal: ({ children }: { children?: React.ReactNode }) => (
      <p className="text-[17px] text-dark leading-[1.75] mb-6">{children}</p>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-4 border-teal pl-6 my-8 font-display text-[20px] italic text-dark/80 leading-relaxed">
        {children}
      </blockquote>
    ),
  },
  marks: {
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-medium text-dark">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic">{children}</em>
    ),
    link: ({ value, children }: { value?: { href: string }; children?: React.ReactNode }) => (
      <a
        href={value?.href}
        target={value?.href?.startsWith('http') ? '_blank' : undefined}
        rel={value?.href?.startsWith('http') ? 'noopener noreferrer' : undefined}
        className="text-teal underline decoration-teal/40 hover:decoration-teal transition-colors"
      >
        {children}
      </a>
    ),
  },
  list: {
    bullet: ({ children }: { children?: React.ReactNode }) => (
      <ul className="my-6 pl-6 space-y-2 list-disc marker:text-teal">{children}</ul>
    ),
    number: ({ children }: { children?: React.ReactNode }) => (
      <ol className="my-6 pl-6 space-y-2 list-decimal marker:text-teal">{children}</ol>
    ),
  },
  listItem: {
    bullet: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-[17px] text-dark leading-[1.75]">{children}</li>
    ),
    number: ({ children }: { children?: React.ReactNode }) => (
      <li className="text-[17px] text-dark leading-[1.75]">{children}</li>
    ),
  },
}

export function PortableText({ value }: { value: PortableTextBlock[] }) {
  return <SanityPortableText value={value} components={components} />
}
