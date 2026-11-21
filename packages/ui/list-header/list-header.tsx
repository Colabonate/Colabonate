/**
 * ListHeader – Wiederverwendbarer Listen-Header
 *
 * Kombiniert MUI Tabs (Filter-Navigation) mit optionalen Aktionen rechts
 * (View-Toggle, Sort-Button, etc.) in einer einzigen Zeile.
 * Der gesamte Bereich hat einen subtilen Surface-Background mit abgerundeten Ecken.
 *
 * UX-Rules (ui-ux-pro-max):
 * - touch-target-size: View-Buttons ≥ 44×44px (36px visual + 4px padding)
 * - state-clarity: Active toggle hat primary Hintergrund + weißen Icon
 * - cursor-pointer: Alle klickbaren Elemente
 * - spacing-scale: 4pt/8dp System
 * - color-semantic: Theme-Tokens (primary, action, background)
 *
 * Usage:
 * ```tsx
 * // Mit Tabs + integriertem View-Toggle
 * <ListHeader
 *   tabs={[{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }]}
 *   activeTab="all"
 *   onTabChange={setFilterTab}
 *   viewMode="gallery"
 *   onViewModeChange={setViewMode}
 * />
 *
 * // Mit Tabs + custom Actions
 * <ListHeader
 *   tabs={[...]}
 *   activeTab="all"
 *   onTabChange={setFilterTab}
 *   actions={[{ key: 'sort', element: <SortButton /> }]}
 *   viewMode="gallery"
 *   onViewModeChange={setViewMode}
 * />
 *
 * // Ohne Tabs (nur View-Toggle + Actions)
 * <ListHeader
 *   tabs={[]}
 *   activeTab=""
 *   onTabChange={() => {}}
 *   actions={[{ key: 'sort', element: <SortButton /> }]}
 *   viewMode="gallery"
 *   onViewModeChange={setViewMode}
 * />
 * ```
 */

import { Tabs, Tab, Stack, Box, ToggleButton, ToggleButtonGroup, Paper } from '@mui/material'
import { GridView as GridViewIcon, ViewList as ViewListIcon } from '@mui/icons-material'
import type { ListHeaderProps } from './list-header.types'

/** MUI Tabs sx – zentraler Stil */
const TABS_SX = {
  minHeight: 44,
  flex: 1,
  '& .MuiTabs-scrollButtons': {
    width: 32,
    minHeight: 32,
  },
  '& .MuiTab-root': {
    minWidth: 'auto',
    px: 2.5,
    py: 1,
    minHeight: 44,
    fontSize: 13,
    fontWeight: 500,
    textTransform: 'none' as const,
    color: 'text.secondary',
    transition: 'color 200ms ease',
    '&:hover': {
      color: 'text.primary',
    },
  },
  '& .MuiTab-root.Mui-selected': {
    color: 'primary.main',
    fontWeight: 600,
  },
  '& .MuiTabs-indicator': {
    bgcolor: 'primary.main',
    borderRadius: '3px 3px 0 0',
    height: 3,
  },
} as const

/** View-Toggle Button sx – 44px Touch Target */
const VIEW_TOGGLE_BUTTON_SX = {
  border: 'none',
  minWidth: 36,
  minHeight: 36,
  p: 0.5,
  borderRadius: 2,
  color: 'text.secondary',
  '&.Mui-selected': {
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    '&:hover': {
      bgcolor: 'primary.dark',
    },
  },
  '&:not(.Mui-selected):hover': {
    bgcolor: 'action.hover',
  },
} as const

export function ListHeader({
  tabs,
  activeTab,
  onTabChange,
  actions,
  mt,
  mb,
  viewMode,
  onViewModeChange,
  searchSlot,
  sortSlot,
  rightSlot,
  resultCount,
  resultLabel,
}: ListHeaderProps) {
  const hasTabs = tabs.length > 0
  const showViewToggle = viewMode !== undefined && onViewModeChange !== undefined
  const hasSlots = searchSlot !== undefined || sortSlot !== undefined || rightSlot !== undefined || resultCount !== undefined
  const hasActions = (actions && actions.length > 0) || showViewToggle || hasSlots

  return (
    <Paper
      variant="outlined"
      elevation={0}
      sx={{
        mt,
        mb,
        px: 1.5,
        py: 0.5,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        bgcolor: 'background.paper',
        borderColor: 'divider',
        borderRadius: 3,
      }}
    >
      {/* Tabs */}
      {hasTabs ? (
        <Tabs
          value={activeTab}
          onChange={(_, v: string) => onTabChange(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={TABS_SX}
        >
          {tabs.map(tab => (
            <Tab key={tab.key} value={tab.key} label={tab.label} />
          ))}
        </Tabs>
      ) : (
        <Box sx={{ flex: 1 }} />
      )}

      {/* Actions + View Toggle + Legacy Slots */}
      {hasActions && (
        <Stack direction="row" alignItems="center" flexWrap="wrap" spacing={1} sx={{ flexShrink: 1, minWidth: 0, rowGap: 0.5 }}>
          {/* Legacy search / sort / result slots */}
          {searchSlot && <Box sx={{ flex: 1, minWidth: 160 }}>{searchSlot}</Box>}
          {sortSlot && <Box>{sortSlot}</Box>}
          {resultCount !== undefined && resultLabel && (
            <Box sx={{ typography: 'body2', color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {resultCount} {resultLabel}
            </Box>
          )}

          {/* Custom Actions (Sort, etc.) */}
          {actions?.map(action => (
            <Box key={action.key}>{action.element}</Box>
          ))}

          {/* Integrierter View-Toggle */}
          {showViewToggle && (
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, v) => v && onViewModeChange(v)}
              size="small"
              aria-label="View mode"
              sx={{
                bgcolor: 'action.hover',
                borderRadius: 2,
                gap: 0.5,
                p: 0.25,
              }}
            >
              <ToggleButton value="gallery" aria-label="Gallery view" sx={VIEW_TOGGLE_BUTTON_SX}>
                <GridViewIcon sx={{ fontSize: 18 }} />
              </ToggleButton>
              <ToggleButton value="list" aria-label="List view" sx={VIEW_TOGGLE_BUTTON_SX}>
                <ViewListIcon sx={{ fontSize: 18 }} />
              </ToggleButton>
            </ToggleButtonGroup>
          )}

          {rightSlot && <Box>{rightSlot}</Box>}
        </Stack>
      )}
    </Paper>
  )
}
