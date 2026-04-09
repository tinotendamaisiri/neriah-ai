import { defineField, defineType } from 'sanity'

export const post = defineType({
  name:  'post',
  title: 'Blog Post',
  type:  'document',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: r => r.required() }),
    defineField({
      name:    'slug',
      title:   'Slug',
      type:    'slug',
      options: { source: 'title', maxLength: 96 },
      validation: r => r.required(),
    }),
    defineField({
      name:  'status',
      title: 'Status',
      type:  'string',
      options: { list: ['draft', 'published', 'archived'], layout: 'radio' },
      initialValue: 'draft',
    }),
    defineField({ name: 'author', title: 'Author', type: 'reference', to: [{ type: 'author' }] }),
    defineField({ name: 'publishedAt', title: 'Published at', type: 'datetime' }),
    defineField({
      name:  'categories',
      title: 'Categories',
      type:  'array',
      of:    [{ type: 'reference', to: [{ type: 'category' }] }],
    }),
    defineField({
      name:      'mainImage',
      title:     'Main image',
      type:      'image',
      options:   { hotspot: true },
      fields:    [defineField({ name: 'alt', title: 'Alt text', type: 'string', validation: r => r.required() })],
    }),
    defineField({ name: 'excerpt', title: 'Excerpt (used as meta description)', type: 'text', rows: 3 }),
    defineField({ name: 'body', title: 'Body', type: 'array', of: [{ type: 'block' }, { type: 'image', options: { hotspot: true } }] }),
    defineField({ name: 'seoTitle', title: 'SEO title override', type: 'string' }),
    defineField({ name: 'seoDescription', title: 'SEO description override', type: 'text', rows: 2 }),
  ],
  preview: {
    select: { title: 'title', author: 'author.name', media: 'mainImage', status: 'status' },
    prepare({ title, author, media, status }) {
      return { title, subtitle: `${status} · ${author || 'No author'}`, media }
    },
  },
  orderings: [{ title: 'Published date, newest', name: 'publishedAtDesc', by: [{ field: 'publishedAt', direction: 'desc' }] }],
})
