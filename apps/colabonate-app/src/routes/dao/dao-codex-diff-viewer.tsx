import { useState, useEffect } from 'react'
import { diffLines, type Change } from 'diff'
import { FileText, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'

interface CodexDiffViewerProps {
  codexUrl: string
  newCodexUrl: string
}

export function CodexDiffViewer({ codexUrl, newCodexUrl }: CodexDiffViewerProps) {
  const [oldContent, setOldContent] = useState<string | null>(null)
  const [newContent, setNewContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function fetchContent(url: string): Promise<string> {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
      return res.text()
    }

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [old, updated] = await Promise.all([
          fetchContent(codexUrl),
          fetchContent(newCodexUrl),
        ])
        if (!cancelled) {
          setOldContent(old)
          setNewContent(updated)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load codex content')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [codexUrl, newCodexUrl])

  if (loading) {
    return (
      <div
        className="mt-4 p-4 rounded-lg"
        style={{
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-surface-secondary)',
        }}
      >
        <h4
          className="text-[13px] font-semibold mb-3 flex items-center gap-2"
          style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          <FileText size={14} />
          Codex Diff
        </h4>
        <div
          className="flex items-center justify-center py-8"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <div
            className="w-8 h-8 rounded-full border-3 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
          />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="mt-4 p-4 rounded-lg"
        style={{
          border: '1px solid rgba(245,101,101,0.3)',
          background: 'rgba(245,101,101,0.06)',
        }}
      >
        <h4
          className="text-[13px] font-semibold mb-2 flex items-center gap-2"
          style={{ color: 'var(--color-status-error)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          <AlertTriangle size={14} />
          Codex Diff — Failed to Load
        </h4>
        <p className="text-[11px]" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
          {error}. The diff requires both the current and proposed codex to be accessible via their URLs.
        </p>
      </div>
    )
  }

  if (oldContent === null || newContent === null) return null

  const changes = diffLines(oldContent, newContent)
  const addedLines = changes.filter(c => c.added).reduce((sum, c) => sum + c.count, 0) ?? 0
  const removedLines = changes.filter(c => c.removed).reduce((sum, c) => sum + c.count, 0) ?? 0

  return (
    <div
      className="mt-4 rounded-lg overflow-hidden"
      style={{
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-surface-secondary)',
      }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-4 cursor-pointer"
        style={{ background: 'transparent' }}
      >
        <h4
          className="text-[13px] font-semibold flex items-center gap-2"
          style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          <FileText size={14} />
          Codex Diff
          <span className="text-[10px] font-normal ml-2" style={{ color: 'var(--theme-text-muted)' }}>
            +{addedLines} / -{removedLines} lines
          </span>
        </h4>
        {collapsed ? (
          <ChevronDown size={14} style={{ color: 'var(--theme-text-muted)' }} />
        ) : (
          <ChevronUp size={14} style={{ color: 'var(--theme-text-muted)' }} />
        )}
      </button>

      {!collapsed && (
        <div
          className="px-4 pb-4 overflow-x-auto"
          style={{ fontFamily: 'var(--typography-fontfamily-mono, monospace)' }}
        >
          <pre className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--theme-text)' }}>
            {changes.map((change: Change, i: number) => {
              if (change.added) {
                return (
                  <span key={i} style={{ background: 'rgba(72,187,120,0.15)', color: 'var(--color-status-success)' }}>
                    {change.value.split('\n').map((line, j) => (
                      <span key={j}>
                        {'+'}{line}
                        {j < change.value.split('\n').length - 1 ? '\n' : ''}
                      </span>
                    ))}
                  </span>
                )
              }
              if (change.removed) {
                return (
                  <span key={i} style={{ background: 'rgba(245,101,101,0.12)', color: 'var(--color-status-error)' }}>
                    {change.value.split('\n').map((line, j) => (
                      <span key={j}>
                        {'-'}{line}
                        {j < change.value.split('\n').length - 1 ? '\n' : ''}
                      </span>
                    ))}
                  </span>
                )
              }
              return (
                <span key={i} style={{ color: 'var(--theme-text-muted)' }}>
                  {change.value.split('\n').map((line, j) => (
                    <span key={j}>
                      {' '}{line}
                      {j < change.value.split('\n').length - 1 ? '\n' : ''}
                    </span>
                  ))}
                </span>
              )
            })}
          </pre>
        </div>
      )}
    </div>
  )
}
