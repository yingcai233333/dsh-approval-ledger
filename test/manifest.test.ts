import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  version: string
  main: string
  files: string[]
  engines: Record<string, string>
  dsh?: { compatibility?: { dshReleases?: Record<string, string> } }
  dshhub?: { compatibility?: Record<string, string> }
}

// The installer reads `engines.dsh` and nothing else, so this range is the
// actual gate. `<0.3.0` would not stop `0.3.0-rc.1` under includePrerelease and
// `>=0.2.1-rc.2-0` rejects `0.2.1-rc.2` itself; both mistakes are silent.
const DSH_RANGE = '>=0.2.1-rc.2 <0.3.0-0'

describe('package manifest', () => {
  it('gates DSH through engines.dsh with the pinned range', () => {
    assert.equal(manifest.engines.dsh, DSH_RANGE)
  })

  it('keeps the market declaration on the same range as the gate', () => {
    assert.equal(manifest.dshhub?.compatibility?.dsh, DSH_RANGE)
  })

  it('keeps dshReleases descriptive but in sync with the target release', () => {
    assert.deepEqual(manifest.dsh?.compatibility?.dshReleases, {
      '0.2.1-rc.2': 'compatible',
      '0.2.1-rc.3': 'compatible',
      '0.2.1-rc.5': 'compatible',
    })
  })

  it('ships the built entry point and the client half', () => {
    assert.equal(manifest.main, 'lib/index.js')
    assert.ok(manifest.files.includes('lib'))
    assert.ok(manifest.files.includes('client.js'))
    assert.ok(manifest.files.includes('schema'))
  })
})
