import imageUrlBuilder from '@sanity/image-url'
import { sanityPublicClient } from './client'
import type { SanityImageSource } from '@sanity/image-url/lib/types/types'

const builder = imageUrlBuilder(sanityPublicClient)

/**
 * Generate an optimised image URL from a Sanity image reference.
 * Always use this — never download and re-host Sanity images.
 *
 * @example
 * urlFor(post.mainImage).width(800).format('webp').url()
 */
export function urlFor(source: SanityImageSource) {
  return builder.image(source)
}
