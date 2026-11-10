/**
 * dsh-skill-panel — Host 半边（v2：技能包工作台）
 *
 * 两套数据：
 *   1. skill 库：扫描 ~/.dsh/skills 等根，以及 _sources.json 里的第三方源
 *   2. 技能包：读写 D:\workspace\DSH-skills-packs\*.md
 *
 * 接口（前缀 /dsh-skill-panel）：
 *   GET  /list            列 skill（全部源）+ 列包
 *   GET  /sources         读 _sources.json
 *   POST /sources         写 _sources.json
 *   POST /save            保存一个包
 *   POST /create          新建包
 *   POST /remove          删包
 *   GET  /check           校验全部包（返回错误清单）
 */
import { readFile, writeFile, readdir, mkdir, stat, rm } from 'node:fs/promises'
import { join, resolve, sep, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

export const name = 'skill-panel'
export const inject = ['webServer']

const PREFIX = '/dsh-skill-panel'
const MAX_BODY = 4 * 1024 * 1024

/** 本机 skill 根（全局可用的） */
function globalRoots() {
  const home = homedir()
  return [join(home, '.dsh', 'skills'), join(home, '.dsh', 'skills-manual')]
}

/** 技能包目录：可被 Config 覆盖，默认在 workspace 下 */
let PACKS_DIR = 'D:\\workspace\\DSH-skills-packs'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isUnder(target, root) {
  const a = resolve(target)
  const r = resolve(root)
  return a === r || a.startsWith(r + sep)
}

/** 解析 frontmatter，返回 { data, body } */
function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m === null) return { data: {}, body: text, hasFm: false }
  const data = {}
  let key = null
  for (const raw of m[1].split(/\r?\n/)) {
    if (raw.trim() === '') continue
    const item = raw.match(/^\s+-\s*(.+)$/)
    if (item !== null && key !== null) {
      if (!Array.isArray(data[key])) data[key] = []
      data[key].push(item[1].trim().replace(/^["']|["']$/g, ''))
      continue
    }
    const kv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (kv !== null) {
      key = kv[1]
      const v = kv[2].trim()
      if (v === '') data[key] = []
      else if (v === '[]') data[key] = []
      else data[key] = v.replace(/^["']|["']$/g, '')
    }
  }
  return { data, body: text.slice(m[0].length), hasFm: true }
}

/** 读一个 skill 目录 */
async function readSkillDir(root, name, scope) {
  const file = join(root, name, 'SKILL.md')
  try {
    const text = await readFile(file, 'utf8')
    const st = await stat(file)
    const { data } = splitFrontmatter(text)
    return {
      name,
      description: typeof data.description === 'string' ? data.description : '',
      scope,
      root,
      path: file,
      chars: Array.from(text).length,
      bytes: st.size,
      mtime: st.mtimeMs,
    }
  } catch {
    return null
  }
}

/** 扫一个根下的一级子目录 skill */
async function scanRoot(root, scope) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const s = await readSkillDir(root, e.name, scope)
    if (s !== null) out.push(s)
  }
  return out
}

/** 读源注册表 */
async function readSources() {
  const file = join(PACKS_DIR, '_sources.json')
  try {
    const j = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(j.sources) ? j : { version: 1, sources: [] }
  } catch {
    return { version: 1, sources: [] }
  }
}

/** 列所有包 */
async function listPacks() {
  let entries
  try {
    entries = await readdir(PACKS_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || e.name.startsWith('_')) continue
    if (e.name === 'README.md') continue
    const file = join(PACKS_DIR, e.name)
    try {
      const text = await readFile(file, 'utf8')
      const st = await stat(file)
      const { data } = splitFrontmatter(text)
      out.push({
        file: e.name,
        pack: typeof data.pack === 'string' ? data.pack : e.name.replace(/\.md$/, ''),
        description: typeof data.description === 'string' ? data.description : '',
        sources: Array.isArray(data.sources) ? data.sources : [],
        picks: Array.isArray(data.picks) ? data.picks : [],
        global: Array.isArray(data.global) ? data.global : [],
        path: file,
        text,
        chars: Array.from(text).length,
        mtime: st.mtimeMs,
      })
    } catch {
      /* 跳过不可读的 */
    }
  }
  out.sort((a, b) => a.pack.localeCompare(b.pack))
  return out
}

/** 校验一个包，返回错误数组 */
function validatePack(pack, sourceMap, skillPool) {
  const errors = []
  for (const id of pack.sources) {
    if (!sourceMap.has(id)) errors.push(`sources 里的 "${id}" 不在 _sources.json`)
  }
  for (const p of pack.picks) {
    if (!skillPool.has(p)) errors.push(`picks 里的 "${p}" 找不到（不在任何声明的源里）`)
  }
  for (const g of pack.global) {
    if (!SKILL_NAME.test(g)) errors.push(`global 里的 "${g}" 不是合法的 skill 名`)
  }
  if (pack.pack === '') errors.push('缺 pack 字段')
  if (pack.description === '') errors.push('缺 description 字段')
  return errors
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        fail(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        ok(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        fail(new Error(`请求体不是合法 JSON: ${e.message}`))
      }
    })
    req.on('error', fail)
  })
}

