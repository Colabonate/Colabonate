import { AppLogo } from './branding/AppLogo'
import { LoginTabs } from './login/LoginTabs'

export function LoginCard() {
  return (
    <div
      className="rounded-2xl overflow-hidden h-full"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div
        className="h-1 w-full"
        style={{ background: 'linear-gradient(90deg, var(--color-primary-50), var(--color-secondary-50), var(--color-accent-2))' }}
      />

      <div className="p-5">
        <div className="flex items-center justify-center mb-4">
          <AppLogo brand="colabonate" height={28} />
        </div>

        <LoginTabs embedded={true} />
      </div>
    </div>
  )
}