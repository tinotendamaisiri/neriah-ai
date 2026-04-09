import { defineField, defineType } from 'sanity'

export const foundationUpdate = defineType({
  name:  'foundationUpdate',
  title: 'Foundation Update',
  type:  'document',
  fields: [
    defineField({ name: 'title', title: 'Update title', type: 'string', validation: r => r.required() }),
    defineField({ name: 'date', title: 'Date', type: 'date', validation: r => r.required() }),
    defineField({ name: 'booksCollected', title: 'Books collected (this update)', type: 'number' }),
    defineField({ name: 'schoolsReached', title: 'Total schools reached (running total)', type: 'number' }),
    defineField({ name: 'studentsServed', title: 'Students served (this update)', type: 'number' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 4 }),
    defineField({
      name:  'photos',
      title: 'Photos from the field',
      type:  'array',
      of:    [{ type: 'image', options: { hotspot: true }, fields: [defineField({ name: 'alt', title: 'Alt text', type: 'string' })] }],
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'date' },
  },
  orderings: [{ title: 'Date, newest', name: 'dateDesc', by: [{ field: 'date', direction: 'desc' }] }],
})
