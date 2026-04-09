'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type TabId = 'privacy' | 'terms' | 'delete'

interface SectionItem {
  id: string
  title: string
}

const SECTIONS: Record<TabId, SectionItem[]> = {
  privacy: [
    { id: 'introduction', title: 'Introduction' },
    { id: 'what-we-collect', title: 'What We Collect' },
    { id: 'how-we-use-it', title: 'How We Use It' },
    { id: 'storage-and-security', title: 'Storage and Security' },
    { id: 'third-party-services', title: 'Third-Party Services' },
    { id: 'childrens-data', title: "Children's Data" },
    { id: 'data-retention', title: 'Data Retention' },
    { id: 'your-rights', title: 'Your Rights' },
    { id: 'international-transfers', title: 'International Transfers' },
    { id: 'changes-to-policy', title: 'Changes to This Policy' },
    { id: 'privacy-contact', title: 'Contact' },
  ],
  terms: [
    { id: 'acceptance', title: 'Acceptance of Terms' },
    { id: 'description', title: 'Description of Service' },
    { id: 'account-registration', title: 'Account Registration' },
    { id: 'subscription', title: 'Subscription and Payment' },
    { id: 'acceptable-use', title: 'Acceptable Use' },
    { id: 'teacher-responsibilities', title: 'Teacher Responsibilities' },
    { id: 'intellectual-property', title: 'Intellectual Property' },
    { id: 'ai-content', title: 'AI-Generated Content' },
    { id: 'service-availability', title: 'Service Availability' },
    { id: 'liability', title: 'Limitation of Liability' },
    { id: 'termination', title: 'Termination' },
    { id: 'dispute-resolution', title: 'Dispute Resolution' },
    { id: 'governing-law', title: 'Governing Law' },
    { id: 'changes-to-terms', title: 'Changes to These Terms' },
    { id: 'terms-contact', title: 'Contact' },
  ],
  delete: [
    { id: 'how-to-delete', title: 'How to Delete' },
    { id: 'what-happens', title: 'What Happens' },
    { id: 'export-data', title: 'Export Your Data' },
    { id: 'institutional', title: 'Institutional Accounts' },
    { id: 'reactivation', title: 'Reactivation' },
    { id: 'delete-contact', title: 'Contact' },
  ],
}

const SECTION_TAB_MAP: Record<string, TabId> = Object.entries(SECTIONS).reduce(
  (acc, [tab, sections]) => {
    sections.forEach(s => { acc[s.id] = tab as TabId })
    return acc
  },
  {} as Record<string, TabId>
)

const TAB_LABELS: Record<TabId, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  delete: 'Delete Account',
}

// ── Shared content helpers ────────────────────────────────────────────────────

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-600 leading-[1.7] mb-4 text-[15px]">{children}</p>
}

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      data-section=""
      className="font-display font-bold italic text-dark text-[1.2rem] md:text-[1.3rem] mt-10 mb-3 scroll-mt-[80px] first:mt-0"
    >
      {children}
    </h2>
  )
}

function Hr() {
  return <hr className="border-gray-200 my-8" />
}

function LI({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-gray-600 leading-[1.7] mb-3 text-[15px]">
      <strong className="font-semibold text-gray-900">{label}</strong>{' '}{children}
    </p>
  )
}

function BulletList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc list-outside pl-5 space-y-2 text-gray-600 leading-[1.7] mb-4 text-[15px]">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

const teal = 'text-[#0D7377] hover:underline'

// ── Privacy Policy Content ────────────────────────────────────────────────────

