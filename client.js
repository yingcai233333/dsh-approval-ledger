/**
 * Client half: a read-only approval-detail affordance.
 *
 * It never answers an approval. The decision stays on the official approval
 * card; this only exposes the live pending request and the Host-rewritten
 * displayReason for inspection.
 */
window.__ModuleLoader__.load({
  id: 'dsh-approval-ledger',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'approvalLedger'
    const ZH_TOOLS = {
      write: '写入文件',
      edit: '编辑文件',
      read: '读取文件',
      glob: '查找文件',
      grep: '搜索内容',
      pwsh: 'PowerShell 命令',
      bash: 'Shell 命令',
      delete: '删除',
      move: '移动',
      copy: '复制',
      mkdir: '创建目录',
      plugin_manager: '插件管理',
      request_approvals: '提交审批计划',
      subagent: '子代理',
      workflow: '工作流',
      web_fetch: '抓取网页',
      web_search: '搜索网页',
      apply_patch: '应用补丁',
    }
    function displayTool(name) {
      if (typeof name !== 'string' || name.length === 0) return '未知工具'
      return ZH_TOOLS[name] ?? '其他工具'
    }

    const zh = {
      button: '审批详情',
      title: '待审批操作',
      empty: '当前没有待审批的审批卡。',
      tool: '工具',
      callId: '调用',
      summary: '摘要',
      reason: '原始原因',
      close: '关闭',
      inlineTitle: '待审批说明',
      inlineLead: '先看这里的说明，再到下方官方审批卡点“允许”或“拒绝”。',
      inlineScope: '允许只影响本次调用；不会生成永久授权。',
      inlineRisk: '高风险、严重风险和未知风险不会自动放行。',
      inlineMissing: '系统未生成可读摘要，请以官方审批卡为准。',
      note: '这是只读详情。允许/拒绝仍请在官方审批卡上操作。计划批准只登记授权，实际调用还会重新判风险。',
    }
    const en = {
      button: 'Approval details',
      title: 'Pending approval',
      empty: 'There is no pending approval card.',
      tool: 'Tool',
      callId: 'Call',
      summary: 'Summary',
      reason: 'Original reason',
      close: 'Close',
      inlineTitle: 'Approval note',
      inlineLead: 'Read this note, then choose Allow or Reject on the official card below.',
      inlineScope: 'Allow applies to this call only; no permanent grant.',
      inlineRisk: 'High, critical, and unknown risk are never auto-approved.',
      inlineMissing: 'No readable summary was generated; follow the official approval card.',
      note: 'Read-only details. Allow or reject on the official approval card.',
    }

    function localized(value, localeId) {
      if (typeof value === 'string') return value
      if (value !== null && typeof value === 'object') {
        const key = String(localeId ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
        return value[key] ?? value.zh ?? value.en ?? ''
      }
      return ''
    }

    function Dot() {
      return h('span', {
        'aria-hidden': true,
        style: {
          width: 7,
          height: 7,
          borderRadius: 999,
          background: 'var(--dsw-alias-state-error-primary, #d33)',
          display: 'inline-block',
          flex: '0 0 auto',
        },
      })
    }

    // `shell.overlay` is frame-wide and does not receive a sessionId, so the
    // overlay has to find the pending approval itself: prefer the given
    // session, then fall back to any session whose pending interaction is an
    // approval. Without the fallback the note never renders in the overlay.
    function usePendingApproval(useSessionStatus, sessionId) {
      return useSessionStatus((snapshot) => {
        if (snapshot === undefined || snapshot === null) return undefined
        if (sessionId !== undefined && typeof snapshot.get === 'function') {
          const status = snapshot.get(sessionId)
          const pending = status === undefined || status === null ? undefined : status.pendingInteraction
          if (pending !== undefined && pending !== null && pending.kind === 'approval') return pending
        }
        if (typeof snapshot.forEach !== 'function') return undefined
        let found
        snapshot.forEach((status) => {
          if (found !== undefined) return
          const pending = status === undefined || status === null ? undefined : status.pendingInteraction
          if (pending !== undefined && pending !== null && pending.kind === 'approval') found = pending
        })
        return found
      })
    }

    function ApprovalNote({ approval, t }) {
      const summary = localized(approval.displayReason, 'zh')
      return h('section', {
        'aria-label': t('inlineTitle'),
        style: {
          marginBottom: 8,
          padding: '10px 12px',
          border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d97706) 35%, var(--dsw-alias-border-l1, #ddd))',
          borderRadius: 10,
          background: 'var(--dsw-alias-bg-layer-2, #f7f7f7)',
          color: 'var(--dsw-alias-label-primary, #111)',
          boxSizing: 'border-box',
        },
      },
      h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontWeight: 600 },
      }, h(Dot), t('inlineTitle')),
      h('p', { style: { margin: '0 0 6px', lineHeight: 1.5 } }, summary || t('inlineMissing')),
      h('ul', {
        style: {
          margin: '0',
          paddingLeft: 20,
          color: 'var(--dsw-alias-label-secondary, #555)',
          fontSize: 12,
          lineHeight: 1.55,
        },
      }, h('li', null, t('inlineLead')), h('li', null, t('inlineScope')), h('li', null, t('inlineRisk'))))
    }

    function ApprovalInline(props) {
      const { sessionId, useSessionStatus } = props
      const ctx = props.__ctx
      const t = ctx === undefined ? (key) => en[key] ?? key : ctx.locale.bind(NS)
      const approval = usePendingApproval(useSessionStatus, sessionId)
      if (approval === undefined) return null
      return h(ApprovalNote, { approval, t })
    }

    // `shell.overlay` is frame-wide: resolve the pending approval here so the
    // fixed wrapper is only mounted when there is a note to render.
    function ApprovalOverlay(props) {
      const ctx = props.__ctx
      const t = ctx === undefined ? (key) => en[key] ?? key : ctx.locale.bind(NS)
      const approval = usePendingApproval(props.useSessionStatus, props.sessionId)
      if (approval === undefined) return null
      return h('div', {
        style: {
          position: 'fixed',
          right: 24,
          bottom: 96,
          zIndex: 900,
          width: 'min(420px, calc(100vw - 32px))',
          pointerEvents: 'auto',
        },
      }, h(ApprovalNote, { approval, t }))
    }

    function ApprovalDetails(props) {
      const { sessionId, useSessionStatus } = props
      const [open, setOpen] = React.useState(false)
      const pending = useSessionStatus((snapshot) => {
        if (sessionId === undefined) return undefined
        return snapshot.get(sessionId)?.pendingInteraction
      })
      const approval = pending !== undefined && pending !== null && pending.kind === 'approval' ? pending : undefined

      React.useEffect(() => {
        if (approval === undefined) setOpen(false)
      }, [approval])

      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      React.useEffect(() => {
        if (approval === undefined) return undefined
        const previous = document.title
        const prefix = '● '
        if (!previous.startsWith(prefix)) document.title = prefix + previous
        return () => {
          if (document.title.startsWith(prefix)) document.title = document.title.slice(prefix.length)
        }
      }, [approval])

      const ctx = props.__ctx
      const t = ctx === undefined ? (key) => en[key] ?? key : ctx.locale.bind(NS)
      const summary = approval === undefined ? '' : localized(approval.displayReason, 'zh')

      const button = h('button', {
        type: 'button',
        title: t('button'),
        'aria-label': t('button'),
        'aria-expanded': open,
        onClick: () => setOpen((value) => !value),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 26,
          padding: '2px 8px',
          border: '1px solid var(--dsw-alias-border-l1, #ddd)',
          borderRadius: 8,
          background: 'var(--dsw-alias-bg-layer-1, #fff)',
          color: 'var(--dsw-alias-label-primary, #111)',
          font: 'inherit',
          cursor: 'pointer',
        },
      }, approval === undefined ? null : h(Dot), t('button'))

      if (!open) return button

      return h(React.Fragment, null, button, h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('title'),
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) setOpen(false)
        },
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #000) 55%, transparent)',
        },
      }, h('div', {
        onMouseDown: (event) => event.stopPropagation(),
        style: {
          width: 'min(560px, 92vw)',
          maxHeight: '80vh',
          overflow: 'auto',
          boxSizing: 'border-box',
          padding: 18,
          border: '1px solid var(--dsw-alias-border-l2, #ccc)',
          borderRadius: 12,
          background: 'var(--dsw-alias-bg-overlay, #fff)',
          color: 'var(--dsw-alias-label-primary, #111)',
          boxShadow: '0 18px 50px rgba(0,0,0,.25)',
        },
      }, h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      }, h('strong', null, t('title')), h('button', {
        type: 'button',
        onClick: () => setOpen(false),
        style: {
          border: '1px solid var(--dsw-alias-border-l1, #ddd)',
          borderRadius: 7,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          padding: '2px 8px',
          cursor: 'pointer',
        },
      }, t('close'))),
      approval === undefined
        ? h('p', { style: { color: 'var(--dsw-alias-label-secondary, #666)' } }, t('empty'))
        : h('div', null,
            h('p', null, h('strong', null, t('tool') + ': '), displayTool(approval.toolName)),
            approval.callId === undefined ? null : h('p', null, h('strong', null, t('callId') + ': '), approval.callId),
            h('p', null, h('strong', null, t('summary') + ': '), summary || '—'),
            h('ul', {
              style: { margin: '8px 0 10px', paddingLeft: 20, color: 'var(--dsw-alias-label-secondary, #555)' },
            }, [
              '计划批准只登记授权；实际执行仍会重新判风险。',
              '自动表示可能直接放行；手动表示仍需在官方审批卡上确认。',
              '完全访问表示允许访问工作区外的文件或系统。',
              '严重风险永不自动放行；未知风险保持手动。',
            ].map((text) => h('li', { key: text }, text))),
          ),
      h('p', {
        style: { marginBottom: 0, color: 'var(--dsw-alias-label-secondary, #666)', fontSize: 12 },
      }, t('note')))))
    }

    return {
      inject: ['slots', 'locale', 'sessions'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'approval-ledger: client dictionaries')
          ctx.slots.inject('conversation.session.header.utilities', () => {
            return ctx.slots.register({
              name: 'conversation.session.header.utilities',
              id: 'approval-ledger-details',
              order: 10,
              label: () => ctx.locale.bind(NS)('button'),
            }, (props) => h(ApprovalDetails, { ...props, __ctx: ctx }))
          })
          ctx.slots.inject('shell.overlay', () => {
            return ctx.slots.register({
              name: 'shell.overlay',
              id: 'approval-ledger-inline',
              order: 15,
              label: () => ctx.locale.bind(NS)('inlineTitle'),
            }, (props) => h(ApprovalOverlay, { ...props, __ctx: ctx }))
          })
        } catch (error) {
          console.error('dsh-approval-ledger client apply failed', error)
          throw error
        }
      },
    }
  },
})
