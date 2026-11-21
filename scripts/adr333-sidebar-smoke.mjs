// ADR-333 live smoke (V2): marketplace sidebar toggle group renders with the
// Save-current-filter action as a subdued fifth button (divider + tooltip,
// no position badges), default panels (Locations/Categories/Agent Filters)
// stack in order, Images hidden, toggling works, built-in taxonomy panel
// gone, coop context untouched. Run: node scripts/adr333-sidebar-smoke.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const results = []
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`) }

// V2: the save action is icon-only (aria-label/title, no visible text), so
// locate the sidebar by containing that button instead of by text.
const sidebar = (page) => page.locator('.sticky').filter({ has: page.locator('button[aria-label="Save current filter"]') }).first()

try {
  await page.goto(`${BASE}/search?context=marketplace`, { waitUntil: 'networkidle', timeout: 45000 })
  const sb = sidebar(page)

  // Wait for React render before count() — count() does not auto-wait.
  await sb.locator('button[title="Locations"]').waitFor({ timeout: 10000 })

  // 1. Toggle group: exactly 4 titled icon-toggle buttons (save button has no aria-pressed)
  check('toggle group renders exactly 4 icon buttons', await sb.locator('button[aria-pressed][title]').count() === 4)

  // 2. Default pressed states
  const pressed = async (title) => await sb.locator(`button[title="${title}"]`).getAttribute('aria-pressed')
  check('Locations enabled by default', (await pressed('Locations')) === 'true')
  check('Images disabled by default', (await pressed('Images')) === 'false')
  check('Categories enabled by default', (await pressed('Categories')) === 'true')
  check('Agent Filters enabled by default', (await pressed('Agent Filters')) === 'true')

  // 3. V2: save action integrated as subdued fifth button with tooltip
  const saveBtn = sb.locator('button[aria-label="Save current filter"]')
  check('Save-current-filter action button present in group', await saveBtn.count() === 1)
  check('Save button has tooltip', (await saveBtn.getAttribute('title')) === 'Save current filter')
  check('Save button is an action, not a toggle', (await saveBtn.getAttribute('aria-pressed')) === null)
  check('no legacy text save button rendered', await sb.getByText('Save current filter', { exact: true }).count() === 0)

  // 4. V2: no position-number badges on the toggle buttons
  check('no position-number badges', await sb.locator('button[aria-pressed][title] span').count() === 0)

  // 5. Ordered stack via vertical positions of the panel headers
  const headerY = async (text) => (await sb.getByText(text, { exact: true }).first().boundingBox())?.y ?? -1
  const yLoc = await headerY('Location')
  const yCat = await headerY('Categories')
  const yAgent = await headerY('Agent Filters')
  check('Location header present', yLoc >= 0)
  check('Categories header present', yCat >= 0)
  check('Agent Filters header present', yAgent >= 0)
  check('click order = Locations above Categories above Agent Filters', yLoc >= 0 && yCat > yLoc && yAgent > yCat)
  check('Images panel hidden initially', await sb.getByText('Hide items without images').count() === 0)

  // 5b. V3: tight spacing below the toggle group + exactly one divider per boundary.
  // Sidebar direct children with a solid top border = the panel dividers
  // (toggle group + chips use bottom borders, children draw none of their own).
  // 3 rendered panels ⇒ exactly 2 stack dividers.
  const groupBottom = (await sb.locator('button[title="Agent Filters"]').boundingBox()).y + 26
  const gapToFirst = yLoc - groupBottom
  check('first panel sits tight below toggle group (<= 16px)', gapToFirst >= 0 && gapToFirst <= 16)
  const stackDividers = await sb.locator('div[data-lenis-prevent]').first().evaluate(root =>
    Array.from(root.children).filter(el =>
      el instanceof HTMLElement
      && getComputedStyle(el).borderTopStyle === 'solid'
      && getComputedStyle(el).borderTopWidth === '1px',
    ).length,
  )
  check('exactly one divider between each pair of panels (2 for 3 panels)', stackDividers === 2)
  const agentDivider = await sb.locator('div[data-lenis-prevent]').first().evaluate(root => {
    // Tailwind preflight gives every element border-style: solid + width 0,
    // so "has a divider" must be judged by border-top WIDTH, not style.
    const el = Array.from(root.querySelectorAll('div'))
      .find(d => d.textContent?.trim().startsWith('Agent Filters') && d.className.includes('flex-col'))
    return el ? getComputedStyle(el).borderTopWidth !== '0px' : null
  })
  check('AgentFilterPanel draws no own top divider in stack', agentDivider === false)

  // 6. Toggle Images on → appends at end of stack
  await sb.locator('button[title="Images"]').click()
  await sb.getByText('Hide items without images').waitFor({ timeout: 5000 })
  check('Images panel appears after enabling', true)
  const yImg = (await sb.getByText('Hide items without images').first().boundingBox())?.y ?? -1
  check('Images appended at bottom of stack', yImg > yAgent)

  // 7. Toggle Locations off → panel disappears, stack compacts
  await sb.locator('button[title="Locations"]').click()
  await sb.getByText('Location', { exact: true }).waitFor({ state: 'detached', timeout: 5000 })
  check('Location panel removed after disabling', true)
  check('Categories still present after Locations off', await sb.getByText('Categories', { exact: true }).count() === 1)

  // 8. Persistence within session (reload keeps sessionStorage state)
  await page.reload({ waitUntil: 'networkidle' })
  const sb2 = sidebar(page)
  await sb2.getByText('Hide items without images').waitFor({ timeout: 10000 })
  check('panel state survives reload (sessionStorage)',
    await sb2.getByText('Location', { exact: true }).count() === 0)

  // 9. Coop context unaffected: no toggle group
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const coopToggles = await page.locator('button[aria-pressed][title="Locations"], button[aria-pressed][title="Agent Filters"]').count()
  check('coop context shows no toggle group', coopToggles === 0)
} catch (err) {
  console.error('ERROR:', err.message)
  results.push({ name: 'no exception', ok: false })
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
