import { z } from 'zod'

export const ContactSchema = z.object({
  first_name:      z.string().min(2, 'First name must be at least 2 characters').max(50),
  last_name:       z.string().min(2, 'Last name must be at least 2 characters').max(50),
  whatsapp_number: z.string().min(6, 'WhatsApp number required').max(30),
  email:           z.string().email('Please enter a valid email address'),
  school_name:     z.string().min(2, 'School name required').max(200),
  city:            z.string().min(2, 'City required').max(100),
  role:            z.enum(['Teacher', 'Head of Department', 'Principal/Headmaster', 'Other'], {
    errorMap: () => ({ message: 'Please select your role' }),
  }),
  subject:         z.enum(['Demo', 'Sales', 'Support', 'Billing']).default('Demo'),
  message:         z.string().max(2000).optional(),
  consent:         z.literal(true, { errorMap: () => ({ message: 'You must agree to the Privacy Policy' }) }),
  // Honeypot — must be empty
  website:         z.string().max(0, 'Bot detected'),
})

export const NewsletterSchema = z.object({
  email:   z.string().email('Please enter a valid email address'),
  consent: z.literal('on', { errorMap: () => ({ message: 'You must agree to receive emails' }) }),
  website: z.string().max(0, 'Bot detected'),
})

export type ContactInput    = z.infer<typeof ContactSchema>
export type NewsletterInput = z.infer<typeof NewsletterSchema>
