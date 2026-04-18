import { sanityPublicClient } from './client'
// import { Author } from '@/types/sanity'

// ── Blog Posts ────────────────────────────────────────────

export async function getAllPosts(): Promise<Post[]> {
  return sanityPublicClient.fetch(
    `*[_type == "post" && status == "published"] | order(publishedAt desc) {
      _id,
      title,
      slug,
      author-> { name, photo, role },
      publishedAt,
      excerpt,
      mainImage,
      categories[]-> { title, slug },
      "estimatedReadingTime": round(length(pt::text(body)) / 5 / 180)
    }`
  )
}

export async function getLatestPosts(limit: number = 3): Promise<Post[]> {
  return sanityPublicClient.fetch(
    `*[_type == "post" && status == "published"] | order(publishedAt desc) [0...$limit] {
      _id,
      title,
      slug,
      author-> { name, photo, role },
      publishedAt,
      excerpt,
      mainImage,
      categories[]-> { title, slug }
    }`,
    { limit: limit - 1 }
  )
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  return sanityPublicClient.fetch(
    `*[_type == "post" && slug.current == $slug && status == "published"][0] {
      _id,
      title,
      slug,
      author-> { name, photo, bio, linkedIn, role },
      publishedAt,
      excerpt,
      mainImage,
      body,
      categories[]-> { title, slug },
      seoTitle,
      seoDescription,
      "estimatedReadingTime": round(length(pt::text(body)) / 5 / 180)
    }`,
    { slug }
  )
}

export async function getPostsByCategory(categorySlug: string): Promise<Post[]> {
  return sanityPublicClient.fetch(
    `*[_type == "post" && status == "published" && $categorySlug in categories[]->slug.current]
      | order(publishedAt desc) {
      _id,
      title,
      slug,
      author-> { name, photo, role },
      publishedAt,
      excerpt,
      mainImage,
      categories[]-> { title, slug }
    }`,
    { categorySlug }
  )
}

export async function getAllPostSlugs(): Promise<{ slug: string }[]> {
  return sanityPublicClient.fetch(
    `*[_type == "post" && status == "published"] { "slug": slug.current }`
  )
}

// ── Foundation Updates ────────────────────────────────────

export async function getFoundationUpdates(): Promise<FoundationUpdate[]> {
  return sanityPublicClient.fetch(
    `*[_type == "foundationUpdate"] | order(date desc) {
      _id,
      title,
      date,
      booksCollected,
      schoolsReached,
      studentsServed,
      description,
      photos
    }`
  )
}

export async function getLatestFoundationStats(): Promise<{
  booksCollected: number
  schoolsReached: number
  studentsServed: number
  pagesLabelled: number
}> {
  const updates: FoundationUpdate[] = await getFoundationUpdates()
  return {
    booksCollected: updates.reduce((sum, u) => sum + (u.booksCollected || 0), 0),
    schoolsReached: updates.reduce((max, u) => Math.max(max, u.schoolsReached || 0), 0),
    studentsServed: updates.reduce((sum, u) => sum + (u.studentsServed || 0), 0),
    pagesLabelled: 0, // Updated manually when dataset grows
  }
}
