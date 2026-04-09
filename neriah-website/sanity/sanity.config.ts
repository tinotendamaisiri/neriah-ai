import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { post } from './schemas/post'
import { author } from './schemas/author'
import { category } from './schemas/category'
import { foundationUpdate } from './schemas/foundationUpdate'

export default defineConfig({
  name:    'neriah-africa',
  title:   'Neriah Africa CMS',
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'unconfigured',
  dataset:   process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  plugins: [
    structureTool(),
    visionTool(), // GROQ query playground — remove in production if desired
  ],
  schema: {
    types: [post, author, category, foundationUpdate],
  },
})
