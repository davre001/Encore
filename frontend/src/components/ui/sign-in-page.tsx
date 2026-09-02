'use client'

import { useState } from 'react'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn'

type LoginPageProps = {
  /** Switches the copy and submit action. Defaults to the sign-in variant. */
  mode?: 'signin' | 'signup'
}

const COPY = {
  signin: {
    title: 'Welcome back.',
    switchText: "Don't have an account?",
    switchLabel: 'Sign up',
    switchHref: '/signup',
    submit: 'Sign in',
    image:
      'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=1400&auto=format&fit=crop&q=70',
  },
  signup: {
    title: 'Create your booth.',
    switchText: 'Already on Encore?',
    switchLabel: 'Sign in',
    switchHref: '/signin',
    submit: 'Create account',
    image:
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1400&auto=format&fit=crop&q=70',
  },
} as const

/** "mira.chen@x.com" -> "Mira Chen" */
function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? ''
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Creator'
  )
}

export function LoginPage({ mode = 'signin' }: LoginPageProps) {
  const router = useRouter()
  const { signIn } = useAuth()
  const { signInWithGoogle } = useGoogleSignIn()
  const copy = COPY[mode]

  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const email = formData.email.trim()
    if (!email) return

    // Encore has no password backend — this starts the same local session the
    // Google button falls back to, so the form is not a dead control.
    signIn({
      id: `local_${email}`,
      name: nameFromEmail(email),
      email,
    })
    router.push('/home')
  }

  return (
    <div
      className="relative flex h-screen w-full overflow-hidden bg-background"
      style={{
        // A single faint accent glow bleeding in from the form side — no
        // dot-grid, no glass. Keeps auth flat and neutral like the rest of the
        // app, with just the one blue accent for depth.
        backgroundImage:
          'radial-gradient(60% 55% at 80% 24%, color-mix(in srgb, var(--ember) 12%, transparent), transparent 72%)',
      }}
    >
      {/* Left Panel - Image Section (hidden on small screens so the form gets the width) */}
      <div className="relative z-10 hidden flex-1 overflow-hidden md:block">
        {/* Back Button */}
        <div className="absolute left-6 top-6 z-10">
          <button
            onClick={() => router.push('/')}
            aria-label="Back to home"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/30 backdrop-blur-md transition-all hover:bg-black/40"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
        </div>

        <div className="absolute inset-0">
          <img src={copy.image} alt="" className="h-full w-full object-cover" />
          {/* Neutral scrim so the photo reads as part of the dark theme and
              melts into the form panel at the seam. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, color-mix(in srgb, var(--bg) 28%, transparent) 0%, color-mix(in srgb, var(--bg) 82%, transparent) 100%)',
            }}
          />
        </div>
      </div>

      {/* Right Panel - Form Section */}
      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        {/* Flat card — solid surface, hairline border, no backdrop blur. */}
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl shadow-black/40">
          {/* Back button for small screens, where the image panel is hidden */}
          <button
            onClick={() => router.push('/')}
            aria-label="Back to home"
            className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background transition-all hover:bg-accent md:hidden"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>

          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-bold text-foreground">
              {copy.title}
            </h1>
            <p className="text-muted-foreground">
              {copy.switchText}{' '}
              <button
                onClick={() => router.push(copy.switchHref)}
                className="font-medium text-[var(--ember)] transition-opacity hover:opacity-80"
              >
                {copy.switchLabel}
              </button>
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground/80">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Email Address"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-[var(--ember)]"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-foreground/80">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Password"
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 pr-12 text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-[var(--ember)]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-white/10"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-white/50" />
                  ) : (
                    <Eye className="h-5 w-5 text-white/50" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me + Forgot Password (sign-in only) */}
            {mode === 'signin' ? (
              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    name="rememberMe"
                    checked={formData.rememberMe}
                    onChange={handleInputChange}
                    className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[var(--ember)]"
                  />
                  <span>Remember me</span>
                </label>
                <button
                  type="button"
                  className="text-sm font-medium text-[var(--ember)] transition-opacity hover:opacity-80"
                >
                  Forgot password?
                </button>
              </div>
            ) : null}

            {/* Submit — white pill, matching the app's button language */}
            <button
              type="submit"
              className="w-full rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {copy.submit}
            </button>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-sm text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {/* Social Buttons */}
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={signInWithGoogle}
                className="flex items-center justify-center rounded-xl border border-border bg-background px-4 py-3 transition-colors hover:bg-accent"
              >
                {/* Google SVG */}
                <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="text-sm font-medium text-foreground/90">
                  Continue with Google
                </span>
              </button>

              <button
                type="button"
                disabled
                title="GitHub sign-in is not set up yet"
                className="flex cursor-not-allowed items-center justify-center rounded-xl border border-border bg-background px-4 py-3 opacity-50"
              >
                {/* GitHub SVG — currentColor so it stays visible on the dark card */}
                <svg className="mr-2 h-5 w-5 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span className="text-sm font-medium text-foreground/70">
                  Continue with GitHub
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