function PrivacyContent() {
  return (
    <>
      <H id="introduction">Introduction</H>
      <P>At Neriah, we take your privacy seriously. This policy explains what data we collect, how we use it, and the rights you have over your information. Neriah is an AI-powered homework marking platform that processes teacher, student, and institutional data. Because our platform handles information about children, we hold ourselves to the highest standards of data protection.</P>
      <P>Neriah is operated by Neriah (Private) Limited, a company incorporated in Zimbabwe. By using our platform, whether through the Neriah App, our website at neriah.ai, or our WhatsApp channel, you agree to the practices described in this policy.</P>
      <P>This policy applies to all users of Neriah, including teachers, school administrators, students, and any other individuals who interact with our services.</P>

      <Hr />
      <H id="what-we-collect">What We Collect</H>
      <LI label="Teacher account information:">your full name, phone number, email address, school name, and the education level you teach. If you sign up via WhatsApp, your WhatsApp phone number serves as your account identifier.</LI>
      <LI label="Student information:">student names, register numbers, class assignments, and academic marks as entered or generated through the platform. This information is provided by the teacher during class setup and through the marking process.</LI>
      <LI label="Scanned images:">photographs of student exercise books, answer keys, question papers, class registers, and book covers uploaded by teachers for marking and student identification purposes.</LI>
      <LI label="AI-processed data:">OCR-extracted text from scanned images, AI-generated grades, marked reference images with annotations showing correct and incorrect answers, AI-generated marking schemes, and grading feedback.</LI>
      <LI label="Document submissions:">for tertiary assessment, PDF, DOCX, and scanned documents submitted by students via email or the App for grading against rubrics.</LI>
      <LI label="Payment information:">mobile money transaction references (such as EcoCash, Innbucks, or bank transfer confirmations) used to verify subscription payments. We do not store mobile money PINs, passwords, or full financial account details.</LI>
      <LI label="Usage data:">how often you use Neriah, the number of scans processed, features accessed, session duration, and interaction patterns.</LI>
      <LI label="Device information:">device type, operating system, browser type, screen resolution, and IP address. For the App, we also collect app version and crash reports.</LI>
      <LI label="Communication data:">messages exchanged with our customer support team via WhatsApp or email.</LI>

      <Hr />
      <H id="how-we-use-it">How We Use It</H>
      <LI label="To provide and operate the service:">processing scanned images through OCR, grading submissions against answer keys using AI, storing academic marks, generating class performance summaries, and delivering results to teachers via the App and WhatsApp.</LI>
      <LI label="To create and manage your account:">verifying your identity, maintaining your teacher profile, associating you with your classes and students, and processing your subscription.</LI>
      <LI label="To improve our AI accuracy:">using anonymised and aggregated scanned images and OCR results to improve handwriting recognition accuracy across different handwriting styles, exercise book formats, and education levels. Individual students are never identified in training data.</LI>
      <LI label="To communicate with you:">sending marking results, subscription reminders, service updates, and responding to support requests.</LI>
      <LI label="To ensure platform safety:">detecting and preventing fraud, abuse, unauthorised access, and violations of our Terms of Service.</LI>
      <LI label="To comply with legal obligations:">responding to lawful requests from government authorities and complying with applicable data protection laws.</LI>
      <LI label="To generate analytics:">providing teachers and school administrators with aggregated performance data, class summaries, and academic trend reports.</LI>

      <Hr />
      <H id="storage-and-security">Storage and Security</H>
      <P>All data is stored on Microsoft Azure cloud infrastructure. Our primary data centres are located in the South Africa North region (Johannesburg), with supplementary processing capacity in other Azure regions where required.</P>
      <LI label="Encryption at rest:">all data stored in Azure Cosmos DB, Azure Blob Storage, and other storage services is encrypted using AES-256 encryption.</LI>
      <LI label="Encryption in transit:">all data transmitted between your device and our servers is encrypted using TLS 1.2 or higher.</LI>
      <LI label="Access controls:">access to production data is restricted to authorised personnel only, using role-based access controls and multi-factor authentication.</LI>
      <LI label="Serverless architecture:">our backend runs on Azure Functions, which reduces the attack surface by eliminating persistent servers that could be compromised.</LI>
      <LI label="Regular monitoring:">we use Azure Monitor and Application Insights to detect anomalies, unauthorised access attempts, and system failures in real time.</LI>
      <LI label="Secure image handling:">scanned exercise book images are stored in private Azure Blob Storage containers that are not publicly accessible.</LI>

      <Hr />
      <H id="third-party-services">Third-Party Services</H>
      <P>We share data with the following third-party service providers:</P>
      <LI label="Microsoft Azure:">cloud hosting, data storage, AI Document Intelligence (OCR), and Azure OpenAI Service (grading inference). Microsoft processes data in accordance with their data protection addendum and applicable certifications including ISO 27001 and SOC 2.</LI>
      <LI label="Meta (WhatsApp Cloud API):">for teachers using the WhatsApp channel, messages and images are transmitted through Meta's WhatsApp Cloud API.</LI>
      <LI label="EcoCash / Innbucks / Payment providers:">payment verification is handled through the relevant mobile money provider's API. We transmit only the minimum data required to verify a transaction.</LI>
      <LI label="Resend:">transactional email delivery for subscription confirmations and system notifications.</LI>
      <LI label="Vercel:">website hosting. Website visitor data is subject to Vercel's privacy policy.</LI>
      <P>We do not sell, rent, or trade your personal information to any third party for marketing purposes. We do not share student data with advertisers or data brokers.</P>

      <Hr />
      <H id="childrens-data">Children&apos;s Data</H>
      <P>Neriah processes academic data about students, many of whom are minors under the age of 18. We take this responsibility extremely seriously.</P>
      <LI label="Teacher as data controller:">teachers and their institutions are the primary data controllers for student information. Teachers are responsible for obtaining any required parental or institutional consent before entering student data into Neriah.</LI>
      <LI label="Minimal student data:">we collect only the minimum student data necessary: student names, register numbers, class assignments, and academic marks. We do not collect student email addresses, phone numbers, home addresses, dates of birth, or photographs of students' faces.</LI>
      <LI label="No direct student interaction:">the core marking service is used exclusively by teachers. Students do not create accounts or directly interact with the marking platform.</LI>
      <LI label="No profiling of minors:">we do not use student data for behavioural profiling, targeted advertising, or any purpose beyond academic performance tracking.</LI>
      <LI label="Data minimisation for AI training:">any use of scanned images for OCR model improvement is conducted on fully anonymised data. Student names and identifiable information are stripped before any image is used in training pipelines.</LI>

      <Hr />
      <H id="data-retention">Data Retention</H>
      <LI label="Active accounts:">your data is retained for as long as your Neriah account is active and your subscription is current.</LI>
      <LI label="Expired subscriptions:">if your subscription lapses, your data is retained for 12 months to allow for reactivation. After 12 months of inactivity, your data is scheduled for deletion.</LI>
      <LI label="Scanned images:">original scanned exercise book images are retained for 90 days after processing, after which they are automatically deleted. AI-marked reference images are retained for the duration of the academic term plus 30 days.</LI>
      <LI label="Account deletion:">when you request account deletion, your personal data is removed within 30 days. Student academic records are anonymised and retained for the remainder of the academic year to ensure continuity.</LI>
      <LI label="Backups:">encrypted backups may retain deleted data for up to 90 days before being automatically purged.</LI>

      <Hr />
      <H id="your-rights">Your Rights</H>
      <P>Under the Zimbabwe Data Protection Act (2021) and applicable international standards, you have the following rights:</P>
      <LI label="Right of access:">you may request a copy of all personal data we hold about you.</LI>
      <LI label="Right to correction:">you may request correction of any inaccurate or incomplete personal data.</LI>
      <LI label="Right to deletion:">you may request deletion of your personal data, subject to retention provisions and legal obligations.</LI>
      <LI label="Right to data portability:">you may request your data in a structured, machine-readable format (JSON or CSV).</LI>
      <LI label="Right to withdraw consent:">where processing is based on your consent, you may withdraw at any time.</LI>
      <LI label="Right to object:">you may object to processing for specific purposes, including AI model improvement.</LI>
      <LI label="Right to lodge a complaint:">you may lodge a complaint with the Postal and Telecommunications Regulatory Authority of Zimbabwe (POTRAZ).</LI>
      <P>To exercise any of these rights, contact us at <a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a> with the subject line &ldquo;Data Rights Request.&rdquo; We will respond within 30 days.</P>

      <Hr />
      <H id="international-transfers">International Transfers</H>
      <P>Your data is primarily stored in Microsoft Azure&apos;s South Africa North data centre (Johannesburg). Certain processing services, including Azure OpenAI, may process data in other Azure regions where specific AI model capacity is available. All international transfers are protected by Microsoft&apos;s data processing agreements, Standard Contractual Clauses, and applicable encryption standards.</P>
      <P>By using Neriah, you consent to the transfer and processing of your data in the jurisdictions where our infrastructure operates.</P>

      <Hr />
      <H id="changes-to-policy">Changes to This Policy</H>
      <P>We may update this privacy policy from time to time. We will notify you of material changes via the App, WhatsApp, or email at least 14 days before the changes take effect. Continued use of Neriah after the effective date constitutes acceptance of the updated policy.</P>

      <Hr />
      <H id="privacy-contact">Contact</H>
      <LI label="Email:"><a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a></LI>
      <LI label="WhatsApp:">message our business account</LI>
      <LI label="Website:"><a href="https://neriah.ai/contact" className={teal}>neriah.ai/contact</a></LI>
      <LI label="Data Protection Officer:">Tino Maisiri, Founder and CEO</LI>
      <LI label="Email:"><a href="mailto:tino@neriah.ai" className={teal}>tino@neriah.ai</a></LI>
    </>
  )
}

