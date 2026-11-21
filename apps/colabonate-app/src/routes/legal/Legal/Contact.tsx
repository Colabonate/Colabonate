import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { Tabs, Tab, Box } from '@mui/material'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline'
import { PageContainer, PageCard } from '@ds/ui'
import { cn } from '@ds/utils'
import { PageHeader } from '../../../components/PageHeader'
import { Seo } from '../../../components/Seo'
import { apiCall } from '../../../lib/api'
import { ContactChat } from '../../../components/community/ContactChat'

interface FormState {
  name: string
  email: string
  subject: string
  message: string
}

interface FormErrors {
  name?: string
  email?: string
  subject?: string
  message?: string
}

const COMMUNITY_LINKS = [
  { label: 'Website', href: 'https://colabonate.com', icon: 'globe' },
  { label: 'GitHub', href: 'https://github.com/Colabonate', icon: 'github' },
  { label: 'Discussions', href: 'https://github.com/Colabonate/discussions', icon: 'comments' },
  { label: 'Open Collective', href: 'https://opencollective.com/colabonate', icon: 'heart' },
  { label: 'YouTube', href: 'https://youtube.com/@colabonate', icon: 'youtube' },
  { label: 'X / Twitter', href: 'https://x.com/Colabonate', icon: 'twitter' },
  { label: 'Instagram', href: 'https://instagram.com/colabonate', icon: 'instagram' },
  { label: 'Patreon', href: 'https://patreon.com/c/Colabonate', icon: 'patreon' },
] as const

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function CommentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function YoutubeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

function TwitterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}

function PatreonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.997 4.858c-.945 0-1.783.545-2.177 1.339l-5.214 10.578c-.315.643-.945 1.078-1.697 1.078h-.788c-.945 0-1.783-.545-2.177-1.339l-5.214-10.578c-.315-.643-.945-1.078-1.697-1.078H0c0 .66.54 1.2 1.2 1.2h.788c.752 0 1.382.435 1.697 1.078l5.214 10.578c.394.794 1.232 1.339 2.177 1.339h.788c.945 0 1.783-.545 2.177-1.339l5.214-10.578c.315-.643.945-1.078 1.697-1.078h.788c.66 0 1.2-.54 1.2-1.2h-1.2c-.752 0-1.382.435-1.697 1.078l-5.214 10.578c-.394.794-1.232 1.339-2.177 1.339h-.788c-.945 0-1.783-.545-2.177-1.339l-5.214-10.578c-.315-.643-.945-1.078-1.697-1.078H0c0 .66.54 1.2 1.2 1.2h.788c.752 0 1.382.435 1.697 1.078l5.214 10.578c.394.794 1.232 1.339 2.177 1.339h.788c.945 0 1.783-.545 2.177-1.339l5.214-10.578c.315-.643.945-1.078 1.697-1.078h.788c.66 0 1.2-.54 1.2-1.2h-1.2c-.752 0-1.382.435-1.697 1.078l-5.214 10.578c-.394.794-1.232 1.339-2.177 1.339h-.788c-.945 0-1.783-.545-2.177-1.339l-5.214-10.578c-.315-.643-.945-1.078-1.697-1.078H0c0 .66.54 1.2 1.2 1.2h.788c.752 0 1.382.435 1.697 1.078l5.214 10.578c.394.794 1.232 1.339 2.177 1.339h.788c.945 0 1.783-.545 2.177-1.339l5.214-10.578c.315-.643.945-1.078 1.697-1.078h.788c.66 0 1.2-.54 1.2-1.2h-1.2c-.752 0-1.382.435-1.697 1.078l-5.214 10.578c-.394.794-1.232 1.339-2.177 1.339h-.788c-.945 0-1.783-.545-2.177-1.339l-5.214-10.578c-.315-.643-.945-1.078-1.697-1.078H0c0 .66.54 1.2 1.2 1.2h.788c.752 0 1.382.435 1.697 1.078l5.214 10.578c.394.794 1.232 1.339 2.177 1.339h.788z" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  )
}

const ICONS: Record<string, React.FC> = {
  globe: GlobeIcon,
  github: GithubIcon,
  comments: CommentsIcon,
  heart: HeartIcon,
  youtube: YoutubeIcon,
  twitter: TwitterIcon,
  instagram: InstagramIcon,
  patreon: PatreonIcon,
}

