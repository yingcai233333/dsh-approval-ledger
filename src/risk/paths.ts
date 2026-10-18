import { maxRisk } from '../core/types.js'
import type { RiskLevel, RiskReason } from '../core/types.js'
import { isPathWithin } from '../path/match.js'
import type { NormalizedPath } from '../path/types.js'

export interface PathRiskContext {
  cwd?: NormalizedPath
}

export interface PathRisk {
  level: RiskLevel
  reasons: RiskReason[]
}

const CREDENTIAL_DIRS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
  '.docker',
])

const CREDENTIAL_NAMES = new Set([
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.git-credentials',
  '.htpasswd',
  '.my.cnf',
  'credentials',
  'credentials.json',
  'credentials.txt',
  'credentials.yaml',
  'secrets.json',
  'secrets.txt',
  'secrets.yml',
  'secrets.yaml',
  'passwords',
  'passwords.txt',
  'passwd',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'kubeconfig',
  'terraform.tfstate',
  'wallet.dat',
  'wallet.json',
  'token',
  'token.json',
  'tokens.json',
  'auth.json',
  'auth.yml',
  'auth.yaml',
  'cookie',
  'cookies',
  'cookies.txt',
])

const CREDENTIAL_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.pfx',
  '.p12',
  '.kdbx',
  '.keystore',
  '.jks',
  '.ovpn',
  '.mobileprovision',
  '.gpg',
  '.tfstate',
])

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.psm1',
  '.psd1',
  '.bat',
  '.cmd',
  '.vbs',
  '.vbe',
  '.lua',
  '.sql',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
  '.astro',
  '.tf',
  '.tfvars',
  '.hcl',
  '.nix',
  '.dart',
  '.scala',
  '.clj',
  '.ex',
  '.exs',
  '.erl',
  '.fs',
  '.fsx',
])

const CONFIG_EXTENSIONS = new Set([
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.conf',
  '.config',
  '.cfg',
  '.properties',
  '.env',
  '.xml',
  '.plist',
  '.lock',
  '.npmrc',
  '.nvmrc',
  '.gitignore',
  '.dockerignore',
])

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.msi',
  '.scr',
  '.so',
  '.dylib',
  '.bin',
  '.com',
  '.apk',
  '.deb',
  '.rpm',
  '.dmg',
  '.pkg',
  '.jar',
  '.war',
  '.ear',
])

const DATA_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.csv',
  '.tsv',
  '.log',
  '.json',
  '.jsonl',
  '.ndjson',
  '.map',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
])

const DOC_NAMES = new Set([
  'readme',
  'license',
  'licence',
  'changelog',
  'notice',
  'authors',
  'contributors',
  'copying',
  'todo',
])

const CONFIG_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'config.json',
  'settings.json',
  'appsettings.json',
  'launch.json',
  'tasks.json',
  'extensions.json',
  'keybindings.json',
  'manifest.json',
  'renovate.json',
  'angular.json',
  'workspace.json',
  'now.json',
  'vercel.json',
  'cargo.toml',
  'cargo.lock',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
  'go.mod',
  'go.sum',
  'composer.json',
  'composer.lock',
  'gemfile',
  'gemfile.lock',
  'makefile',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'justfile',
  'procfile',
  'rakefile',
  'jenkinsfile',
  'build.gradle',
  'settings.gradle',
  'gradle.properties',
  'pom.xml',
  'netlify.toml',
  'fly.toml',
  'railway.json',
])

const INSTRUCTION_NAMES = new Set([
  'agents.md',
  'claude.md',
  'gemini.md',
  '.cursorrules',
  '.windsurfrules',
  'copilot-instructions.md',
  'system-prompt.md',
])

const WORKSPACE_CONFIG_DIRS = new Set([
  '.vscode',
  '.idea',
  '.husky',
  '.devcontainer',
  '.github',
  'node_modules',
  'schema',
])

function add(reasonList: RiskReason[], code: string, level: RiskLevel, message: string): void {
  reasonList.push({ code, level, message })
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

function components(path: string): string[] {
  return path
    .split(/[\\/]/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase())
}

function isDshConfig(target: NormalizedPath): boolean {
  if (components(target.path).includes('.dsh')) return true
  const name = baseName(target.path)
  return (
    name === 'cordis.patch.yml' ||
    name === 'cordis.yml' ||
    name === 'cordis.yaml' ||
    name === 'dsh.yml' ||
    name === 'dsh.yaml' ||
    name === 'dsh-profile.yml' ||
    name === 'dsh-profile.yaml'
  )
}

function isVcsInternal(target: NormalizedPath): boolean {
  return components(target.path).includes('.git')
}

function isCiWorkflow(target: NormalizedPath): boolean {
  const parts = components(target.path)
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === '.github' && parts[index + 1] === 'workflows') return true
  }
  return false
}