function send(res, code, value) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

export function apply(ctx, config = {}) {
  if (typeof config.packsDir === 'string' && config.packsDir !== '') PACKS_DIR = config.packsDir

  ctx.effect(() => {
    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://dsh')
      const route = url.pathname.slice(PREFIX.length)

      try {
        // ── 全量数据（一次拿齐，面板不用多次请求）──
        if (route === '/list') {
          const registry = await readSources()
          const sourceMap = new Map(registry.sources.map((s) => [s.id, s]))

          // 全局 skill
          const globals = []
          for (const root of globalRoots()) {
            globals.push(...(await scanRoot(root, 'global')))
          }

          // 第三方源 skill
          const bySource = []
          for (const s of registry.sources) {
            const list = await scanRoot(s.root, 'source')
            bySource.push({ id: s.id, name: s.name, root: s.root, note: s.note ?? '', skills: list })
          }

          const packs = await listPacks()
          const pool = new Set()
          for (const s of bySource) for (const k of s.skills) pool.add(k.name)

          const checked = packs.map((p) => ({ ...p, errors: validatePack(p, sourceMap, pool) }))

          send(res, 200, {
            ok: true,
            packsDir: PACKS_DIR,
            globals,
            sources: bySource,
            packs: checked,
          })
          return
        }

        // ── 保存包 ──
        if (route === '/save') {
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: '只接受 POST' })
          const { file, text } = await readBody(req)
          if (typeof file !== 'string' || typeof text !== 'string') {
            return send(res, 400, { ok: false, error: '需要 file 与 text' })
          }
          if (!file.endsWith('.md') || file.startsWith('_')) {
            return send(res, 400, { ok: false, error: '包文件必须是 .md 且不以 _ 开头' })
          }
          const target = join(PACKS_DIR, file)
          if (!isUnder(target, PACKS_DIR)) return send(res, 403, { ok: false, error: '路径越界' })
          await writeFile(target, text, 'utf8')
          return send(res, 200, { ok: true, bytes: Buffer.byteLength(text, 'utf8') })
        }

        // ── 新建包 ──
        if (route === '/create') {
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: '只接受 POST' })
          const { pack, description } = await readBody(req)
          if (typeof pack !== 'string' || pack.trim() === '') {
            return send(res, 400, { ok: false, error: '需要 pack 名' })
          }
          const safe = pack.trim().replace(/[\\/:*?"<>|]/g, '-')
          // 文件名必须是合法 UTF-8 且不含控制字符/替换符（U+FFFD 说明上游编码坏了）
          if (safe.includes('\uFFFD') || /[\u0000-\u001f]/.test(safe)) {
            return send(res, 400, { ok: false, error: '包名含非法字符（编码错误？）' })
          }
          if (safe.length > 80) return send(res, 400, { ok: false, error: '包名过长（≤80 字符）' })
          const file = `${safe}.md`
          const target = join(PACKS_DIR, file)
          if (!isUnder(target, PACKS_DIR)) return send(res, 403, { ok: false, error: '路径越界' })
          if (existsSync(target)) return send(res, 409, { ok: false, error: '同名包已存在' })
          const text = `---\npack: ${safe}\ndescription: ${description ?? ''}\nsources: []\npicks: []\nglobal: []\n---\n\n# ${safe}技能包\n\n（正文：写给 agent 看的加载指示）\n`
          await writeFile(target, text, 'utf8')
          return send(res, 200, { ok: true, file, path: target })
        }

        // ── 删包 ──
        if (route === '/remove') {
          if (req.method !== 'POST') return send(res, 405, { ok: false, error: '只接受 POST' })
          const { file } = await readBody(req)
          if (typeof file !== 'string' || !file.endsWith('.md') || file.startsWith('_')) {
            return send(res, 400, { ok: false, error: '只能删 .md 包文件' })
          }
          const target = join(PACKS_DIR, file)
          if (!isUnder(target, PACKS_DIR)) return send(res, 403, { ok: false, error: '路径越界' })
          await rm(target, { force: true })
          return send(res, 200, { ok: true })
        }

        // ── 保存源注册表 ──
        if (route === '/sources' && req.method === 'POST') {
          const body = await readBody(req)
          if (!Array.isArray(body.sources)) {
            return send(res, 400, { ok: false, error: '需要 sources 数组' })
          }
          const target = join(PACKS_DIR, '_sources.json')
          await writeFile(target, JSON.stringify({ version: 1, sources: body.sources }, null, 2), 'utf8')
          return send(res, 200, { ok: true })
        }

        send(res, 404, { ok: false, error: `未知接口: ${route}` })
      } catch (error) {
        send(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    }

    return ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler })
  }, 'dsh-skill-panel: routes')
}