function CommunityLink({ label, href, icon }: { label: string; href: string; icon: string }) {
  const Icon = ICONS[icon]
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 py-2 px-3 rounded-lg text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface-secondary)] transition-colors duration-150 -mx-3"
    >
      {Icon && <Icon />}
      <span className="text-sm">{label}</span>
    </a>
  )
}

function ContactForm() {
  const [form, setForm] = useState<FormState>({ name: '', email: '', subject: '', message: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function validate(): boolean {
    const newErrors: FormErrors = {}
    if (!form.name.trim() || form.name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters'
    }
    if (!form.email || !form.email.includes('@') || !form.email.includes('.')) {
      newErrors.email = 'Please enter a valid email address'
    }
    if (!form.subject.trim() || form.subject.trim().length < 3) {
      newErrors.subject = 'Subject must be at least 3 characters'
    }
    if (!form.message.trim() || form.message.trim().length < 10) {
      newErrors.message = 'Message must be at least 10 characters'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    if (!validate()) return

    setLoading(true)
    try {
      const response = await apiCall('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to send message')
      }
      setSuccess(true)
      setForm({ name: '', email: '', subject: '', message: '' })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--color-success-bg)] flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-[var(--theme-text)] mb-2">Message Sent!</h3>
        <p className="text-sm text-[var(--theme-text-muted)]">Thank you for reaching out. We'll get back to you soon.</p>
        <button
          onClick={() => setSuccess(false)}
          className="mt-4 text-sm text-[var(--color-primary)] hover:underline"
        >
          Send another message
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium text-[var(--theme-text)]">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          value={form.name}
          onChange={handleChange}
          placeholder="Your name"
          className={cn(
            'w-full px-3 py-2 rounded-lg border bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] text-sm',
            errors.name ? 'border-[var(--color-error)]' : 'border-[var(--theme-border)]'
          )}
        />
        {errors.name && <p className="text-xs text-[var(--color-error)]">{errors.name}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-[var(--theme-text)]">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          placeholder="your@email.com"
          className={cn(
            'w-full px-3 py-2 rounded-lg border bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] text-sm',
            errors.email ? 'border-[var(--color-error)]' : 'border-[var(--theme-border)]'
          )}
        />
        {errors.email && <p className="text-xs text-[var(--color-error)]">{errors.email}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="subject" className="text-sm font-medium text-[var(--theme-text)]">Subject</label>
        <input
          id="subject"
          name="subject"
          type="text"
          value={form.subject}
          onChange={handleChange}
          placeholder="What's this about?"
          className={cn(
            'w-full px-3 py-2 rounded-lg border bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] text-sm',
            errors.subject ? 'border-[var(--color-error)]' : 'border-[var(--theme-border)]'
          )}
        />
        {errors.subject && <p className="text-xs text-[var(--color-error)]">{errors.subject}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="text-sm font-medium text-[var(--theme-text)]">Message</label>
        <textarea
          id="message"
          name="message"
          value={form.message}
          onChange={handleChange}
          placeholder="Tell us how we can help..."
          rows={5}
          className={cn(
            'w-full px-3 py-2 rounded-lg border bg-[var(--theme-surface)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] text-sm resize-none',
            errors.message ? 'border-[var(--color-error)]' : 'border-[var(--theme-border)]'
          )}
        />
        {errors.message && <p className="text-xs text-[var(--color-error)]">{errors.message}</p>}
      </div>

      {submitError && (
        <div className="px-3 py-2 rounded-lg bg-[var(--color-error-bg)] text-[var(--color-error)] text-sm">
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading && <SpinnerIcon />}
        {loading ? 'Sending...' : 'Send Message'}
      </button>
    </form>
  )
}

function CommunityLinks() {
  return (
    <div className="flex flex-col">
<nav className="flex flex-col">
        {COMMUNITY_LINKS.map(link => (
          <CommunityLink key={link.href} {...link} />
        ))}
      </nav>
    </div>
  )
}

export function Contact() {
  const [activeTab, setActiveTab] = useState<'message' | 'chat'>('message')

  return (
    <>
      <Seo
        title="Contact"
        description="Contact the Colabonate team: send a message, open a chat, or reach the community on Nostr, GitHub and social channels — support for the open marketplace."
        path="/contact"
      />
    <PageContainer>
      <PageHeader icon={<Mail size={20} />} title="Contact" subtitle="Get in touch with the Colabonate team" />

      <Box sx={{ borderBottom: '1px solid var(--theme-border)' }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v as 'message' | 'chat')}
          sx={{
            '& .MuiTabs-indicator': { backgroundColor: 'var(--color-primary-50)', height: 2 },
            '& .MuiTab-root': {
              color: 'var(--theme-text-muted)',
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.875rem',
              minHeight: 44,
            },
            '& .Mui-selected': { color: 'var(--color-primary-50) !important', fontWeight: 600 },
          }}
        >
          <Tab value="message" label="Send Message" icon={<MailOutlineIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
          <Tab value="chat" label="Community Chat" icon={<ChatBubbleOutlineIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
        </Tabs>
      </Box>

      {activeTab === 'message' && (
        <div className="flex flex-col gap-6 mt-5">
          <div
            className="flex items-start gap-4 p-5 rounded-xl"
            style={{ background: 'rgba(232,69,65,0.05)', border: '1px solid rgba(232,69,65,0.12)' }}
          >
            <HelpOutlineIcon sx={{ fontSize: 20, color: 'var(--color-primary-50)', mt: 0.125, flexShrink: 0 }} />
            <div>
              <h3 className="text-[14px] font-semibold mb-1.5" style={{ color: 'var(--theme-text)' }}>
                Looking for a quick answer?
              </h3>
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
                Most questions are already answered — browse the{' '}
                <Link to="/help" className="font-medium hover:underline" style={{ color: 'var(--color-primary-50)' }}>Help Center</Link>
                {' '}or visit{' '}
                <a href="https://colabonate.com" target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--color-primary-50)' }}>colabonate.com</a>
                {' '}first. Still need help? Write us below.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">
            <div className="lg:col-span-3">
              <PageCard>
                <div className="flex items-center gap-3 mb-5">
                  <div
                    className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl"
                    style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}
                  >
                    <MailOutlineIcon sx={{ fontSize: 20 }} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold" style={{ color: 'var(--theme-text)' }}>Send a Message</h3>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>We usually reply within 24 hours</p>
                  </div>
                </div>
                <ContactForm />
              </PageCard>
            </div>

            <div className="lg:col-span-2">
              <PageCard>
                <div className="flex items-center gap-3 mb-5">
                  <div
                    className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl"
                    style={{ background: 'rgba(107,177,255,0.10)', color: 'var(--color-accent-1)' }}
                  >
                    <PeopleOutlineIcon sx={{ fontSize: 20 }} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold" style={{ color: 'var(--theme-text)' }}>Community</h3>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>Connect with us everywhere</p>
                  </div>
                </div>
                <CommunityLinks />
              </PageCard>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'chat' && (
        <div className="flex flex-col gap-6 mt-5">
          <div
            className="flex items-start gap-4 p-5 rounded-xl"
            style={{ background: 'rgba(42,232,102,0.05)', border: '1px solid rgba(42,232,102,0.12)' }}
          >
            <HelpOutlineIcon sx={{ fontSize: 20, color: 'var(--color-accent-3)', mt: 0.125, flexShrink: 0 }} />
            <div>
              <h3 className="text-[14px] font-semibold mb-1.5" style={{ color: 'var(--theme-text)' }}>
                Chat is public and powered by Nostr
              </h3>
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
                All messages are visible to everyone. For guides and documentation, visit the{' '}
                <Link to="/help" className="font-medium hover:underline" style={{ color: 'var(--color-accent-3)' }}>Help Center</Link>
                {' '}or browse{' '}
                <a href="https://colabonate.com" target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--color-accent-3)' }}>colabonate.com</a>
                . Login with a Nostr wallet to post.
              </p>
            </div>
          </div>

          <PageCard>
            <div className="flex items-center gap-3 mb-5">
              <div
                className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl"
                style={{ background: 'rgba(42,232,102,0.10)', color: 'var(--color-accent-3)' }}
              >
                <ChatBubbleOutlineIcon sx={{ fontSize: 20 }} />
              </div>
              <div>
                <h3 className="text-[16px] font-semibold" style={{ color: 'var(--theme-text)' }}>Community Chat</h3>
                <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>Public · Nostr NIP-28</p>
              </div>
            </div>
            <ContactChat />
          </PageCard>
        </div>
      )}
    </PageContainer>
    </>
  )
}
