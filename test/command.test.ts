import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchCommandScope } from '../src/command/match.js'
import { normalizeCommand } from '../src/command/normalize.js'

function normalized(value: string, platform: 'win32' | 'posix' = 'win32') {
  const result = normalizeCommand(value, platform)
  assert.ok(result.ok)
  return result.command
}

function unsafe(value: string, platform: 'win32' | 'posix' = 'win32') {
  const result = normalizeCommand(value, platform)
  assert.ok(result.ok)
  assert.equal(result.command.autoEligible, false)
  return result.command
}

describe('command normalisation', () => {
  it('collapses unquoted whitespace', () => {
    const command = normalized('  npm   test  ')
    assert.equal(command.text, 'npm test')
    assert.equal(command.autoEligible, true)
  })

  it('preserves whitespace inside quotes', () => {
    assert.equal(normalized('echo "a   b"').text, 'echo "a   b"')
    assert.equal(normalized("echo 'a  b'").text, "echo 'a  b'")
  })

  it('keeps quoted metacharacters from disabling auto-eligibility', () => {
    assert.equal(normalized('echo "a;b"').autoEligible, true)
    assert.equal(normalized('echo "a#b"').autoEligible, true)
  })

  it('flags multiline commands', () => {
    const command = unsafe('echo one\necho two')
    assert.ok(command.reasons.includes('multiline'))
  })

  it('flags control characters', () => {
    const command = unsafe('echo a\u0001b')
    assert.ok(command.reasons.includes('control-char'))
  })

  it('flags unbalanced quotes', () => {
    const command = unsafe('echo "unterminated')
    assert.ok(command.reasons.includes('unbalanced-quote'))
  })

  it('flags shell chaining and redirection', () => {
    for (const value of ['a; b', 'a && b', 'a || b', 'a | b', 'a & b']) {
      assert.ok(unsafe(value).reasons.includes('shell-meta'), value)
    }
    for (const value of ['a > b', 'a < b']) {
      assert.ok(unsafe(value).reasons.includes('redirection'), value)
    }
  })

  it('flags command substitution and variable expansion', () => {
    assert.ok(unsafe('echo `whoami`').reasons.includes('command-substitution'))
    assert.ok(unsafe('echo $(whoami)').reasons.includes('command-substitution'))
    assert.ok(unsafe('echo %PATH%').reasons.includes('variable-expansion'))
    assert.ok(unsafe('echo $env:PATH').reasons.includes('variable-expansion'))
  })

  it('flags delayed expansion, escapes, comments, wildcards, and splatting', () => {
    assert.ok(unsafe('echo !VAR!').reasons.includes('delayed-expansion'))
    assert.ok(unsafe('echo ^&').reasons.includes('escape-char'))
    assert.ok(unsafe('echo a # comment').reasons.includes('comment'))
    assert.ok(unsafe('del *.txt').reasons.includes('wildcard'))
    assert.ok(unsafe('Get-ChildItem @(').reasons.includes('splatting'))
    assert.ok(unsafe('cat ~/secrets').reasons.includes('path-expansion'))
  })

  it('flags interpreters and script files', () => {
    for (const value of [
      'powershell -c Get-Process',
      'pwsh -File build.ps1',
      'cmd /c dir',
      'bash -c id',
      'python script.py',
      'python3.11 -c "print(1)"',
      'node index.js',
    ]) {
      assert.ok(unsafe(value).reasons.includes('interpreter'), value)
    }
    assert.ok(unsafe('run.ps1').reasons.includes('script-file'))
    assert.ok(unsafe('deploy.cmd').reasons.includes('script-file'))
  })

  it('flags downloads, encoded commands, and dynamic evaluation', () => {
    assert.ok(unsafe('curl https://example.com/x').reasons.includes('download'))
    assert.ok(unsafe('git clone https://example.com/repo').reasons.includes('download'))
    assert.ok(unsafe('powershell -EncodedCommand AAAA').reasons.includes('encoded-command'))
    assert.ok(
      unsafe('powershell -e AAAAAAAAAAAAAAAAAAAAAAAAAAAA').reasons.includes('encoded-command'),
    )
    assert.ok(unsafe('iex (Get-Content x)').reasons.includes('invoke-expression'))
    assert.ok(unsafe('certutil -urlcache -f https://x y').reasons.includes('encoded-command'))
  })

  it('flags wrappers', () => {
    assert.ok(unsafe('Start-Process notepad').reasons.includes('wrapper'))
  })

  it('rejects empty, NUL, and over-long commands', () => {
    assert.equal(normalizeCommand('   ').ok, false)
    assert.equal(normalizeCommand('a\u0000b').ok, false)
    assert.equal(normalizeCommand('a'.repeat(3000)).ok, false)
  })

  it('handles POSIX backslash escapes conservatively', () => {
    const command = unsafe('echo a\\ b', 'posix')
    assert.ok(command.reasons.includes('backslash-escape'))
  })
})

describe('command scope matching', () => {
  it('matches the exact normalized command', () => {
    const match = matchCommandScope('  npm   test  ', ['npm test'])
    assert.equal(match.matched, true)
    assert.equal(match.index, 0)
  })

  it('does not match a different argument or different case', () => {
    assert.equal(matchCommandScope('npm test', ['npm run test']).matched, false)
    assert.equal(matchCommandScope('NPM test', ['npm test']).matched, false)
  })

  it('never matches an unsafe actual command, even if byte-identical', () => {
    const match = matchCommandScope('powershell -c id', ['powershell -c id'])
    assert.equal(match.matched, false)
    assert.equal(match.reason, 'unsafe-actual')
  })

  it('ignores an unsafe scope entry', () => {
    const match = matchCommandScope('echo hi', ['echo hi', 'bash -c id'])
    assert.equal(match.matched, true)
    assert.equal(match.index, 0)
  })

  it('skips an unsafe scope entry and still matches a safe later one', () => {
    const match = matchCommandScope('npm test', ['bash -c id', 'npm test'])
    assert.equal(match.matched, true)
    assert.equal(match.index, 1)
  })

  it('refuses an unsafe-only scope', () => {
    const match = matchCommandScope('echo hi', ['bash -c id'])
    assert.equal(match.matched, false)
    assert.equal(match.reason, 'unsafe-scope')
  })

  it('reports invalid actual and not-found cases', () => {
    assert.equal(matchCommandScope('   ', ['npm test']).reason, 'invalid-actual')
    assert.equal(matchCommandScope('npm test', ['pnpm test']).reason, 'not-found')
    assert.equal(matchCommandScope('npm test', []).reason, 'not-found')
  })
})
