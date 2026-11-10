/**
 * dsh-skill-panel — 浏览器半边（v2：技能包工作台）
 *
 * 三栏布局：
 *   左：技能包列表 + 新建
 *   中：源与技能库（可勾选，勾中会写进当前包的 picks/global）
 *   右：包正文编辑器（frontmatter 与正文都能改）
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-skill-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    const PANEL_ID = 'skill-panel'
    const API = '/dsh-skill-panel'

    async function apiGet(route) {
      const r = await fetch(`${API}/${route}`, { headers: { 'x-dsh-skill-panel': '1' } })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? '请求失败')
      return j
    }

    async function apiPost(route, body) {
      const r = await fetch(`${API}/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-skill-panel': '1' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? '操作失败')
      return j
    }

    // ── 样式：只用主题 token ──
    const S = {
      wrap: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        fontSize: 13,
      },
      head: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        flexShrink: 0,
      },
      title: { fontSize: 14, fontWeight: 600, marginRight: 'auto' },
      body: { display: 'flex', flex: 1, minHeight: 0 },
      col: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
      colHead: {
        padding: '6px 10px',
        fontSize: 11,
        fontWeight: 600,
        opacity: 0.6,
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      },
      scroll: { overflowY: 'auto', flex: 1, minHeight: 0, padding: 4 },
      row: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        width: '100%',
        textAlign: 'left',
        padding: '6px 8px',
        borderRadius: 5,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12.5,
        fontFamily: 'inherit',
      },
      rowOn: { background: 'var(--dsw-alias-bg-l2)' },
      name: { fontWeight: 500 },
      desc: {
        fontSize: 11,
        opacity: 0.55,
        marginTop: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      },
      btn: {
        padding: '4px 10px',
        borderRadius: 5,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-l1)',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      },
      btnPri: {
        padding: '4px 10px',
        borderRadius: 5,
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      },
      btnTiny: {
        padding: '2px 6px',
        borderRadius: 4,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: 'inherit',
      },
      ta: {
        flex: 1,
        width: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        padding: 10,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 1.65,
        background: 'transparent',
        color: 'inherit',
        tabSize: 2,
      },
      empty: { padding: 20, opacity: 0.5, fontSize: 12, textAlign: 'center' },
      tag: {
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 9,
        fontSize: 10,
        background: 'var(--dsw-alias-bg-l2)',
        marginRight: 4,
      },
      err: { color: '#d9534f', fontSize: 11, padding: '2px 8px' },
      stat: { fontSize: 11, opacity: 0.6, marginLeft: 'auto' },
      input: {
        padding: '4px 8px',
        borderRadius: 5,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'inherit',
        fontSize: 12,
        fontFamily: 'inherit',
        minWidth: 0,
      },
      chk: { marginTop: 2, flexShrink: 0 },
    }

    /** 从包文本里抽出 frontmatter 的三个列表 */
    function readMeta(text) {
      const out = { sources: [], picks: [], global: [] }
      if (typeof text !== 'string') return out
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (m === null) return out
      let key = null
      for (const raw of m[1].split(/\r?\n/)) {
        if (raw.trim() === '') continue
        const item = raw.match(/^\s+-\s*(.+)$/)
        if (item !== null) {
          // 只收集三个已知字段；其它字段（pack/description…）的列表项直接忽略，
          // 否则 out[key] 为 undefined 会抛 TypeError 并让整个面板崩掉。
          if (key !== null && Array.isArray(out[key])) {
            out[key].push(item[1].trim().replace(/^["']|["']$/g, ''))
          }
          continue
        }
        const kv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
        if (kv !== null) key = kv[1]
      }
      return out
    }

    /** 改写 frontmatter 里的某个列表，保留其余行 */
    function writeMeta(text, field, list) {
      const m = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/)
      if (m === null) return text
      const lines = m[2].split(/\r?\n/)
      const kept = []
      let skipping = false
      for (const line of lines) {
        if (skipping) {
          if (/^\s+-\s*/.test(line) || line.trim() === '') continue
          skipping = false
        }
        const kv = line.match(/^([A-Za-z_][\w-]*):/)
        if (kv !== null && kv[1] === field) {
          skipping = true
          continue
        }
        kept.push(line)
      }
      // 去掉尾部空行
      while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
      const block = list.length === 0 ? [`${field}: []`] : [`${field}:`, ...list.map((x) => `  - ${x}`)]
      return `${m[1]}${[...kept, ...block].join('\r\n')}${m[3]}${text.slice(m[0].length)}`
    }

    function SkillPanel() {
      const [data, setData] = useState(null)
      const [sel, setSel] = useState(null) // 选中的包（file 名）
      const [draft, setDraft] = useState('')
      const [dirty, setDirty] = useState(false)
      const [status, setStatus] = useState('')
      const [loading, setLoading] = useState(true)
      const [filter, setFilter] = useState('')
      const [newName, setNewName] = useState('')
      const [creating, setCreating] = useState(false)

      const load = useCallback(async () => {
        setLoading(true)
        try {
          const j = await apiGet('list')
          setData(j)
          setStatus(`${j.packs.length} 包 / ${j.globals.length} 全局 / ${j.sources.reduce((a, s) => a + s.skills.length, 0)} 源技能`)
        } catch (e) {
          setStatus(`读取失败: ${e.message}`)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const cur = useMemo(() => {
        if (data === null || sel === null) return null
        return data.packs.find((p) => p.file === sel) ?? null
      }, [data, sel])

      const meta = useMemo(() => readMeta(draft), [draft])

      const pick = useCallback(
        (p) => {
          if (dirty && !window.confirm('当前修改未保存，确定切换？')) return
          setSel(p.file)
          setDraft(p.text)
          setDirty(false)
        },
        [dirty],
      )

      const save = useCallback(async () => {
        if (cur === null) return
        setStatus('保存中…')
        try {
          const r = await apiPost('save', { file: cur.file, text: draft })
          setDirty(false)
          setStatus(`已保存 ${r.bytes} 字节`)
          await load()
        } catch (e) {
          setStatus(`保存失败: ${e.message}`)
        }
      }, [cur, draft, load])

      const create = useCallback(async () => {
        if (newName.trim() === '') return
        setStatus('创建中…')
        try {
          const r = await apiPost('create', { pack: newName.trim(), description: '' })
          setCreating(false)
          setNewName('')
          await load()
          const j = await apiGet('list')
          const p = j.packs.find((x) => x.file === r.file)
          if (p !== undefined) {
            setSel(p.file)
            setDraft(p.text)
            setDirty(false)
          }
          setStatus('已创建')
        } catch (e) {
          setStatus(`创建失败: ${e.message}`)
        }
      }, [newName, load])

      const remove = useCallback(async () => {
        if (cur === null) return
        if (!window.confirm(`删除技能包 ${cur.file}？`)) return
        try {
          await apiPost('remove', { file: cur.file })
          setSel(null)
          setDraft('')
          setDirty(false)
          await load()
          setStatus('已删除')
        } catch (e) {
          setStatus(`删除失败: ${e.message}`)
        }
      }, [cur, load])

      /** 勾选/取消：同时维护 sources（父）与 picks（子） */
      const toggleSkill = useCallback(
        (skill, srcId) => {
          if (cur === null) return
          let next = draft
          const m = readMeta(next)
          const inPicks = m.picks.includes(skill)
          if (inPicks) {
            next = writeMeta(next, 'picks', m.picks.filter((x) => x !== skill))
          } else {
            const picks = [...m.picks, skill]
            next = writeMeta(next, 'picks', picks)
            if (srcId !== undefined && !m.sources.includes(srcId)) {
              next = writeMeta(next, 'sources', [...m.sources, srcId])
            }
          }
          setDraft(next)
          setDirty(true)
        },
        [cur, draft],
      )

      const toggleGlobal = useCallback(
        (skill) => {
          if (cur === null) return
          const m = readMeta(draft)
          const has = m.global.includes(skill)
          setDraft(writeMeta(draft, 'global', has ? m.global.filter((x) => x !== skill) : [...m.global, skill]))
          setDirty(true)
        },
        [cur, draft],
      )

      const toggleSource = useCallback(
        (id) => {
          if (cur === null) return
          const m = readMeta(draft)
          const has = m.sources.includes(id)
          setDraft(writeMeta(draft, 'sources', has ? m.sources.filter((x) => x !== id) : [...m.sources, id]))
          setDirty(true)
        },
        [cur, draft],
      )

      // Ctrl/Cmd+S
      useEffect(() => {
        const onKey = (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            if (dirty) save()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [dirty, save])

      const packList = useMemo(() => {
        if (data === null || !Array.isArray(data.packs)) return []
        return data.packs.map((p) => {
          const errs = Array.isArray(p.errors) ? p.errors : []
          return h(
            'button',
            {
              key: p.file,
              style: sel === p.file ? { ...S.row, ...S.rowOn } : S.row,
              onClick: () => pick(p),
              title: p.path,
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: S.name }, p.pack),
              h('div', { style: S.desc }, p.description || '（无描述）'),
              errs.length > 0
                ? h('div', { style: S.err }, `! ${errs.length} 处问题`)
                : null,
            ),
          )
        })
      }, [data, sel, pick])

      const skillRow = (s, srcId) => {
        const inPicks = meta.picks.includes(s.name)
        return h(
          'label',
          {
            key: `${srcId ?? 'g'}:${s.name}`,
            style: { ...S.row, cursor: 'pointer', alignItems: 'flex-start' },
            title: s.description || s.name,
          },
          h('input', {
            type: 'checkbox',
            style: S.chk,
            checked: inPicks,
            onChange: () => toggleSkill(s.name, srcId),
          }),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { style: S.name }, s.name),
            h('div', { style: S.desc }, s.description || `${s.chars} 字符`),
          ),
        )
      }

      const globalRow = (s) =>
        h(
          'label',
          {
            key: `g:${s.name}`,
            style: { ...S.row, cursor: 'pointer', alignItems: 'flex-start' },
            title: s.description || s.name,
          },
          h('input', {
            type: 'checkbox',
            style: S.chk,
            checked: meta.global.includes(s.name),
            onChange: () => toggleGlobal(s.name),
          }),
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { style: S.name }, s.name),
            h('div', { style: S.desc }, s.description || ''),
          ),
        )

      const q = filter.trim().toLowerCase()
      const match = (s) =>
        q === '' ||
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q)

      const sourcesCol = useMemo(() => {
        if (data === null) return h('div', { style: S.empty }, loading ? '读取中…' : '无数据')
        const blocks = []
        const globals = Array.isArray(data.globals) ? data.globals : []
        const sources = Array.isArray(data.sources) ? data.sources : []

        blocks.push(
          h('div', { key: 'h-global', style: { ...S.colHead, padding: '8px 10px 4px' } }, '全局已装（写 global）'),
        )
        const gs = globals.filter(match)
        if (gs.length === 0) blocks.push(h('div', { key: 'g-none', style: S.empty }, '无匹配'))
        for (const s of gs) blocks.push(globalRow(s))

        for (const src of sources) {
          const on = meta.sources.includes(src.id)
          const skills = Array.isArray(src.skills) ? src.skills : []
          blocks.push(
            h(
              'div',
              { key: `h-${src.id}`, style: { ...S.colHead, padding: '10px 10px 4px' } },
              h('input', {
                type: 'checkbox',
                checked: on,
                onChange: () => toggleSource(src.id),
                title: '整个源可达（写 sources）',
              }),
              h('span', { style: { flex: 1 } }, src.name),
              h('span', { style: S.stat }, `${skills.length}`),
            ),
          )
          const list = skills.filter(match)
          if (list.length === 0) blocks.push(h('div', { key: `${src.id}-none`, style: S.empty }, '无匹配'))
          for (const s of list) blocks.push(skillRow(s, src.id))
        }
        return blocks
      }, [data, meta, q, loading, toggleSource, toggleSkill, toggleGlobal])

      return h(
        'div',
        { style: S.wrap },
        h(
          'div',
          { style: S.head },
          h('div', { style: S.title }, '技能包工作台'),
          h('span', { style: S.stat }, loading ? '读取中…' : status),
          h('input', {
            style: { ...S.input, width: 130 },
            placeholder: '过滤 skill…',
            value: filter,
            onChange: (e) => setFilter(e.target.value),
          }),
          h('button', { style: S.btn, onClick: load }, '刷新'),
          h('button', { style: S.btnPri, onClick: () => setCreating((v) => !v) }, creating ? '取消' : '新建包'),
        ),
        creating
          ? h(
              'div',
              { style: { ...S.head, borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
              h('input', {
                style: { ...S.input, width: 180 },
                placeholder: '包名（如 学术写作）',
                value: newName,
                onChange: (e) => setNewName(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') create()
                },
              }),
              h('button', { style: S.btnPri, onClick: create, disabled: newName.trim() === '' }, '创建'),
            )
          : null,
        h(
          'div',
          { style: S.body },
          // 左：包列表
          h(
            'div',
            { style: { ...S.col, width: 220, flexShrink: 0, borderRight: '1px solid var(--dsw-alias-border-l1)' } },
            h('div', { style: S.colHead }, '技能包', h('span', { style: S.stat }, data === null ? '' : `${data.packs.length}`)),
            h('div', { style: S.scroll }, data !== null && data.packs.length === 0 ? h('div', { style: S.empty }, '还没有包，点右上角新建') : packList),
          ),
          // 中：源与技能
          h(
            'div',
            { style: { ...S.col, width: 300, flexShrink: 0, borderRight: '1px solid var(--dsw-alias-border-l1)' } },
            h(
              'div',
              { style: S.colHead },
              '源与技能',
              cur === null ? h('span', { style: S.stat }, '未选包') : h('span', { style: S.stat }, `已选 ${meta.picks.length}`),
            ),
            h('div', { style: S.scroll }, sourcesCol),
          ),
          // 右：编辑器
          cur === null
            ? h('div', { style: { ...S.col, flex: 1, ...S.empty } }, '从左侧选一个技能包')
            : h(
                'div',
                { style: { ...S.col, flex: 1 } },
                h(
                  'div',
                  { style: S.colHead },
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 } }, cur.path),
                  h('span', { style: S.stat }, dirty ? '未保存' : `${cur.chars} 字符`),
                  h('button', { style: S.btnTiny, onClick: remove }, '删除'),
                  h('button', { style: S.btnPri, onClick: save, disabled: !dirty }, '保存'),
                ),
                (Array.isArray(cur.errors) ? cur.errors : []).length > 0
                  ? h(
                      'div',
                      { style: { padding: '4px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
                      (cur.errors ?? []).map((e, i) => h('div', { key: i, style: S.err }, `! ${e}`)),
                    )
                  : null,
                h('textarea', {
                  style: S.ta,
                  value: draft,
                  spellCheck: false,
                  onChange: (e) => {
                    setDraft(e.target.value)
                    setDirty(e.target.value !== cur.text)
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const el = e.target
                      const s = el.selectionStart
                      const t = el.selectionEnd
                      const next = `${draft.slice(0, s)}  ${draft.slice(t)}`
                      setDraft(next)
                      setDirty(true)
                      requestAnimationFrame(() => {
                        el.selectionStart = el.selectionEnd = s + 2
                      })
                    }
                  },
                }),
              ),
        ),
      )
    }

    function PanelIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 20,
          height: 20,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 3, y: 4, width: 7, height: 16, rx: 1.5 }),
        h('rect', { x: 13, y: 4, width: 8, height: 7, rx: 1.5 }),
        h('rect', { x: 13, y: 14, width: 8, height: 6, rx: 1.5 }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, SkillPanel),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '技能包' },
            PanelIcon,
          ),
        )
      },
    }
  },
})
