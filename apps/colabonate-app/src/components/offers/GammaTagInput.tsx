// ADR-277 E1: seller-entered Gamma `t` tags (the flat, emergent second axis —
// D1/D3). freeSolo Autocomplete: any tag is valid, the two suggestion lists
// (`popular` = live-corpus frequency, `suggested` = the D3 seed map for the
// offer's chosen category) are a starting point, never a constraint.
import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, TextField, Chip, Typography, CircularProgress } from '@mui/material'
import { normalizeGammaTag, normalizeGammaTags } from '@col/nostr-schema'
import { apiCall } from '../../lib/api'

interface GammaTagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  /** The offer's current standard categoryCode, used to fetch D3 seed suggestions. */
  categoryCode?: string
  label?: string
  helperText?: string
}

export function GammaTagInput({
  value,
  onChange,
  categoryCode,
  label = 'Gamma tags',
  helperText = 'Free-form tags other Nostr marketplace clients (Gamma/NIP-99) use to find your listing. Add your own — these suggestions are just a starting point.',
}: GammaTagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [popular, setPopular] = useState<string[]>([])
  const [suggested, setSuggested] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const qs = categoryCode ? `?categoryCode=${encodeURIComponent(categoryCode)}` : ''
    apiCall(`/api/gamma-tags${qs}`)
      .then(res => res.json())
      .then((data: { popular?: string[]; suggested?: string[] }) => {
        if (cancelled) return
        setPopular(Array.isArray(data.popular) ? data.popular : [])
        setSuggested(Array.isArray(data.suggested) ? data.suggested : [])
      })
      .catch(() => { /* suggestions are a nicety, not load-bearing */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [categoryCode])

  const options = useMemo(() => {
    // D3 seed suggestions for the chosen category float to the top.
    const merged = [...suggested, ...popular]
    const seen = new Set<string>()
    return merged.filter(t => {
      if (seen.has(t) || value.includes(t)) return false
      seen.add(t)
      return true
    })
  }, [suggested, popular, value])

  function commit(next: string[]) {
    onChange(normalizeGammaTags(next))
  }

  return (
    <Autocomplete<string, true, false, true>
      multiple
      freeSolo
      options={options}
      value={value}
      inputValue={inputValue}
      onInputChange={(_, newInput) => setInputValue(newInput)}
      onChange={(_, newValue) => commit(newValue)}
      loading={loading}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim().toLowerCase()
        return q ? opts.filter(o => o.toLowerCase().includes(q)) : opts.slice(0, 20)
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length === 0 ? 'e.g. electronics, bitcoin' : ''}
          helperText={helperText}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
          onKeyDown={(e) => {
            // Comma commits a tag too, since sellers naturally type "a, b, c".
            if (e.key === ',' && inputValue.trim()) {
              e.preventDefault()
              const tag = normalizeGammaTag(inputValue)
              if (tag && !value.includes(tag)) commit([...value, tag])
              setInputValue('')
            }
          }}
        />
      )}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((tag, index) => {
          const { key, ...rest } = getTagProps({ index })
          return (
            <Chip
              key={key}
              label={tag}
              size="small"
              {...rest}
              sx={{ '& .MuiChip-label': { fontSize: '0.75rem', fontWeight: 500 } }}
            />
          )
        })
      }
      renderOption={(props, option) => (
        <li {...props} key={option}>
          <Typography variant="body2">{option}</Typography>
          {suggested.includes(option) && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>suggested</Typography>
          )}
        </li>
      )}
      noOptionsText={
        <Typography variant="body2" color="text.secondary" className="p-2">
          Type and press Enter to add a tag
        </Typography>
      }
    />
  )
}