function isCredentialPath(target: NormalizedPath): boolean {
  const parts = components(target.path)
  if (parts.some((part) => CREDENTIAL_DIRS.has(part))) return true
  const name = baseName(target.path)
  if (CREDENTIAL_NAMES.has(name)) return true
  if (name.startsWith('.env') || name.endsWith('.env')) return true
  if (CREDENTIAL_EXTENSIONS.has(extensionOf(name))) return true
  return false
}

function isSystemPath(target: NormalizedPath): boolean {
  if (target.platform === 'win32') {
    const key = target.key
    if (/^[a-z]:\\$/.test(key)) return true
    if (
      /^[a-z]:\\(windows|program files|program files \(x86\)|programdata|boot|recovery|system volume information|\$recycle\.bin|perflogs)(\\|$)/.test(
        key,
      )
    ) {
      return true
    }
    if (/^[a-z]:\\users\\[^\\]+\\ntuser\.(dat|ini)$/.test(key)) return true
    if (
      /^[a-z]:\\users\\[^\\]+\\appdata\\roaming\\microsoft\\windows\\start menu\\programs\\startup(\\|$)/.test(
        key,
      )
    ) {
      return true
    }
    if (/^[a-z]:\\(pagefile|hiberfil|swapfile)\.sys$/.test(key)) return true
    return false
  }

  return /^\/(etc|usr|bin|sbin|lib|lib64|boot|dev|proc|sys|var|root|opt|system|library|applications|private\/etc)(\/|$)/.test(
    target.key,
  )
}

export function assessPathRisk(target: NormalizedPath, context: PathRiskContext): PathRisk {
  const reasons: RiskReason[] = []
  let level: RiskLevel = 'low'

  const record = (code: string, reasonLevel: RiskLevel, message: string): void => {
    add(reasons, code, reasonLevel, message)
    level = maxRisk(level, reasonLevel)
  }

  if (isDshConfig(target)) {
    record('dsh-config-path', 'critical', 'DSH configuration or plugin state')
  }
  if (isVcsInternal(target)) {
    record('vcs-internal', 'critical', 'version-control internals')
  }
  if (isCiWorkflow(target)) {
    record('ci-workflow', 'critical', 'CI workflow that can execute code')
  }
  if (isCredentialPath(target)) {
    record('credential-path', 'critical', 'credential or secret store')
  }
  if (isSystemPath(target)) {
    record('system-path', 'critical', 'operating-system path')
  }

  const insideWorkspace =
    context.cwd !== undefined && isPathWithin(target, context.cwd)
  if (!insideWorkspace) {
    record('outside-workspace', 'high', 'outside the session workspace')
  }

  const pathParts = components(target.path)
  if (pathParts.some((part) => WORKSPACE_CONFIG_DIRS.has(part))) {
    record('workspace-config', 'high', 'workspace tooling or dependency directory')
  }
  if (target.isDirectory !== true && target.linkCount !== undefined && target.linkCount > 1) {
    record('hardlink-target', 'high', 'hard-linked file may alias a protected target')
  }

  if (target.isDirectory === true) {
    record('directory-target', 'high', 'directory rather than a single file')
    return { level, reasons }
  }

  const name = baseName(target.path)
  const extension = extensionOf(name)

  if (INSTRUCTION_NAMES.has(name)) {
    record('instruction-file', 'high', 'agent instruction file')
    return { level, reasons }
  }
  if (
    CONFIG_NAMES.has(name) ||
    /^(?:tsconfig|jsconfig)\..*\.json$/.test(name) ||
    /^\.(?:eslintrc|prettierrc|babelrc|stylelintrc|swcrc)/.test(name)
  ) {
    record('code-or-config', 'high', 'build or project configuration')
    return { level, reasons }
  }
  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    record('executable-file', 'high', 'executable or library file')
    return { level, reasons }
  }
  if (CODE_EXTENSIONS.has(extension)) {
    record('code-or-config', 'high', 'source code')
    return { level, reasons }
  }
  if (CONFIG_EXTENSIONS.has(extension)) {
    record('code-or-config', 'high', 'configuration')
    return { level, reasons }
  }
  if (DATA_EXTENSIONS.has(extension)) {
    record('data-file', 'medium', 'ordinary data file')
    return { level, reasons }
  }
  if (extension === '' && DOC_NAMES.has(name)) {
    record('data-file', 'medium', 'documentation file')
    return { level, reasons }
  }

  record('unclassified-file', 'unknown', 'file type cannot be classified safely')
  return { level, reasons }
}