// ── Terms of Service Content ──────────────────────────────────────────────────

function TermsContent() {
  return (
    <>
      <H id="acceptance">Acceptance of Terms</H>
      <P>By creating a Neriah account, subscribing to any Neriah plan, or using any Neriah service through the App, website, or WhatsApp channel, you agree to be bound by these Terms of Service. If you are agreeing on behalf of a school, institution, or other organisation, you represent that you have the authority to bind that entity.</P>
      <P>If you do not agree to these terms, do not use Neriah.</P>

      <Hr />
      <H id="description">Description of Service</H>
      <P>Neriah is an AI-powered homework marking assistant that enables teachers to grade student exercise books by photographing handwritten work and receiving automated scores and marked reference images. The service is available through a dedicated mobile and web App (primary channel) and a WhatsApp bot (lightweight channel).</P>
      <P>Neriah also provides class management tools, student record-keeping, performance analytics, AI-generated marking schemes, and education-level-calibrated grading. A tertiary assessment module supports document-based submissions graded against rubrics.</P>
      <P>Neriah is a tool that assists teachers. It does not replace the teacher&apos;s professional judgment. All AI-generated grades are recommendations that the teacher reviews and may override.</P>

      <Hr />
      <H id="account-registration">Account Registration</H>
      <P>To use Neriah, you must create an account by providing your name, phone number, school name, and education level. On WhatsApp, your phone number serves as your account identifier.</P>
      <P>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must notify us immediately at <a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a> if you suspect unauthorised use.</P>
      <P>You must be at least 18 years of age to create a teacher account. The student AI product (when available) will require parental or institutional consent for users under 18.</P>

      <Hr />
      <H id="subscription">Subscription and Payment</H>
      <P>Neriah operates on a subscription basis:</P>
      <LI label="Starter Plan:">$29 per month for individual teachers.</LI>
      <LI label="Growth Plan:">$99 per month for up to 20 teachers.</LI>
      <LI label="Institution Plan:">$400 per month for up to 100 teachers.</LI>
      <P>All prices are in US Dollars. Payments are accepted via EcoCash, Innbucks, bank transfer, and other available methods.</P>
      <LI label="Billing:">subscriptions are billed monthly in advance and renew automatically.</LI>
      <LI label="Cancellation:">cancel at any time; takes effect at the end of the current billing period. No partial refunds.</LI>
      <LI label="Price changes:">30 days&apos; written notice for any pricing changes.</LI>
      <LI label="Non-payment:">7-day grace period, then account suspension. Data retained for 12 months per our Privacy Policy.</LI>
      <LI label="Institutional licences:">subject to the Neriah School Licence Agreement.</LI>

      <Hr />
      <H id="acceptable-use">Acceptable Use</H>
      <P>You agree to use Neriah only for its intended purpose: assisting with the grading and management of student academic work. You may not:</P>
      <BulletList items={[
        'Use Neriah to process, store, or transmit any content that is illegal, harmful, threatening, abusive, defamatory, obscene, or otherwise objectionable.',
        'Attempt to reverse-engineer, decompile, or extract the source code of any Neriah component.',
        'Use automated tools, bots, or scripts to interact with Neriah beyond normal use.',
        'Share account credentials or allow multiple teachers to use a single account.',
        'Upload content that infringes the intellectual property rights of any third party.',
        'Use AI features to generate content unrelated to academic marking.',
        'Attempt to circumvent usage limits or technical restrictions.',
        'Misrepresent your identity, school affiliation, or education level.',
        'Use the platform in any way that violates applicable laws, including the Zimbabwe Data Protection Act (2021).',
      ]} />

      <Hr />
      <H id="teacher-responsibilities">Teacher Responsibilities</H>
      <LI label="Professional judgment:">AI-generated grades are recommendations. You are responsible for reviewing each AI grade before recording it as a final mark. Neriah is not liable for academic consequences arising from unreviewed AI grades.</LI>
      <LI label="Student data accuracy:">you are responsible for the accuracy of student names, register numbers, and class information.</LI>
      <LI label="Consent and authority:">you represent that you have the necessary consent or institutional authority to enter student data into Neriah.</LI>
      <LI label="Answer key accuracy:">you are responsible for the accuracy of uploaded answer keys and marking schemes.</LI>
      <LI label="Confidentiality:">you agree to handle student academic records with appropriate confidentiality, consistent with your professional obligations.</LI>

      <Hr />
      <H id="intellectual-property">Intellectual Property</H>
      <LI label="Neriah's property:">the platform, including the App, website, AI models, algorithms, user interface, and documentation, is owned by Neriah (Private) Limited.</LI>
      <LI label="Your content:">you retain ownership of all content you upload. By uploading, you grant Neriah a limited licence to process and store that content solely for providing the service.</LI>
      <LI label="AI training licence:">you grant Neriah a non-exclusive, royalty-free licence to use anonymised versions of uploaded scanned images for improving OCR accuracy. You may opt out by contacting <a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a>.</LI>
      <LI label="Student work:">student exercise book content processed through Neriah remains the intellectual property of the student and their institution.</LI>

      <Hr />
      <H id="ai-content">AI-Generated Content</H>
      <LI label="AI is not infallible:">AI-generated grades may contain errors, particularly for subjective assessments, poor handwriting, damaged pages, and low-quality photographs. Teachers must review all AI output.</LI>
      <LI label="Education level calibration:">selecting an incorrect education level will produce inappropriate grading results. It is the teacher&apos;s responsibility to select the correct level.</LI>
      <LI label="No guarantee of accuracy:">while Neriah strives for the highest accuracy, we do not guarantee that AI grades will match what a human marker would assign. Our target OCR accuracy is 85% or higher on clearly written work.</LI>
      <LI label="Marking scheme generation:">AI-generated marking schemes are suggestions. Teachers must review and approve before use.</LI>

      <Hr />
      <H id="service-availability">Service Availability</H>
      <P>We aim to maintain high availability but do not guarantee uninterrupted access. The service may be temporarily unavailable due to:</P>
      <BulletList items={[
        'Scheduled maintenance (24 hours\u2019 advance notice where practicable).',
        'Unscheduled downtime from infrastructure failures or third-party disruptions.',
        'WhatsApp Cloud API service interruptions by Meta.',
        'Network connectivity issues in your location.',
      ]} />
      <P>Neriah is not liable for any loss or inconvenience caused by service interruptions.</P>

      <Hr />
      <H id="liability">Limitation of Liability</H>
      <BulletList items={[
        'Neriah\u2019s total liability shall not exceed the fees you paid in the 12 months preceding the claim.',
        'Neriah shall not be liable for indirect, incidental, special, consequential, or punitive damages, including loss of academic data, marks, or revenue.',
        'Neriah shall not be liable for consequences arising from reliance on AI-generated grades without independent review.',
        'Neriah shall not be liable for damage caused by incorrectly entered student data.',
        'This limitation applies to the fullest extent permitted under the laws of Zimbabwe.',
      ]} />

      <Hr />
      <H id="termination">Termination</H>
      <LI label="By you:">terminate at any time by cancelling your subscription and requesting account deletion through the App, WhatsApp, or <a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a>.</LI>
      <LI label="By us:">we may suspend or terminate your account for violation of these Terms, fraudulent activity, or harmful use. Reasonable notice will be provided except in urgent cases.</LI>
      <LI label="Effect:">upon termination, access is revoked and data is handled per our Privacy Policy.</LI>

      <Hr />
      <H id="dispute-resolution">Dispute Resolution</H>
      <P>Any dispute shall first be addressed through good-faith negotiation. If unresolved within 30 days, it shall be submitted to arbitration in Harare, Zimbabwe, under the Arbitration Act of Zimbabwe.</P>
      <P>The language of arbitration shall be English. The decision shall be final and binding.</P>

      <Hr />
      <H id="governing-law">Governing Law</H>
      <P>These Terms are governed by the laws of the Republic of Zimbabwe. The courts of Zimbabwe shall have exclusive jurisdiction, subject to the arbitration provision above.</P>

      <Hr />
      <H id="changes-to-terms">Changes to These Terms</H>
      <P>We may update these Terms from time to time with at least 30 days&apos; notice via the App, WhatsApp, or email. Continued use after the effective date constitutes acceptance. If you do not agree, you must stop using Neriah before the effective date.</P>

      <Hr />
      <H id="terms-contact">Contact</H>
      <LI label="Email:"><a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a></LI>
      <LI label="WhatsApp:">message our business account</LI>
      <LI label="Website:"><a href="https://neriah.ai/contact" className={teal}>neriah.ai/contact</a></LI>
    </>
  )
}

