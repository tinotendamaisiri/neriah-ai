'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ContactSchema, type ContactInput } from '@/lib/validators/contact'
import Link from 'next/link'
import Image from 'next/image'

const SUBJECTS = ['Demo', 'Sales', 'Support', 'Billing'] as const
const ROLES    = ['Teacher', 'Head of Department', 'Principal/Headmaster', 'Other'] as const

const AFRICAN_COUNTRIES = [
  { flag: '🇿🇼', code: 'ZW', dial: '+263' },
  { flag: '🇿🇦', code: 'ZA', dial: '+27'  },
  { flag: '🇿🇲', code: 'ZM', dial: '+260' },
  { flag: '🇲🇼', code: 'MW', dial: '+265' },
  { flag: '🇹🇿', code: 'TZ', dial: '+255' },
  { flag: '🇰🇪', code: 'KE', dial: '+254' },
  { flag: '🇺🇬', code: 'UG', dial: '+256' },
  { flag: '🇷🇼', code: 'RW', dial: '+250' },
  { flag: '🇳🇬', code: 'NG', dial: '+234' },
  { flag: '🇬🇭', code: 'GH', dial: '+233' },
  { flag: '🇪🇹', code: 'ET', dial: '+251' },
  { flag: '🇲🇿', code: 'MZ', dial: '+258' },
  { flag: '🇧🇼', code: 'BW', dial: '+267' },
  { flag: '🇳🇦', code: 'NA', dial: '+264' },
  { flag: '🇱🇸', code: 'LS', dial: '+266' },
  { flag: '🇸🇿', code: 'SZ', dial: '+268' },
  { flag: '🇲🇬', code: 'MG', dial: '+261' },
  { flag: '🇲🇺', code: 'MU', dial: '+230' },
  { flag: '🇨🇩', code: 'CD', dial: '+243' },
  { flag: '🇨🇬', code: 'CG', dial: '+242' },
  { flag: '🇦🇴', code: 'AO', dial: '+244' },
  { flag: '🇨🇲', code: 'CM', dial: '+237' },
  { flag: '🇸🇳', code: 'SN', dial: '+221' },
  { flag: '🇨🇮', code: 'CI', dial: '+225' },
  { flag: '🇲🇱', code: 'ML', dial: '+223' },
  { flag: '🇧🇫', code: 'BF', dial: '+226' },
  { flag: '🇳🇪', code: 'NE', dial: '+227' },
  { flag: '🇹🇬', code: 'TG', dial: '+228' },
  { flag: '🇧🇯', code: 'BJ', dial: '+229' },
  { flag: '🇸🇱', code: 'SL', dial: '+232' },
  { flag: '🇱🇷', code: 'LR', dial: '+231' },
  { flag: '🇬🇳', code: 'GN', dial: '+224' },
  { flag: '🇬🇲', code: 'GM', dial: '+220' },
  { flag: '🇬🇼', code: 'GW', dial: '+245' },
  { flag: '🇨🇻', code: 'CV', dial: '+238' },
  { flag: '🇸🇹', code: 'ST', dial: '+239' },
  { flag: '🇬🇶', code: 'GQ', dial: '+240' },
  { flag: '🇬🇦', code: 'GA', dial: '+241' },
  { flag: '🇹🇩', code: 'TD', dial: '+235' },
  { flag: '🇨🇫', code: 'CF', dial: '+236' },
  { flag: '🇸🇸', code: 'SS', dial: '+211' },
  { flag: '🇸🇩', code: 'SD', dial: '+249' },
  { flag: '🇪🇷', code: 'ER', dial: '+291' },
  { flag: '🇩🇯', code: 'DJ', dial: '+253' },
  { flag: '🇸🇴', code: 'SO', dial: '+252' },
  { flag: '🇰🇲', code: 'KM', dial: '+269' },
  { flag: '🇸🇨', code: 'SC', dial: '+248' },
  { flag: '🇱🇾', code: 'LY', dial: '+218' },
  { flag: '🇹🇳', code: 'TN', dial: '+216' },
  { flag: '🇩🇿', code: 'DZ', dial: '+213' },
  { flag: '🇲🇦', code: 'MA', dial: '+212' },
  { flag: '🇪🇬', code: 'EG', dial: '+20'  },
] as const

type SubjectValue = typeof SUBJECTS[number]

function resolveSubject(raw: string | null): SubjectValue {
  return SUBJECTS.find(s => s.toLowerCase() === (raw ?? '').toLowerCase()) ?? 'Demo'
}

const inputClass = 'w-full px-3.5 py-3 rounded-lg text-[15px] bg-gray-50 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-[#0D7377] transition-colors min-h-[44px] font-body'
const labelClass = 'block text-[12px] font-medium text-gray-700 mb-1.5'
const errorClass = 'text-[12px] text-red-500 mt-1'

