import { useMemo, useState } from 'react'
import { Autocomplete, TextField, CircularProgress, Typography, Chip } from '@mui/material'
import { Package, Briefcase } from 'lucide-react'

export interface StandardCategoryOption {
  id: string
  name: string
  slug: string
  nameKey: string
  unspscCode: string | null
  offerType: string
  level: number
  parentId: string | null
}

interface CategoryMultiSelectProps {
  /** Selected category slugs (StandardCategory.slug) */
  value: string[]
  allCategories: StandardCategoryOption[]
  onChange: (slugs: string[]) => void
  loading?: boolean
  label?: string
  placeholder?: string
}

function buildLabel(cat: StandardCategoryOption, categories: StandardCategoryOption[]): string {
  const parts: string[] = [cat.name]
  let current = cat
  for (let i = 0; i < 3; i++) {
    if (!current.parentId) break
    const parent = categories.find(c => c.id === current.parentId)
    if (!parent) break
    parts.unshift(parent.name)
    current = parent
  }
  return parts.join(' › ')
}

export function CategoryMultiSelect({
  value, allCategories, onChange, loading = false,
  label = 'Search and select categories', placeholder = 'Type to search categories...',
}: CategoryMultiSelectProps) {
  const [inputValue, setInputValue] = useState('')

  const categoryLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const cat of allCategories) {
      map.set(cat.id, buildLabel(cat, allCategories))
    }
    return map
  }, [allCategories])

  const filteredOptions = useMemo(() => {
    if (!inputValue.trim()) return allCategories.slice(0, 50)
    const q = inputValue.toLowerCase()
    return allCategories.filter(cat => {
      const optLabel = categoryLabels.get(cat.id) ?? cat.name
      return optLabel.toLowerCase().includes(q) || cat.slug.toLowerCase().includes(q)
    }).slice(0, 50)
  }, [inputValue, allCategories, categoryLabels])

  const selectedOptions = useMemo(
    () => value.map(slug => allCategories.find(c => c.slug === slug)).filter((c): c is StandardCategoryOption => c !== undefined),
    [value, allCategories],
  )

  return (
    <Autocomplete<StandardCategoryOption, true>
      multiple
      options={filteredOptions}
      value={selectedOptions}
      onChange={(_, newValue) => onChange(newValue.map(c => c.slug))}
      inputValue={inputValue}
      onInputChange={(_, newInput) => setInputValue(newInput)}
      getOptionLabel={(option) => categoryLabels.get(option.id) ?? option.name}
      isOptionEqualToValue={(option, val) => option.slug === val.slug}
      loading={loading}
      disableCloseOnSelect
      filterOptions={(x) => x}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
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
        />
      )}
      renderOption={(props, option, { selected }) => {
        const optLabel = categoryLabels.get(option.id) ?? option.name
        const isService = option.offerType === 'SERVICE'
        return (
          <li {...props} key={option.id}>
            <div className="flex items-center gap-2 w-full py-0.5">
              <div
                className="flex items-center justify-center w-6 h-6 rounded shrink-0"
                style={{ background: isService ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)' }}
              >
                {isService
                  ? <Briefcase size={11} style={{ color: 'var(--color-primary-50)' }} />
                  : <Package size={11} style={{ color: 'var(--color-status-success)' }} />}
              </div>
              <div className="flex-1 min-w-0">
                <Typography variant="body2" fontWeight={500} noWrap>{optLabel}</Typography>
                {option.unspscCode && (
                  <Typography variant="caption" color="text.secondary">{option.unspscCode}</Typography>
                )}
              </div>
              {selected && (
                <Chip
                  label={isService ? 'Service' : 'Product'}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    bgcolor: isService ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)',
                    color: isService ? 'var(--color-primary-50)' : 'var(--color-status-success)',
                  }}
                />
              )}
            </div>
          </li>
        )
      }}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...rest } = getTagProps({ index })
          const tagLabel = categoryLabels.get(option.id) ?? option.name
          return (
            <Chip
              key={key}
              label={tagLabel}
              size="small"
              {...rest}
              sx={{ '& .MuiChip-label': { fontSize: '0.75rem', fontWeight: 500 } }}
            />
          )
        })
      }
      noOptionsText={
        <Typography variant="body2" color="text.secondary" className="p-2">
          No categories found
        </Typography>
      }
    />
  )
}