// ── Delete Account Content ────────────────────────────────────────────────────

function DeleteContent() {
  return (
    <>
      <H id="how-to-delete">How to Delete</H>
      <P>You can request permanent deletion of your Neriah account through any of the following methods:</P>
      <LI label="Through the App:">go to Settings, then Account, then Delete Account. Follow the confirmation prompts.</LI>
      <LI label="Via WhatsApp:">send the message &ldquo;DELETE ACCOUNT&rdquo; to our Neriah WhatsApp business number. Our team will verify your identity and process the request.</LI>
      <LI label="Via email:">send an email to <a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a> with the subject line &ldquo;Account Deletion Request&rdquo; from the email address associated with your account. Include your full name and phone number for verification.</LI>
      <P>All deletion requests are processed within 30 days.</P>

      <Hr />
      <H id="what-happens">What Happens</H>
      <P>When your account deletion is processed:</P>
      <p className="font-semibold text-gray-900 mb-2 text-[15px]">Immediately upon processing:</p>
      <BulletList items={[
        'Your teacher profile (name, phone number, email, school affiliation) is permanently deleted.',
        'Your login credentials are revoked.',
        'Your answer keys, question papers, and marking schemes are permanently deleted.',
        'All scanned exercise book images and AI-marked reference images are permanently deleted.',
        'Your subscription is cancelled.',
      ]} />
      <p className="font-semibold text-gray-900 mb-2 text-[15px]">Within 30 days:</p>
      <BulletList items={[
        'All personal data is purged from active databases.',
        'Support conversation history is anonymised.',
      ]} />
      <LI label="Student academic records:">Student names, register numbers, and marks are anonymised (your identity as teacher is removed). Records are retained until the end of the current academic year to ensure continuity for replacement teachers. After the academic year ends, all anonymised records are permanently deleted unless the school maintains them under an institutional licence.</LI>
      <LI label="Backups:">Encrypted backups may persist for up to 90 days before automatic purge.</LI>

      <Hr />
      <H id="export-data">Export Your Data</H>
      <P>Before deleting your account, you may request an export of your data:</P>
      <BulletList items={[
        'Your teacher profile information.',
        'All student records (names, register numbers, marks, class assignments) in CSV or JSON format.',
        'Class performance summaries.',
      ]} />
      <P>To request a data export, email <a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a> with the subject line &ldquo;Data Export Request&rdquo; at least 7 days before submitting your deletion request. We will provide your export within 14 days.</P>

      <Hr />
      <H id="institutional">Institutional Accounts</H>
      <P>If your account is part of a school or institutional licence, deletion may be subject to additional terms in the School Licence Agreement. Student records under institutional licences may be transferred to another teacher at the institution rather than anonymised.</P>
      <P>Contact your school administrator or email <a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a> for guidance.</P>

      <Hr />
      <H id="reactivation">Reactivation</H>
      <P>Account deletion is permanent and cannot be reversed. If you wish to use Neriah again after deleting your account, you must create a new account. Previous student records, marks, and class data will not be recoverable.</P>

      <Hr />
      <H id="delete-contact">Contact</H>
      <LI label="Email:"><a href="mailto:support@neriah.ai" className={teal}>support@neriah.ai</a></LI>
      <LI label="WhatsApp:">message our business account</LI>
      <LI label="Website:"><a href="https://neriah.ai/contact" className={teal}>neriah.ai/contact</a></LI>
    </>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function LegalContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (tabParam === 'terms') return 'terms'
    if (tabParam === 'delete') return 'delete'
    return 'privacy'
  })
  const [activeSection, setActiveSection] = useState<string>(
    () => SECTIONS[tabParam === 'terms' ? 'terms' : tabParam === 'delete' ? 'delete' : 'privacy'][0].id
  )

  // Handle hash on mount
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash && SECTION_TAB_MAP[hash]) {
      const tab = SECTION_TAB_MAP[hash]
      setActiveTab(tab)
      setActiveSection(hash)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      })
    }
  }, [])

  // IntersectionObserver — re-runs when tab changes
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 }
    )
    const sections = document.querySelectorAll('[data-section]')
    sections.forEach(s => observer.observe(s))
    return () => observer.disconnect()
  }, [activeTab])

  function handleTabChange(tab: TabId) {
    setActiveTab(tab)
    setActiveSection(SECTIONS[tab][0].id)
    router.push(`/legal?tab=${tab}`, { scroll: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main id="main-content" className="bg-white min-h-screen">
      {/* Page header */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 pt-8 pb-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[#0D7377] text-sm font-medium hover:underline mb-5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back to Home
          </Link>
          <h1 className="font-display font-bold text-dark text-[1.75rem] md:text-[2rem] mb-5 leading-tight">
            Neriah Privacy &amp; Terms
          </h1>
          {/* Tab nav */}
          <div className="flex overflow-x-auto -mb-px scrollbar-none" role="tablist" aria-label="Legal sections">
            {(['privacy', 'terms', 'delete'] as TabId[]).map(tab => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => handleTabChange(tab)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                  activeTab === tab
                    ? 'text-[#0D7377] border-[#0D7377]'
                    : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex gap-8 md:gap-14 items-start">
          {/* Sidebar — hidden on mobile */}
          <aside className="hidden md:block w-[200px] min-w-[200px] sticky top-20 self-start max-h-[calc(100vh-100px)] overflow-y-auto">
            <nav aria-label="Page sections">
              {SECTIONS[activeTab].map(section => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`block w-full text-left text-[13px] px-3 py-[7px] rounded-md mb-0.5 transition-all duration-150 leading-snug ${
                    activeSection === section.id
                      ? 'text-[#0D7377] bg-[#E8F4F4] font-medium'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0 pb-20">
            <p className="text-sm text-gray-400 mb-8">Last updated: March 2026</p>
            {activeTab === 'privacy' && <PrivacyContent />}
            {activeTab === 'terms' && <TermsContent />}
            {activeTab === 'delete' && <DeleteContent />}
          </div>
        </div>
      </div>
    </main>
  )
}
