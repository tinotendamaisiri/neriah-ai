import { defineField, defineType } from 'sanity'

export const author = defineType({
  name:  'author',
  title: 'Author',
  type:  'document',
  fields: [
    defineField({ name: 'name', title: 'Full name', type: 'string', validation: r => r.required() }),
    defineField({ name: 'role', title: 'Role', type: 'string' }),
    defineField({
      name:    'photo',
      title:   'Photo',
      type:    'image',
      options: { hotspot: true },
      fields:  [defineField({ name: 'alt', title: 'Alt text', type: 'string' })],
    }),
    defineField({ name: 'bio', title: 'Bio', type: 'text', rows: 4 }),
    defineField({ name: 'linkedIn', title: 'LinkedIn URL', type: 'url' }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'role', media: 'photo' },
  },
})