export function ContactForm() {
  const searchParams   = useSearchParams()
  const initialSubject = resolveSubject(searchParams.get('subject'))

  const [status,           setStatus]           = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg,         setErrorMsg]         = useState('')
  const [showSocialLinks,  setShowSocialLinks]  = useState(false)
  const [subject,          setSubject]          = useState<SubjectValue>(initialSubject)
  const [submittedSubject, setSubmittedSubject] = useState<string>('')
  const [dialCode, setDialCode] = useState('+263')
  const [phoneNum, setPhoneNum] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ContactInput>({
    resolver:      zodResolver(ContactSchema),
    defaultValues: { subject: initialSubject },
  })

  const handleSubjectClick = (s: SubjectValue) => {
    setSubject(s)
    setValue('subject', s)
  }

  const handleDialChange = (dial: string, num: string) => {
    setValue('whatsapp_number', `${dial}${num}`, { shouldValidate: true })
  }

  const onSubmit = async (data: ContactInput) => {
    setStatus('loading')
    setSubmittedSubject(data.subject)
    try {
      const res = await fetch('/api/contact', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        if (res.status === 429) {
          setShowSocialLinks(false)
          setErrorMsg(data?.error || 'Too many requests. Please try again later.')
        } else if (res.status === 422) {
          setShowSocialLinks(false)
          setErrorMsg('Please check your form and try again.')
        } else {
          setShowSocialLinks(true)
          setErrorMsg('Something went wrong on our end. Reach us on social media:')
        }
        setStatus('error')
        return
      }
      setStatus('success')
      reset()
      setSubject('Demo')
      setDialCode('+263')
      setPhoneNum('')
    } catch {
      setStatus('error')
      setShowSocialLinks(true)
      setErrorMsg('Something went wrong on our end. Reach us on social media:')
    }
  }

  const successContent: Record<string, { title: string; message: string }> = {
    Demo:    { title: 'Demo request received',    message: 'Our team will be in touch within 24 hours to schedule your demo.' },
    Sales:   { title: 'Message received',         message: 'Our sales team will be in touch shortly.' },
    Support: { title: 'Support request received', message: 'Our support team will get back to you within 1 hour.' },
    Billing: { title: 'Billing enquiry received', message: 'Our team will respond to your billing enquiry within 24 hours.' },
  }
  const { title: successTitle, message: successMessage } = successContent[submittedSubject] ?? successContent.Demo

  if (status === 'success') {
    return (
      <div className="relative bg-white border border-gray-200 rounded-[16px] shadow-lg p-8 text-center">
        <a
          href="/"
          aria-label="Go to home page"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
        <div className="w-12 h-12 bg-[#0D7377]/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4 10l4 4 8-8" stroke="#0D7377" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="font-display text-[20px] font-bold text-gray-900 mb-2">{successTitle}</p>
        <p className="text-[14px] text-[#0D7377]">{successMessage}</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      method="post"
      className="relative bg-white border border-gray-200 rounded-[16px] shadow-lg p-8"
      noValidate
      aria-label="Contact form"
    >
      <a
        href="/"
        aria-label="Go to home page"
        className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>
      {/* Neriah logo */}
      <div className="flex flex-col items-center mb-6">
        <Image
          src="/images/logo/logo-light-background.png"
          alt="Neriah Africa"
          width={40}
          height={40}
          className="flex-shrink-0"
          priority
        />
        <span className="font-display text-xl font-bold text-gray-800 tracking-tight mt-2">Contact Us</span>
      </div>

      {/* Honeypot — hidden from humans */}
      <div className="absolute left-[-9999px] opacity-0 h-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="f-website">Website</label>
        <input type="text" id="f-website" tabIndex={-1} autoComplete="off" {...register('website')} />
      </div>

      <div className="space-y-4">

        {/* First name + Last name */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="f-first_name" className={labelClass}>First name <span className="text-red-500 ml-0.5">*</span></label>
            <input id="f-first_name" type="text" placeholder="Tatenda" autoComplete="given-name"
              className={inputClass} {...register('first_name')} />
            {errors.first_name && <p className={errorClass}>{errors.first_name.message}</p>}
          </div>
          <div className="flex-1">
            <label htmlFor="f-last_name" className={labelClass}>Last name <span className="text-red-500 ml-0.5">*</span></label>
            <input id="f-last_name" type="text" placeholder="Moyo" autoComplete="family-name"
              className={inputClass} {...register('last_name')} />
            {errors.last_name && <p className={errorClass}>{errors.last_name.message}</p>}
          </div>
        </div>

        {/* WhatsApp number — country code dropdown + number input */}
        <div>
          <label htmlFor="f-whatsapp_number" className={labelClass}>WhatsApp number <span className="text-red-500 ml-0.5">*</span></label>
          <div className="flex">
            {/* Country code dropdown with visible chevron */}
            <div className="relative w-[36%] sm:w-[30%] flex-shrink-0">
              <select
                aria-label="Country dial code"
                className="w-full h-full pl-2 pr-7 py-3 text-[13px] bg-gray-50 border border-gray-300 border-r-0 text-gray-900 rounded-l-lg appearance-none focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-[#0D7377] transition-colors min-h-[44px] font-body cursor-pointer"
                value={dialCode}
                onChange={e => {
                  setDialCode(e.target.value)
                  handleDialChange(e.target.value, phoneNum)
                }}
              >
                {AFRICAN_COUNTRIES.map(c => (
                  <option key={c.dial} value={c.dial} className="bg-white text-gray-900 text-[13px]">
                    {c.flag} {c.code} {c.dial}
                  </option>
                ))}
              </select>
              {/* Chevron arrow */}
              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            {/* Phone number input */}
            <input
              id="f-whatsapp_number"
              type="tel"
              placeholder="771 234 567"
              autoComplete="tel-national"
              value={phoneNum}
              onChange={e => {
                setPhoneNum(e.target.value)
                handleDialChange(dialCode, e.target.value)
              }}
              className="flex-1 px-3.5 py-3 rounded-r-lg text-[15px] bg-gray-50 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#0D7377] focus:ring-1 focus:ring-[#0D7377] transition-colors min-h-[44px] font-body"
            />
          </div>
          {/* Hidden registered field carries the combined value */}
          <input type="hidden" {...register('whatsapp_number')} />
          {errors.whatsapp_number && <p className={errorClass}>{errors.whatsapp_number.message}</p>}
        </div>

        {/* Email */}
        <div>
          <label htmlFor="f-email" className={labelClass}>Email address <span className="text-red-500 ml-0.5">*</span></label>
          <input id="f-email" type="email" placeholder="you@school.ac.zw" autoComplete="email"
            className={inputClass} {...register('email')} />
          {errors.email && <p className={errorClass}>{errors.email.message}</p>}
        </div>

        {/* School name */}
        <div>
          <label htmlFor="f-school_name" className={labelClass}>School name <span className="text-red-500 ml-0.5">*</span></label>
          <input id="f-school_name" type="text" placeholder="Harare High School" autoComplete="organization"
            className={inputClass} {...register('school_name')} />
          {errors.school_name && <p className={errorClass}>{errors.school_name.message}</p>}
        </div>

        {/* City */}
        <div>
          <label htmlFor="f-city" className={labelClass}>City / Town <span className="text-red-500 ml-0.5">*</span></label>
          <input id="f-city" type="text" placeholder="Harare" autoComplete="address-level2"
            className={inputClass} {...register('city')} />
          {errors.city && <p className={errorClass}>{errors.city.message}</p>}
        </div>

        {/* Role */}
        <div>
          <label htmlFor="f-role" className={labelClass}>I am a… <span className="text-red-500 ml-0.5">*</span></label>
          <div className="relative">
            <select id="f-role"
              className={`${inputClass} appearance-none pr-8 cursor-pointer`}
              {...register('role')}
            >
              <option value="" disabled>Select your role</option>
              {ROLES.map(r => (
                <option key={r} value={r} className="bg-white text-gray-900">{r}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          {errors.role && <p className={errorClass}>{errors.role.message}</p>}
        </div>

        {/* Subject buttons */}
        <div>
          <p className={labelClass}>Subject <span className="text-red-500 ml-0.5">*</span></p>
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handleSubjectClick(s)}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors min-h-[36px] ${
                  subject === s
                    ? 'bg-[#0D7377] text-white'
                    : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Message (optional) */}
        <div>
          <label htmlFor="f-message" className={labelClass}>
            Message <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea id="f-message"
            placeholder="How many teachers, which subjects, when would suit for a demo visit..."
            className={`${inputClass} resize-y min-h-[90px]`}
            {...register('message')}
          />
        </div>

        {/* Privacy consent — required by Zimbabwe Data Protection Act */}
        <div className="flex items-start gap-2.5">
          <input type="checkbox" id="f-consent" className="mt-0.5 w-[18px] h-[18px] flex-shrink-0 accent-amber"
            {...register('consent')} />
          <label htmlFor="f-consent" className="text-[12px] text-gray-500 leading-relaxed">
            I agree to the{' '}
            <Link href="/privacy" target="_blank" className="text-amber hover:underline">
              Privacy Policy
            </Link>
            . Neriah Africa will use this information only to respond to your request.
          </label>
        </div>
        {errors.consent && <p className={errorClass}>{errors.consent.message}</p>}

        <button
          type="submit"
          disabled={status === 'loading'}
          className="w-full bg-amber text-amber-dark font-medium rounded-lg py-3.5 text-[15px] hover:bg-[#e8960d] transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[48px]"
        >
          {status === 'loading' ? 'Sending...' : 'Send message →'}
        </button>

        {status === 'error' && (
          <div className="text-center">
            <p className="text-[13px] text-red-500">{errorMsg}</p>
            {showSocialLinks && (
              <div className="flex items-center justify-center gap-4 mt-2">
                <a href="https://instagram.com/NeriahAfrica" target="_blank" rel="noopener noreferrer"
                  className="text-[13px] text-[#0D7377] hover:underline font-medium">Instagram</a>
                <a href="https://x.com/NeriahAfrica" target="_blank" rel="noopener noreferrer"
                  className="text-[13px] text-[#0D7377] hover:underline font-medium">X / Twitter</a>
                <a href="https://linkedin.com/company/neriah-africa" target="_blank" rel="noopener noreferrer"
                  className="text-[13px] text-[#0D7377] hover:underline font-medium">LinkedIn</a>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  )
}
