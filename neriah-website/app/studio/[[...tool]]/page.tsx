'use client'
/**
 * Sanity Studio deployed at /studio
 * Protected by middleware.ts — only allowed emails can access
 */
import { NextStudio } from 'next-sanity/studio'
import config from '@/sanity/sanity.config'

export default function StudioPage() {
  return <NextStudio config={config} />
}
