// ADR-377 Phase 2 (FU-704): shared setup for component tests. Imported
// explicitly per test file (not a global vitest setupFile) so it never loads
// for the existing node-environment test suite — see each *.test.tsx file's
// `// @vitest-environment jsdom` pragma.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
