import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY)

export const FROM   = process.env.RESEND_FROM || 'Neriah Africa <no-reply@send.neriah.ai>'
export const NOTIFY = (process.env.RESEND_NOTIFY_EMAIL || 'support@neriah.ai,admin@neriah.ai').split(',')

export async function sendContactNotification(data: {
  first_name:      string
  last_name:       string
  whatsapp_number: string
  email:           string
  school_name:     string
  city:            string
  role:            string
  subject:         string
  message:         string
}) {
  const fullName       = `${data.first_name} ${data.last_name}`
  const isHighPriority = data.role === 'Principal/Headmaster'
  const subjectLine    = `${isHighPriority ? '🔴 HIGH PRIORITY — ' : ''}New ${data.subject} request — ${data.school_name} (${data.role})`

  const waNumber = data.whatsapp_number.replace(/\D/g, '')
  const waLink   = `https://wa.me/${waNumber}`

  return resend.emails.send({
    from:     FROM,
    to:       NOTIFY,
    reply_to: data.email,
    subject:  subjectLine,
    html: `
      <h2>New ${data.subject} request from neriah.ai</h2>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500">Name</td><td>${fullName}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500">School</td><td>${data.school_name}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500">City</td><td>${data.city}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500">Role</td><td>${data.role}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500">Subject</td><td>${data.subject}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500">WhatsApp</td><td><a href="${waLink}">${data.whatsapp_number}</a></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500">Email</td><td><a href="mailto:${data.email}">${data.email}</a></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666;font-weight:500;vertical-align:top">Message</td><td>${data.message || '—'}</td></tr>
      </table>
      <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
      <p style="font-size:12px;color:#999">Sent from neriah.ai contact form</p>
    `,
  })
}

const FOOTER = `
  <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
  <p style="font-family:sans-serif;font-size:12px;color:#999">Neriah Africa (Private) Limited · Harare, Zimbabwe · <a href="https://neriah.ai" style="color:#999">neriah.ai</a></p>
`

const SIGN_OFF = `<p style="font-family:sans-serif;font-size:15px;margin-top:24px">— The Neriah Africa team</p>`

const LINK = (href: string, label: string) =>
  `<a href="${href}" style="color:#0D7377">${label}</a>`

const CONFIRMATION_CONTENT: Record<string, { subjectLine: string; body: string }> = {
  Demo: {
    subjectLine: 'We received your demo request — Neriah Africa',
    body: `
      <p>Thanks for reaching out. Our team will be in touch within 24 hours to arrange a school visit and demo.</p>
      <p>In the meantime, you can read more about how Neriah works at ${LINK('https://neriah.ai/product', 'neriah.ai/product')}.</p>
    `,
  },
  Sales: {
    subjectLine: 'We received your enquiry — Neriah Africa',
    body: `
      <p>Thanks for reaching out. Our sales team will be in touch within 24 hours to help you understand our product and find the right plan for your school.</p>
      <p>In the meantime, you can read more about how Neriah works at ${LINK('https://neriah.ai/product', 'neriah.ai/product')}.</p>
    `,
  },
  Support: {
    subjectLine: 'We received your support request — Neriah Africa',
    body: `
      <p>Thanks for reaching out. Our support team will get back to you within 2 hours to help resolve your issue.</p>
      <p>If your issue is urgent, you can WhatsApp us directly at ${LINK('mailto:ops@neriah.ai', 'ops@neriah.ai')}.</p>
    `,
  },
  Billing: {
    subjectLine: 'We received your billing enquiry — Neriah Africa',
    body: `
      <p>Thanks for reaching out. Our team will be in touch within 24 hours to help you with your billing enquiry.</p>
      <p>In the meantime, you can review our pricing plans at ${LINK('https://neriah.ai/pricing', 'neriah.ai/pricing')}.</p>
    `,
  },
}

export async function sendContactConfirmation(to: string, name: string, subject: string) {
  const content = CONFIRMATION_CONTENT[subject] ?? CONFIRMATION_CONTENT.Demo

  return resend.emails.send({
    from:    FROM,
    to,
    subject: content.subjectLine,
    html: `
      <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#2C2C2A;max-width:560px">
        <p>Hi ${name},</p>
        ${content.body}
        ${SIGN_OFF}
        ${FOOTER}
      </div>
    `,
  })
}

export async function sendNewsletterConfirmation(to: string) {
  return resend.emails.send({
    from:    FROM,
    to,
    subject: 'You\'re subscribed to Neriah Africa updates',
    html: `
      <p>You\'re on the list. We\'ll send you updates when new articles are published and when Neriah reaches milestones worth sharing.</p>
      <p>No spam. Unsubscribe any time by replying to this email.</p>
      <p style="margin-top:24px">— Tinotenda, Neriah Africa</p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="font-size:12px;color:#999">Neriah Africa (Private) Limited · Harare, Zimbabwe · <a href="https://neriah.ai">neriah.ai</a></p>
    `,
  })
}
