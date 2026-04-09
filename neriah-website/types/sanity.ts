import type { PortableTextBlock } from '@portabletext/types'

export interface SanityImage {
  _type: 'image'
  asset: { _ref: string; _type: 'reference' }
  alt?: string
  hotspot?: { x: number; y: number; height: number; width: number }
}

export interface Author {
  _id:      string
  name:     string
  photo?:   SanityImage
  bio?:     string
  linkedIn?:string
  role?:    string
}

export interface Category {
  _id:          string
  title:        string
  slug:         { current: string }
  description?: string
}

export interface Post {
  _id:                   string
  title:                 string
  slug:                  { current: string }
  author?:               Author
  publishedAt?:          string
  status:                'draft' | 'published' | 'archived'
  excerpt?:              string
  mainImage?:            SanityImage
  body?:                 PortableTextBlock[]
  categories?:           Category[]
  seoTitle?:             string
  seoDescription?:       string
  estimatedReadingTime?: number
}

export interface FoundationUpdate {
  _id:             string
  title:           string
  date:            string
  booksCollected?: number
  schoolsReached?: number
  studentsServed?: number
  description?:    string
  photos?:         SanityImage[]
}
