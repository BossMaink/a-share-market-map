import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const pyScript = path.join(__dirname, 'update-a-share-data.py')
const nodeScript = path.join(__dirname, 'update-a-share-data.mjs')

const venvPython = path.resolve(projectRoot, '..', '..', '.venv', 'Scripts', 'python.exe')

const pythonCandidates = [
  existsSync(venvPython) ? { cmd: venvPython, args: [pyScript], label: venvPython } : null,
  { cmd: 'python', args: [pyScript], label: 'python' },
  { cmd: 'py', args: ['-3', pyScript], label: 'py -3' },
].filter(Boolean)

function runCommand(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    cwd: projectRoot,
  })
  if (result.error) {
    return { ok: false, code: -1, error: result.error }
  }
  return { ok: result.status === 0, code: result.status ?? -1, error: null }
}

let pythonOk = false
for (const candidate of pythonCandidates) {
  console.log(`[data:update] try ${candidate.label}`)
  const result = runCommand(candidate.cmd, candidate.args)
  if (result.ok) {
    pythonOk = true
    break
  }
  console.warn(`[data:update] ${candidate.label} failed, exit=${result.code}`)
}

if (!pythonOk) {
  console.warn('[data:update] python updater unavailable, fallback to node updater')
  const fallback = runCommand('node', [nodeScript])
  if (!fallback.ok) {
    console.warn(`[data:update] node updater failed, exit=${fallback.code}`)
  }
}

process.exitCode = 0
