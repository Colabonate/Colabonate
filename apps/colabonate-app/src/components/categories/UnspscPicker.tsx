import { useState, useMemo } from 'react'
import { Autocomplete, TextField, CircularProgress, Typography } from '@mui/material'
import { Tag } from 'lucide-react'

interface UnspscCategory {
  id: string
  unspscCode: string
  name: string
  offerType?: string
  subcategories?: UnspscCategory[]
}

interface UnspscOption {
  unspscCode: string
  unspscLabel: string
  fullLabel: string
}

const UNSPSC_DATA: UnspscCategory[] = [
  {
    id: 'goods',
    unspscCode: '31000000',
    name: 'Goods',
    offerType: 'PRODUCT',
    subcategories: [
      { id: 'electronics', unspscCode: '52160000', name: 'Electronics' },
      { id: 'clothing', unspscCode: '53100000', name: 'Clothing & Fashion' },
      { id: 'home', unspscCode: '56000000', name: 'Home & Garden' },
      { id: 'food', unspscCode: '50000000', name: 'Food & Beverages' },
    ],
  },
  {
    id: 'digital',
    unspscCode: '43230000',
    name: 'Digital',
    offerType: 'PRODUCT',
    subcategories: [
      { id: 'software', unspscCode: '43230000', name: 'Software & Apps' },
      { id: 'media', unspscCode: '55000000', name: 'Digital Media' },
      { id: 'templates', unspscCode: '82000000', name: 'Templates & Designs' },
      { id: 'courses', unspscCode: '86000000', name: 'Online Courses' },
    ],
  },
  {
    id: 'services',
    unspscCode: '80000000',
    name: 'Services',
    offerType: 'SERVICE',
    subcategories: [
      { id: 'consulting', unspscCode: '80000000', name: 'Consulting & Advisory' },
      { id: 'development', unspscCode: '43230000', name: 'Development & Engineering' },
      { id: 'design', unspscCode: '82000000', name: 'Design & Creative' },
      { id: 'education', unspscCode: '86000000', name: 'Education & Training' },
    ],
  },
  {
    id: 'cooperation',
    unspscCode: '80000000',
    name: 'Cooperation',
    offerType: 'SERVICE',
    subcategories: [
      { id: 'projects', unspscCode: '80000000', name: 'Joint Projects' },
      { id: 'networks', unspscCode: '80000000', name: 'Professional Networks' },
      { id: 'partnerships', unspscCode: '80000000', name: 'Business Partnerships' },
    ],
  },
]

function buildFlatList(categories: UnspscCategory[]): UnspscOption[] {
  const options: UnspscOption[] = []
  for (const cat of categories) {
    options.push({
      unspscCode: cat.unspscCode,
      unspscLabel: cat.name,
      fullLabel: cat.name,
    })
    if (cat.subcategories) {
      for (const sub of cat.subcategories) {
        options.push({
          unspscCode: sub.unspscCode,
          unspscLabel: sub.name,
          fullLabel: `${cat.name} › ${sub.name}`,
        })
      }
    }
  }
  return options
}

const FLAT_UNSPSC = buildFlatList(UNSPSC_DATA)

export interface UnspscPickerValue {
  unspscCode: string
  unspscLabel: string
}

interface UnspscPickerProps {
  value: UnspscPickerValue | null
  onChange: (value: UnspscPickerValue | null) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  error?: boolean
  helperText?: string
}

export function UnspscPicker({
  value,
  onChange,
  label = 'UNSPSC Category',
  placeholder = 'Search UNSPSC categories...',
  disabled = false,
  error = false,
  helperText,
}: UnspscPickerProps) {
  const [inputValue, setInputValue] = useState('')

  const selectedOption = useMemo(() => {
    if (!value?.unspscCode) return null
    return FLAT_UNSPSC.find(
      (opt) => opt.unspscCode === value.unspscCode && opt.unspscLabel === value.unspscLabel
    ) ?? null
  }, [value])

  const filteredOptions = useMemo(() => {
    if (!inputValue.trim()) return FLAT_UNSPSC.slice(0, 20)
    const q = inputValue.toLowerCase()
    return FLAT_UNSPSC.filter(
      (opt) =>
        opt.unspscLabel.toLowerCase().includes(q) ||
        opt.unspscCode.includes(q) ||
        opt.fullLabel.toLowerCase().includes(q)
    ).slice(0, 30)
  }, [inputValue])

  return (
    <Autocomplete<UnspscOption, false, undefined, true>
      value={selectedOption}
      onChange={(_, newValue) => {
        if (!newValue || typeof newValue === 'string') {
          onChange(null)
          return
        }
        onChange({
          unspscCode: newValue.unspscCode,
          unspscLabel: newValue.unspscLabel,
        })
      }}
      inputValue={inputValue}
      onInputChange={(_, newValue) => setInputValue(newValue)}
      options={filteredOptions}
      disabled={disabled}
      getOptionLabel={(option) => typeof option === 'string' ? option : `${option.unspscCode} – ${option.unspscLabel}`}
      isOptionEqualToValue={(option, val) =>
        typeof option === 'string' || typeof val === 'string'
          ? option === val
          : option.unspscCode === val.unspscCode && option.unspscLabel === val.unspscLabel
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          error={error}
          helperText={helperText}
          slotProps={{
            input: {
              ...params.InputProps,
              startAdornment: (
                <>
                  <Tag size={14} className="mr-1 text-[var(--theme-text-muted)]" />
                  {params.InputProps.startAdornment}
                </>
              ),
            },
          }}
        />
      )}
      renderOption={(props, option) => (
        <li {...props} key={`${option.unspscCode}-${option.unspscLabel}`}>
          <div className="flex flex-col">
            <Typography variant="body2" fontWeight={500}>
              {option.unspscLabel}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {option.unspscCode}
              {option.fullLabel.includes('›') && ` · ${option.fullLabel}`}
            </Typography>
          </div>
        </li>
      )}
      loadingText={<CircularProgress size={16} />}
      noOptionsText={
        <Typography variant="body2" color="text.secondary" className="p-2">
          No UNSPSC categories found
        </Typography>
      }
    />
  )
}

export { UNSPSC_DATA, FLAT_UNSPSC }
