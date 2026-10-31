/**
 * Client half: the read-only approval-detail affordance and the reminder
 * settings panel.
 *
 * It never answers an approval. The decision stays on the official approval
 * card; this only exposes the live pending request, the Host-rewritten
 * displayReason for inspection, and the ten reminder switches through the DSH
 * `configForms` bridge (the Host config editor owns persistence).
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
      settingsTitle: '审批与提醒',
      settingsLead: '控制自动放行、审批卡、问题卡和对话完成时的提醒方式。修改即时生效并保存在当前 profile。',
      groupAutoAllow: '自动放行',
      groupSwitches: '提醒开关',
      groupEvents: '哪些事件提醒',
      groupTurnEnd: '完成提醒',
      groupOther: '其它',
      autoAllowSessionsTitle: '新会话默认自动放行',
      autoAllowSessionsDesc: '删除文件、严重风险、未知风险仍然必须人工审批；会话内可用 /approvals auto off 关掉。只影响之后新起的会话。',
      notificationsTitle: '启用提醒',
      notificationsDesc: '总开关，关闭后下列所有提醒都不触发',
      flashWindowTitle: '任务栏闪烁',
      flashWindowDesc: '窗口不在前台时，闪烁任务栏按钮吸引注意',
      soundAlertTitle: '提示音',
      soundAlertDesc: '审批用合成的「叮咚」，对话完成用两声「滴滴」',
      notifyOnPlanTitle: '计划审阅卡',
      notifyOnPlanDesc: '请求一次批准一批操作时',
      notifyOnQuestionTitle: '问题与逐项勾选卡',
      notifyOnQuestionDesc: '结构化提问、逐项选择授权时',
      notifyOnApprovalTitle: '官方审批卡',
      notifyOnApprovalDesc: '写文件、跑命令等需要你点允许/拒绝时',
      notifyOnTurnEndTitle: '每轮对话完成',
      notifyOnTurnEndDesc: '模型结束一轮回复时提醒，方便你切回来',
      turnEndOnlyWhenAwayTitle: '窗口在前台时不提醒',
      turnEndOnlyWhenAwayDesc: '你正看着窗口时保持安静，只在切走或最小化时提示',
      turnBadgeSecondsTitle: '绿色徽标保留时长',
      turnBadgeSecondsDesc: '任务栏绿点在你回到窗口时清除，这里是最长保留时间',
      turnBadgeSecondsUnit: '秒（0 = 常驻）',
      notifyRepeatSecondsTitle: '未处理时重复提醒',
      notifyRepeatSecondsDesc: '审批卡一直没处理时，每隔这么久再提醒一次',
      notifyRepeatSecondsUnit: '秒（0 = 只提醒一次）',
      otherConfigNote: '其余配置（审批模式 mode、高风险授权、上限、审计保留期）仍在 cordis.patch.yml 里维护，不在此面板暴露。保存走 DSH 的配置编辑器，原子写入并即时生效。',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '保存失败，已恢复原值；请重试或改 cordis.patch.yml。',
      readOnly: '当前配置为只读（无法写入 profile）。',
      unavailable: '设置暂不可用：Host 未提供 approval-ledger 的配置表单。',
      loading: '正在读取配置…',
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
      settingsTitle: 'Approvals & alerts',
      settingsLead: 'Choose how auto-allow, approval cards, question cards, and completed turns behave and alert you. Changes apply immediately and are saved to the current profile.',
      groupAutoAllow: 'Auto-allow',
      groupSwitches: 'Alert switches',
      groupEvents: 'Which events alert',
      groupTurnEnd: 'Turn complete',
      groupOther: 'Other',
      autoAllowSessionsTitle: 'New sessions auto-allow by default',
      autoAllowSessionsDesc: 'Deleting files, critical risk, and unknown risk still require manual approval; turn it off per session with /approvals auto off. Only affects sessions that start afterwards.',
      notificationsTitle: 'Enable alerts',
      notificationsDesc: 'Master switch; turning it off suppresses every alert below',
      flashWindowTitle: 'Taskbar flash',
      flashWindowDesc: 'Flash the taskbar button when the window is not in front',
      soundAlertTitle: 'Sound',
      soundAlertDesc: 'A synthesized "ding-dong" for approvals and two "di-di" beeps for completed turns',
      notifyOnPlanTitle: 'Plan review card',
      notifyOnPlanDesc: 'When a batch of operations is submitted for approval',
      notifyOnQuestionTitle: 'Question and per-item cards',
      notifyOnQuestionDesc: 'Structured questions and per-item authorization',
      notifyOnApprovalTitle: 'Official approval card',
      notifyOnApprovalDesc: 'When a write or command needs your allow/reject',
      notifyOnTurnEndTitle: 'Every completed turn',
      notifyOnTurnEndDesc: 'Alert when the model finishes a reply, so you can switch back',
      turnEndOnlyWhenAwayTitle: 'Stay quiet while in front',
      turnEndOnlyWhenAwayDesc: 'No noise while you are watching; alert when you switch away or minimize',
      turnBadgeSecondsTitle: 'Green badge lifetime',
      turnBadgeSecondsDesc: 'The green taskbar dot clears when you return; this is its longest lifetime',
      turnBadgeSecondsUnit: 'seconds (0 = until you return)',
      notifyRepeatSecondsTitle: 'Repeat while pending',
      notifyRepeatSecondsDesc: 'While an approval card stays unanswered, remind again every N seconds',
      notifyRepeatSecondsUnit: 'seconds (0 = alert once)',
      otherConfigNote: 'Everything else (approval mode, high-risk grants, limits, audit retention) stays in cordis.patch.yml and is not exposed here. Saving goes through the DSH config editor: atomic write, applied immediately.',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Save failed; the previous value was restored. Retry or edit cordis.patch.yml.',
      readOnly: 'This configuration is read-only (the profile cannot be written).',
      unavailable: 'Settings are unavailable: the Host does not serve a config form for approval-ledger.',
      loading: 'Loading configuration…',
    }

    function localized(value, localeId) {
      if (typeof value === 'string') return value
      if (value !== null && typeof value === 'object') {
        const key = String(localeId ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
        return value[key] ?? value.zh ?? value.en ?? ''
      }
      return ''
    }

    // Limits mirror `REMINDER_FIELDS` in src/config-schema.ts; the Host schema
    // enforces the same range, the client clamps before writing.
    const FIELD_LIMITS = {
      notifyRepeatSeconds: { min: 0, max: 600 },
      turnBadgeSeconds: { min: 0, max: 3600 },
    }

    function clampInteger(raw, min, max, fallback) {
      if (typeof raw === 'string' && raw.trim() === '') return fallback
      const numeric = Number(raw)
      if (!Number.isFinite(numeric)) return fallback
      const rounded = Math.round(numeric)
      if (rounded < min) return min
      if (rounded > max) return max
      return rounded
    }

    // All colours come from the DSH alias tokens; no literal colour is used.
    const settingsStyles = {
      root: { display: 'flex', flexDirection: 'column', paddingTop: 8, color: 'var(--dsw-alias-label-primary)' },
      head: { margin: '0 0 18px' },
      title: { margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.4 },
      lead: { margin: '4px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.6 },
      groupTitle: { margin: '18px 2px 8px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 600 },
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
        overflow: 'hidden',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '11px 16px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      rowFirst: { borderTop: 0 },
      label: { flex: 1, minWidth: 0 },
      labelTitle: { display: 'block', fontWeight: 600, fontSize: 13 },
      labelDesc: {
        display: 'block',
        marginTop: 2,
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: 1.5,
      },
      numberWrap: { display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 0 auto' },
      unit: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, whiteSpace: 'nowrap' },
      foot: { margin: '18px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.6 },
      feedback: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 18 },
      saving: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      saved: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12 },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 },
      notice: { margin: '0 0 10px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.6 },
    }

    function settingsSwitchStyle(on, disabled) {
      return {
        position: 'relative',
        flex: '0 0 auto',
        width: 38,
        height: 22,
        padding: 0,
        border: 0,
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        background: on
          ? 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))'
          : 'var(--dsw-alias-border-l2)',
        transition: 'background .15s',
      }
    }

    function settingsKnobStyle(on) {
      return {
        position: 'absolute',
        top: 2,
        left: on ? 18 : 2,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: 'var(--dsw-alias-label-primary-foreground)',
        boxShadow: 'var(--dsw-shadow-lv1)',
        transition: 'left .15s',
      }
    }

    function settingsNumberStyle(disabled) {
      return {
        width: 84,
        padding: '5px 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 7,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        textAlign: 'right',
        opacity: disabled ? 0.45 : 1,
      }
    }

    function settingsRow(key, title, description, control, first) {
      return h(
        'div',
        { key, style: first === true ? Object.assign({}, settingsStyles.row, settingsStyles.rowFirst) : settingsStyles.row },
        h(
          'div',
          { style: settingsStyles.label },
          h('b', { style: settingsStyles.labelTitle }, title),
          description === undefined || description === '' ? null : h('span', { style: settingsStyles.labelDesc }, description),
        ),
        control,
      )
    }

    /**
     * Reminder settings panel. It is a thin view over the shared `configForms`
     * controller: values come from `getSnapshot()`, every change is written with
     * `form.set(field, value)` (the Host goes through `configEditor`, which
     * persists atomically and hot-applies), and a failed write rolls the shown
     * value back instead of leaving the UI out of sync with the profile.
     */
    function ReminderSettings(props) {
      const ctx = props.__ctx
      const t = ctx === undefined ? (key) => en[key] ?? key : ctx.locale.bind(NS)
      const form = props.form
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        if (form === undefined || form === null || typeof form.subscribe !== 'function') return undefined
        return form.subscribe(() => bump((value) => value + 1))
      }, [form])
      const [optimistic, setOptimistic] = React.useState({})
      const [busy, setBusy] = React.useState({})
      const [saved, setSaved] = React.useState(false)
      const [error, setError] = React.useState('')
      const [drafts, setDrafts] = React.useState({})

      const snapshot =
        form !== undefined && form !== null && typeof form.getSnapshot === 'function' ? form.getSnapshot() : undefined
      const values =
        snapshot !== undefined && snapshot !== null && snapshot.value !== null && typeof snapshot.value === 'object'
          ? snapshot.value
          : {}
      const writable = snapshot === undefined || snapshot === null || snapshot.writable !== false
      const masterOff = values.notifications === false
      const hasBusy = Object.keys(busy).length > 0

      const read = (field) =>
        Object.prototype.hasOwnProperty.call(optimistic, field) ? optimistic[field] : values[field]

      const write = (field, next) => {
        if (!writable || form === undefined || form === null || typeof form.set !== 'function') return
        setOptimistic((previous) => Object.assign({}, previous, { [field]: next }))
        setBusy((previous) => Object.assign({}, previous, { [field]: true }))
        setError('')
        setSaved(false)
        const settle = (accepted) => {
          setBusy((previous) => {
            const copy = Object.assign({}, previous)
            delete copy[field]
            return copy
          })
          setOptimistic((previous) => {
            const copy = Object.assign({}, previous)
            delete copy[field]
            return copy
          })
          if (accepted === false) setError(t('saveFailed'))
          else setSaved(true)
        }
        let pending
        try {
          pending = form.set(field, next)
        } catch (_throw) {
          settle(false)
          return
        }
        if (pending !== null && pending !== undefined && typeof pending.then === 'function') {
          pending.then(
            (accepted) => settle(accepted !== false),
            () => settle(false),
          )
          return
        }
        settle(pending !== false)
      }

      const renderSwitch = (field, title, description, first) => {
        const on = read(field) === true
        // `autoAllowSessions` is an approval behavior, not an alert, so the
        // reminder master switch must not disable it.
        const disabled =
          !writable || (field !== 'notifications' && field !== 'autoAllowSessions' && masterOff)
        return settingsRow(
          field,
          title,
          description,
          h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'data-field': field,
              'aria-label': title,
              'aria-checked': on,
              disabled,
              onClick: disabled ? undefined : () => write(field, !on),
              style: settingsSwitchStyle(on, disabled),
            },
            h('span', { 'aria-hidden': true, style: settingsKnobStyle(on) }),
          ),
          first,
        )
      }

      const renderNumber = (field, title, description, unit, first) => {
        const limit = FIELD_LIMITS[field]
        const disabled = !writable || masterOff
        const hasDraft = Object.prototype.hasOwnProperty.call(drafts, field)
        const fallbackValue = Number(read(field))
        const shown = hasDraft
          ? drafts[field]
          : String(Number.isFinite(fallbackValue) ? fallbackValue : limit.min)
        const commit = () => {
          if (disabled) return
          const raw = Object.prototype.hasOwnProperty.call(drafts, field) ? drafts[field] : shown
          const next = clampInteger(raw, limit.min, limit.max, Number.isFinite(fallbackValue) ? fallbackValue : limit.min)
          setDrafts((previous) => {
            const copy = Object.assign({}, previous)
            delete copy[field]
            return copy
          })
          if (next === read(field)) return
          write(field, next)
        }
        return settingsRow(
          field,
          title,
          description,
          h(
            'span',
            { style: settingsStyles.numberWrap },
            h('input', {
              type: 'number',
              inputMode: 'numeric',
              step: 1,
              min: limit.min,
              max: limit.max,
              'data-field': field,
              'aria-label': title,
              value: shown,
              disabled,
              onChange: (event) => {
                const next =
                  event !== null && event !== undefined && event.target !== undefined
                    ? String(event.target.value)
                    : ''
                setDrafts((previous) => Object.assign({}, previous, { [field]: next }))
              },
              onBlur: commit,
              onKeyDown: (event) => {
                if (event === null || event === undefined || event.key !== 'Enter') return
                if (typeof event.preventDefault === 'function') event.preventDefault()
                commit()
              },
              style: settingsNumberStyle(disabled),
            }),
            h('span', { style: settingsStyles.unit }, unit),
          ),
          first,
        )
      }

      const header = h(
        'header',
        { style: settingsStyles.head },
        h('h2', { style: settingsStyles.title }, t('settingsTitle')),
        h('p', { style: settingsStyles.lead }, t('settingsLead')),
      )

      if (form === undefined || form === null || snapshot === undefined || snapshot === null) {
        return h(
          'section',
          { 'aria-label': t('settingsTitle'), style: settingsStyles.root },
          header,
          h('p', { style: settingsStyles.notice }, t('unavailable')),
        )
      }
      if (snapshot.status === 'loading') {
        return h(
          'section',
          { 'aria-label': t('settingsTitle'), style: settingsStyles.root },
          header,
          h('p', { style: settingsStyles.notice }, t('loading')),
        )
      }
      if (snapshot.status === 'unavailable') {
        return h(
          'section',
          { 'aria-label': t('settingsTitle'), style: settingsStyles.root },
          header,
          h('p', { style: settingsStyles.notice }, t('unavailable')),
        )
      }

      return h(
        'section',
        { 'aria-label': t('settingsTitle'), style: settingsStyles.root },
        header,
        writable ? null : h('p', { role: 'status', style: settingsStyles.notice }, t('readOnly')),
        h('div', { style: settingsStyles.groupTitle }, t('groupAutoAllow')),
        h(
          'div',
          { style: settingsStyles.card },
          renderSwitch(
            'autoAllowSessions',
            t('autoAllowSessionsTitle'),
            t('autoAllowSessionsDesc'),
            true,
          ),
        ),
        h('div', { style: settingsStyles.groupTitle }, t('groupSwitches')),
        h(
          'div',
          { style: settingsStyles.card },
          renderSwitch('notifications', t('notificationsTitle'), t('notificationsDesc'), true),
          renderSwitch('flashWindow', t('flashWindowTitle'), t('flashWindowDesc')),
          renderSwitch('soundAlert', t('soundAlertTitle'), t('soundAlertDesc')),
        ),
        h('div', { style: settingsStyles.groupTitle }, t('groupEvents')),
        h(
          'div',
          { style: settingsStyles.card },
          renderSwitch('notifyOnPlan', t('notifyOnPlanTitle'), t('notifyOnPlanDesc'), true),
          renderSwitch('notifyOnQuestion', t('notifyOnQuestionTitle'), t('notifyOnQuestionDesc')),
          renderSwitch('notifyOnApproval', t('notifyOnApprovalTitle'), t('notifyOnApprovalDesc')),
          renderSwitch('notifyOnTurnEnd', t('notifyOnTurnEndTitle'), t('notifyOnTurnEndDesc')),
        ),
        h('div', { style: settingsStyles.groupTitle }, t('groupTurnEnd')),
        h(
          'div',
          { style: settingsStyles.card },
          renderSwitch('turnEndOnlyWhenAway', t('turnEndOnlyWhenAwayTitle'), t('turnEndOnlyWhenAwayDesc'), true),
          renderNumber(
            'turnBadgeSeconds',
            t('turnBadgeSecondsTitle'),
            t('turnBadgeSecondsDesc'),
            t('turnBadgeSecondsUnit'),
          ),
        ),
        h('div', { style: settingsStyles.groupTitle }, t('groupOther')),
        h(
          'div',
          { style: settingsStyles.card },
          renderNumber(
            'notifyRepeatSeconds',
            t('notifyRepeatSecondsTitle'),
            t('notifyRepeatSecondsDesc'),
            t('notifyRepeatSecondsUnit'),
            true,
          ),
        ),
        h('p', { style: settingsStyles.foot }, t('otherConfigNote')),
        h(
          'div',
          { style: settingsStyles.feedback },
          hasBusy ? h('span', { role: 'status', style: settingsStyles.saving }, t('saving')) : null,
          error === '' ? null : h('span', { role: 'alert', style: settingsStyles.error }, error),
          !hasBusy && error === '' && saved ? h('span', { role: 'status', style: settingsStyles.saved }, t('saved')) : null,
        ),
      )
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
          // The settings panel only exists while the Host serves this entry's
          // config form; `whileServed` keeps the registration in sync with that.
          if (typeof ctx.inject === 'function') {
            ctx.inject(['configForms'], (scoped) => {
              const forms = scoped.configForms
              if (forms === undefined || forms === null) return
              if (typeof forms.get !== 'function' || typeof forms.whileServed !== 'function') return
              scoped.effect(() => forms.whileServed(['approval-ledger'], () => {
                const form = forms.get('approval-ledger')
                return scoped.slots.inject('settings.section', () => scoped.slots.register({
                  name: 'settings.section',
                  id: 'approval-ledger',
                  order: 40,
                  locale: NS,
                  label: () => scoped.locale.bind(NS)('settingsTitle'),
                }, (props) => h(ReminderSettings, { ...props, form, __ctx: scoped })))
              }), 'approval-ledger: settings section')
            })
          }
        } catch (error) {
          console.error('dsh-approval-ledger client apply failed', error)
          throw error
        }
      },
    }
  },
})
