import { describe, it, expect, vi } from 'vitest'
import { dispatchCriticalAlert, logCritical } from './critical-alert.js'

describe('dispatchCriticalAlert (ADR-252 D7 / FU-252-A)', () => {
  it('reports not-configured and never calls the sender when env is missing', async () => {
    const send = vi.fn(async () => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await dispatchCriticalAlert('test', 'hello', send, {})
    expect(r).toEqual({ configured: false, sent: false })
    expect(send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('sends with the configured recipient and default from-address', async () => {
    const send = vi.fn(async () => {})
    const r = await dispatchCriticalAlert('escrow', 'settle-then-crash', send, {
      RESEND_API_KEY: 're_test',
      CRITICAL_ALERT_EMAIL: 'oncall@example.test',
    })
    expect(r).toEqual({ configured: true, sent: true, to: 'oncall@example.test' })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'oncall@example.test',
        subject: '[Colabonate CRITICAL] escrow',
        text: 'settle-then-crash',
        from: 'Colabonate Team <noreply@agantila.com>',
      }),
    )
  })

  it('honours RESEND_FROM_EMAIL', async () => {
    const send = vi.fn(async () => {})
    await dispatchCriticalAlert('x', 'y', send, {
      RESEND_API_KEY: 're_test', CRITICAL_ALERT_EMAIL: 'a@b.test', RESEND_FROM_EMAIL: 'Ops <ops@b.test>',
    })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'Ops <ops@b.test>' }))
  })

  it('never throws when the provider fails — returns sent:false with the error', async () => {
    const send = vi.fn(async () => { throw new Error('resend down') })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await dispatchCriticalAlert('x', 'y', send, { RESEND_API_KEY: 'k', CRITICAL_ALERT_EMAIL: 'a@b.test' })
    expect(r).toEqual({ configured: true, sent: false, to: 'a@b.test', error: 'resend down' })
    error.mockRestore()
  })

  it('logCritical always writes the console.error line (Loki contract) and does not throw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => logCritical('escrow', 'boom')).not.toThrow()
    expect(error).toHaveBeenCalledWith('[escrow] CRITICAL: boom')
    error.mockRestore()
    warn.mockRestore()
  })
})
