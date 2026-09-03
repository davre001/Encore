'use client'

import { useState, useMemo } from 'react'
import { Eye, EyeOff, ArrowLeft, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn'
import { signUp, signInWithCredentials, forgotPassword, resetPassword } from '@/api/client'

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
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  })

  // Forgot password flow state: 'normal' | 'forgot_email' | 'forgot_code'
  const [authStep, setAuthStep] = useState<'normal' | 'forgot_email' | 'forgot_code'>('normal')
  const [forgotData, setForgotData] = useState({
    email: '',
    confirmEmail: '',
    code: '',
    newPassword: '',
    confirmNewPassword: '',
  })
  const [showNewPassword, setShowNewPassword] = useState(false)

  // Password strength detection for normal signup
  const password = formData.password
  const strengthChecks = useMemo(() => {
    return {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]/.test(password),
    }
  }, [password])

  const passedCount = Object.values(strengthChecks).filter(Boolean).length
  const strengthLabel = useMemo(() => {
    if (!password) return ''
    if (passedCount <= 2) return 'Weak'
    if (passedCount <= 3) return 'Fair'
    if (passedCount <= 4) return 'Good'
    return 'Strong'
  }, [password, passedCount])

  const strengthColor = useMemo(() => {
    if (passedCount <= 2) return 'bg-red-500'
    if (passedCount <= 3) return 'bg-amber-500'
    if (passedCount <= 4) return 'bg-blue-500'
    return 'bg-emerald-500'
  }, [passedCount])

  // Password strength detection for reset password
  const newPass = forgotData.newPassword
  const newPassChecks = useMemo(() => {
    return {
      length: newPass.length >= 8,
      upper: /[A-Z]/.test(newPass),
      lower: /[a-z]/.test(newPass),
      number: /[0-9]/.test(newPass),
      symbol: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]/.test(newPass),
    }
  }, [newPass])

  const newPassCount = Object.values(newPassChecks).filter(Boolean).length
  const newPassLabel = useMemo(() => {
    if (!newPass) return ''
    if (newPassCount <= 2) return 'Weak'
    if (newPassCount <= 3) return 'Fair'
    if (newPassCount <= 4) return 'Good'
    return 'Strong'
  }, [newPass, newPassCount])

  const newPassColor = useMemo(() => {
    if (newPassCount <= 2) return 'bg-red-500'
    if (newPassCount <= 3) return 'bg-amber-500'
    if (newPassCount <= 4) return 'bg-blue-500'
    return 'bg-emerald-500'
  }, [newPassCount])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleForgotInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const { name, value } = e.target
    setForgotData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const email = formData.email.trim().toLowerCase()
    if (!email) return

    // Require symbol and minimum requirements on signup
    if (mode === 'signup') {
      if (!strengthChecks.length || !strengthChecks.upper || !strengthChecks.lower || !strengthChecks.number || !strengthChecks.symbol) {
        setError('Please meet all password strength requirements including at least one special symbol.')
        return
      }
    }

    setLoading(true)
    try {
      if (mode === 'signup') {
        const user = await signUp({
          email,
          password: formData.password,
          name: nameFromEmail(email),
        })
        signIn(user)
        router.push('/home')
      } else {
        const user = await signInWithCredentials({
          email,
          password: formData.password,
        })
        signIn(user)
        router.push('/home')
      }
    } catch (err: any) {
      const msg = err.message || 'Authentication failed'
      const match = msg.match(/"detail":"([^"]+)"/)
      if (match && match[1]) {
        setError(match[1])
      } else if (msg.includes('409')) {
        setError('An account already exists with this email address. Please sign in instead.')
      } else if (msg.includes('401')) {
        setError('Invalid email or password.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleForgotEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    const email = forgotData.email.trim().toLowerCase()
    const confirmEmail = forgotData.confirmEmail.trim().toLowerCase()

    if (!email || !confirmEmail) {
      setError('Please fill in both email fields.')
      return
    }

    // Prompt user to confirm their email address by inputting it again
    if (email !== confirmEmail) {
      setError('The email addresses you entered do not match. Please verify and confirm your email address.')
      return
    }

    setLoading(true)
    try {
      const res = await forgotPassword({ email, confirmEmail })
      setSuccessMessage(res.message || `A 6-digit verification code has been sent to ${email}.`)
      setAuthStep('forgot_code')
    } catch (err: any) {
      const msg = err.message || 'Failed to send verification code.'
      const match = msg.match(/"detail":"([^"]+)"/)
      setError(match && match[1] ? match[1] : msg)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    const email = forgotData.email.trim().toLowerCase()
    const code = forgotData.code.trim()
    const newPassword = forgotData.newPassword
    const confirmPassword = forgotData.confirmNewPassword

    if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
      setError('Please enter the valid 6-digit verification code sent to your email.')
      return
    }

    if (!newPassChecks.length || !newPassChecks.upper || !newPassChecks.lower || !newPassChecks.number || !newPassChecks.symbol) {
      setError('Please meet all password strength requirements including at least one special symbol.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match. Please verify and try again.')
      return
    }

    setLoading(true)
    try {
      const res = await resetPassword({ email, code, newPassword })
      setSuccessMessage(res.message || 'Password reset successful! Please sign in with your new password.')
      setFormData(prev => ({ ...prev, email: forgotData.email.trim(), password: '' }))
      setAuthStep('normal')
    } catch (err: any) {
      const msg = err.message || 'Failed to reset password.'
      const match = msg.match(/"detail":"([^"]+)"/)
      setError(match && match[1] ? match[1] : msg)
    } finally {
      setLoading(false)
    }
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
            onClick={() => {
              if (authStep !== 'normal') {
                setAuthStep('normal')
                setError(null)
                setSuccessMessage(null)
              } else {
                router.push('/')
              }
            }}
            aria-label="Back"
            className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background transition-all hover:bg-accent md:hidden"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>

          {/* Success Banner */}
          {successMessage && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div className="flex-1">
                <p className="font-medium">{successMessage}</p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="flex-1">
                <p className="font-medium">{error}</p>
                {error.includes('already exists') && mode === 'signup' && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      router.push('/signin')
                    }}
                    className="mt-2 inline-block font-semibold text-[var(--ember)] underline hover:opacity-80"
                  >
                    Click here to switch to Sign In &rarr;
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 1. STEP: CONFIRM EMAIL (Prompt user to input email twice) */}
          {authStep === 'forgot_email' && (
            <div>
              <div className="mb-8">
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('normal')
                    setError(null)
                    setSuccessMessage(null)
                  }}
                  className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to sign in</span>
                </button>
                <h1 className="mb-2 text-3xl font-bold text-foreground">
                  Reset password
                </h1>
                <p className="text-sm text-muted-foreground">
                  Confirm your email address below. We'll send a 6-digit verification code to reset your password.
                </p>
              </div>

              <form onSubmit={handleForgotEmailSubmit} className="space-y-5">
                <div>
                  <label htmlFor="forgot-email" className="mb-2 block text-sm font-medium text-foreground/80">
                    Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    name="email"
                    value={forgotData.email}
                    onChange={handleForgotInputChange}
                    placeholder="name@example.com"
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-[var(--ember)]"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="confirm-email" className="mb-2 block text-sm font-medium text-foreground/80">
                    Confirm Email Address
                  </label>
                  <input
                    id="confirm-email"
                    type="email"
                    name="confirmEmail"
                    value={forgotData.confirmEmail}
                    onChange={handleForgotInputChange}
                    placeholder="Re-enter your email address"
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-[var(--ember)]"
                    required
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Please confirm your email address so we know where to send your 6-digit code.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Sending code…' : 'Send 6-Digit Code'}
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('normal')
                      setError(null)
                      setSuccessMessage(null)
                    }}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Remember your password? <span className="font-medium text-[var(--ember)]">Sign in</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 2. STEP: ENTER 6-DIGIT CODE & NEW PASSWORD */}
          {authStep === 'forgot_code' && (
            <div>
              <div className="mb-8">
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('forgot_email')
                    setError(null)
                    setSuccessMessage(null)
                  }}
                  className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Change email</span>
                </button>
                <h1 className="mb-2 text-3xl font-bold text-foreground">
                  Verify & reset
                </h1>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to <strong className="text-foreground">{forgotData.email}</strong> and choose a new password.
                </p>
              </div>

              <form onSubmit={handleResetPasswordSubmit} className="space-y-5">
                {/* 6-Digit Code */}
                <div>
                  <label htmlFor="reset-code" className="mb-2 block text-sm font-medium text-foreground/80">
                    6-Digit Verification Code
                  </label>
                  <input
                    id="reset-code"
                    type="text"
                    name="code"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={forgotData.code}
                    onChange={handleForgotInputChange}
                    placeholder="123456"
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-foreground outline-none placeholder:tracking-normal placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-[var(--ember)]"
                    required
                  />
                </div>

                {/* New Password */}
                <div>
                  <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-foreground/80">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      name="newPassword"
                      value={forgotData.newPassword}
                      onChange={handleForgotInputChange}
                      placeholder="New password"
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 pr-12 text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-[var(--ember)]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-white/10"
                    >
                      {showNewPassword ? (
                        <EyeOff className="h-5 w-5 text-white/50" />
                      ) : (
                        <Eye className="h-5 w-5 text-white/50" />
                      )}
                    </button>
                  </div>

                  {/* Password Strength Indicator & Checklist (hidden until user starts typing) */}
                  {forgotData.newPassword.length > 0 && (
                    <div className="mt-3 space-y-2.5 rounded-xl border border-border/70 bg-background/50 p-3.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Password strength:</span>
                        <span className={`font-semibold ${newPassCount <= 2 ? 'text-red-400' : newPassCount <= 3 ? 'text-amber-400' : newPassCount <= 4 ? 'text-blue-400' : 'text-emerald-400'}`}>
                          {newPassLabel || 'Too short'}
                        </span>
                      </div>
                      <div className="flex h-1.5 w-full gap-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full transition-all duration-300 ${newPassColor}`}
                          style={{ width: `${Math.max(10, (newPassCount / 5) * 100)}%` }}
                        />
                      </div>

                      <ul className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
                        <li className={`flex items-center gap-1.5 ${newPassChecks.length ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {newPassChecks.length ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>At least 8 characters</span>
                        </li>
                        <li className={`flex items-center gap-1.5 ${newPassChecks.symbol ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {newPassChecks.symbol ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>Special symbol (!@#$)</span>
                        </li>
                        <li className={`flex items-center gap-1.5 ${newPassChecks.upper && newPassChecks.lower ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {newPassChecks.upper && newPassChecks.lower ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>Upper & lowercase</span>
                        </li>
                        <li className={`flex items-center gap-1.5 ${newPassChecks.number ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {newPassChecks.number ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>At least one number</span>
                        </li>
                      </ul>
                    </div>
                  )}
                </div>

                {/* Confirm New Password */}
                <div>
                  <label htmlFor="confirm-new-password" className="mb-2 block text-sm font-medium text-foreground/80">
                    Confirm New Password
                  </label>
                  <input
                    id="confirm-new-password"
                    type="password"
                    name="confirmNewPassword"
                    value={forgotData.confirmNewPassword}
                    onChange={handleForgotInputChange}
                    placeholder="Confirm new password"
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-[var(--ember)]"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Resetting password…' : 'Reset Password'}
                </button>

                <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={handleForgotEmailSubmit}
                    disabled={loading}
                    className="text-[var(--ember)] hover:underline"
                  >
                    Resend 6-digit code
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('normal')
                      setError(null)
                      setSuccessMessage(null)
                    }}
                    className="hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 3. STEP: NORMAL SIGN IN / SIGN UP FORM */}
          {authStep === 'normal' && (
            <div>
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

                  {/* Password Strength Indicator & Checklist (sign-up only — hidden until user starts typing) */}
                  {mode === 'signup' && formData.password.length > 0 && (
                    <div className="mt-3 space-y-2.5 rounded-xl border border-border/70 bg-background/50 p-3.5 text-xs">
                      {/* Strength Bar */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Password strength:</span>
                        <span className={`font-semibold ${passedCount <= 2 ? 'text-red-400' : passedCount <= 3 ? 'text-amber-400' : passedCount <= 4 ? 'text-blue-400' : 'text-emerald-400'}`}>
                          {strengthLabel || 'Too short'}
                        </span>
                      </div>
                      <div className="flex h-1.5 w-full gap-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full transition-all duration-300 ${strengthColor}`}
                          style={{ width: `${Math.max(10, (passedCount / 5) * 100)}%` }}
                        />
                      </div>

                      {/* Requirements Checklist */}
                      <ul className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
                        <li className={`flex items-center gap-1.5 ${strengthChecks.length ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {strengthChecks.length ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>At least 8 characters</span>
                        </li>
                        <li className={`flex items-center gap-1.5 ${strengthChecks.symbol ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {strengthChecks.symbol ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>Special symbol (!@#$)</span>
                        </li>
                        <li className={`flex items-center gap-1.5 ${strengthChecks.upper && strengthChecks.lower ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {strengthChecks.upper && strengthChecks.lower ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>Upper & lowercase</span>
                        </li>
                        <li className={`flex items-center gap-1.5 ${strengthChecks.number ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                          {strengthChecks.number ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                          <span>At least one number</span>
                        </li>
                      </ul>
                    </div>
                  )}
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
                      onClick={() => {
                        setError(null)
                        setSuccessMessage(null)
                        setForgotData({
                          email: formData.email,
                          confirmEmail: formData.email,
                          code: '',
                          newPassword: '',
                          confirmNewPassword: '',
                        })
                        setAuthStep('forgot_email')
                      }}
                      className="text-sm font-medium text-[var(--ember)] transition-opacity hover:opacity-80"
                    >
                      Forgot password?
                    </button>
                  </div>
                ) : null}

                {/* Submit — white pill, matching the app's button language */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Please wait…' : copy.submit}
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
                    {/* GitHub SVG */}
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
          )}
        </div>
      </div>
    </div>
  )
}
