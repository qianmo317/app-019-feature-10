// 图纸编辑器：左参数 | 中三视图 | 右切割步骤与提示（蓝图 §6）
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { Drawing, JointKind, Params, Wood, Fit } from '../types'
import { KIND_LABEL } from '../types'
import { computeJoint } from '../lib/calc'
import { buildViews } from '../geometry/views'
import type { ViewModel } from '../geometry/views'
import { buildCutList } from '../lib/cutlist'
import { fmt01 } from '../lib/format'
import { getPlan, upsertPlan, downloadJSON, deletePlan } from '../store/plans'
import { navigate } from '../router'
import { ViewSvg, CheckRuler, TemplateTilePage, naturalMm, templateTiles } from '../components/ViewSvg'
import { ParamForm } from '../components/ParamForm'
import { DEFAULT_FIT_TABLE, WOOD_LABEL, loadFitTable, saveFitTable, type FitTable } from '../lib/fit'

export function EditorPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Drawing | undefined>(() => getPlan(id))
  const [dirty, setDirty] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const recalcMs = useRef(0)

  // 参数改动即时重算（验收：<100ms）
  const computed = useMemo(() => {
    if (!plan) return null
    const t0 = performance.now()
    const r = computeJoint(plan.joints[0])
    const views = buildViews(plan.joints[0], r)
    recalcMs.current = performance.now() - t0
    return { result: r, views, cut: buildCutList(plan.joints[0], r.dovetail, r.tenon) }
  }, [plan, savedTick])

  if (!plan) {
    return (
      <div className="page">
        <p className="error">方案不存在或已删除</p>
        <button className="btn" onClick={() => navigate('/')}>回方案列表</button>
      </div>
    )
  }

  const joint = plan.joints[0]

  const updateParams = (p: Params) => {
    setPlan((prev) =>
      prev
        ? { ...prev, joints: [{ ...prev.joints[0], params: p }], updatedAt: Date.now() }
        : prev,
    )
    setDirty(true)
  }
  const updateKind = (k: JointKind) => {
    setPlan((prev) => (prev ? { ...prev, joints: [{ ...prev.joints[0], kind: k }], updatedAt: Date.now() } : prev))
    setDirty(true)
  }

  const save = () => {
    if (!plan) return
    upsertPlan(plan)
    setDirty(false)
    setSavedTick((t) => t + 1)
  }

  return (
    <div className="page editor-page" data-testid="editor-page">
      <div className="page-head">
        <h1>{plan.title}</h1>
        <div className="head-actions">
          <button className="btn btn-secondary" data-testid="export-json" onClick={() => downloadJSON(plan)}>
            导出 JSON
          </button>
          <button className="btn btn-secondary" data-testid="go-print" onClick={() => navigate(`/plan/${plan.id}/print`)}>
            打印视图
          </button>
          <button className="btn btn-primary" data-testid="save-plan" onClick={save}>
            保存
          </button>
        </div>
      </div>

      {dirty && (
        <div className="dirty-bar" role="status" data-testid="dirty-bar">
          参数已改，请重新核对尺寸
          <button className="btn btn-sm btn-primary" onClick={save}>保存</button>
        </div>
      )}

      <div className="editor-grid">
        <aside className="col-params">
          <h2>榫卯类型</h2>
          <select
            data-testid="editor-kind"
            value={joint.kind}
            onChange={(e) => updateKind(e.target.value as JointKind)}
          >
            {(Object.keys(KIND_LABEL) as JointKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <h2>参数</h2>
          <ParamForm kind={joint.kind} params={joint.params} onChange={updateParams} />
          <FitTableEditor />
        </aside>

        <main className="col-views">
          {computed && computed.result.warnings.length > 0 && (
            <div className="warnings" role="alert" data-testid="warnings">
              {computed.result.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
          <div className="views" data-testid="views">
            {computed?.views.map((vm) => <ViewSvg key={vm.id} vm={vm} />)}
          </div>
          <p className="note" data-testid="recalc-ms">重算耗时 {recalcMs.current.toFixed(1)}ms（要求 &lt;100ms）</p>
          {computed && isDovetailKind(joint.kind) && computed.result.dovetail && (
            <ToothTable dt={computed.result.dovetail} />
          )}
        </main>

        <aside className="col-steps">
          <h2>切割步骤</h2>
          {computed && <CutSteps cut={computed.cut} />}
          <button
            className="btn btn-danger btn-sm"
            data-testid="delete-plan"
            onClick={() => {
              deletePlan(plan.id)
              navigate('/')
            }}
          >
            删除方案
          </button>
        </aside>
      </div>
    </div>
  )
}

function ToothTable({ dt }: { dt: NonNullable<ReturnType<typeof computeJoint>['dovetail']> }) {
  return (
    <div className="tooth-table-wrap">
      <h2>齿宽分配表</h2>
      <table className="tooth-table" data-testid="tooth-table">
        <thead>
          <tr>
            <th>齿号</th>
            <th>齿顶宽</th>
            <th>齿根宽</th>
            <th>距左端</th>
          </tr>
        </thead>
        <tbody>
          {dt.teeth.map((t) => (
            <tr key={t.index}>
              <td>{t.index}</td>
              <td>{fmt01(t.topW)}</td>
              <td>{fmt01(t.rootW)}</td>
              <td>{fmt01(t.faceX)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">闭合误差 {dt.closureError.toFixed(3)}mm；半齿边距 {fmt01(dt.margin)}mm（左右对称）</p>
    </div>
  )
}

function CutSteps({ cut }: { cut: ReturnType<typeof buildCutList> }) {
  return (
    <div data-testid="cut-steps">
      <h3>件 A</h3>
      <ol className="steps">
        {cut.boardA.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h3>件 B</h3>
      <ol className="steps">
        {cut.boardB.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h3>注意事项</h3>
      <ul className="cautions">
        {cut.cautions.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  )
}

export function FitTableEditor() {
  const [table, setTable] = useState<FitTable>(() => loadFitTable())
  const [saved, setSaved] = useState(false)
  const set = (wood: Wood, fit: Fit, v: number) => {
    setSaved(false)
    setTable((prev) => ({ ...prev, [wood]: { ...prev[wood], [fit]: v } }))
  }
  return (
    <details className="fit-table-editor">
      <summary>配合余量表（经验值，可编辑）</summary>
      <table className="fit-table">
        <thead>
          <tr>
            <th></th>
            <th>紧</th>
            <th>标准</th>
            <th>松</th>
          </tr>
        </thead>
        <tbody>
          {(['hardwood', 'softwood'] as Wood[]).map((w) => (
            <tr key={w}>
              <th>{WOOD_LABEL[w]}</th>
              {(['tight', 'standard', 'loose'] as Fit[]).map((f) => (
                <td key={f}>
                  <input
                    type="number"
                    step={0.1}
                    aria-label={`${w}-${f}`}
                    value={table[w][f]}
                    onChange={(e) => set(w, f, parseFloat(e.target.value) || 0)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button
          className="btn btn-sm btn-primary"
          data-testid="save-fit-table"
          onClick={() => {
            saveFitTable(table)
            setSaved(true)
          }}
        >
          保存余量表
        </button>
        <button className="btn btn-sm" onClick={() => setTable(DEFAULT_FIT_TABLE)}>恢复默认</button>
        {saved && <span className="ok">已保存</span>}
      </div>
      <p className="note">来源：木工经验值（非标准规范）。榫厚 = 料厚×比例 + 表值。</p>
    </details>
  )
}

// A4 纸 210×297mm，@page 留白 10mm → 可打印区 190×277mm；页眉占约 14mm
const isDovetailKind = (k: JointKind) => k === 'dovetail' || k === 'half-blind-dovetail'
const VIEW_BOX = { w: 180, h: 250 }

const VIEW_LABEL: Record<string, string> = {
  front: '正视图',
  top: '俯视图',
  side: '侧视图',
}

/** 视图缩小到一页内的显示宽度（1:1 模板不缩放，走另一个页） */
function fitWidthMm(vm: ViewModel): number {
  const nat = naturalMm(vm)
  const s = Math.min(VIEW_BOX.w / nat.w, VIEW_BOX.h / nat.h, 1)
  return Math.max(1, nat.w * s)
}

export function PrintPage({ id }: { id: string }) {
  const plan = getPlan(id)
  if (!plan) return <div className="page"><p className="error">方案不存在</p></div>
  const joint = plan.joints[0]
  const r = computeJoint(joint)
  const views = buildViews(joint, r)
  const cut = buildCutList(joint, r.dovetail, r.tenon)
  const isDovetail = isDovetailKind(joint.kind)

  // 块顺序：三视图（每视图独立起页）→ 1:1 模板（超宽自动多页拼贴）→ 校验尺 → 燕尾齿号索引 → 切割步骤
  // 一个块可占多页（pages.length），页码与总页数按实际物理页累计
  type SheetBlock = { label: string; pages: { body: ReactNode; sub?: string }[] }
  const blocks: SheetBlock[] = []
  for (const vm of views) {
    blocks.push({
      label: `${VIEW_LABEL[vm.id] ?? vm.title}（尺寸标注）`,
      pages: [{
        body: (
          <div className="print-view-block">
            <ViewSvg vm={vm} widthMm={fitWidthMm(vm)} />
          </div>
        ),
      }],
    })
  }
  if (views[0]) {
    const tiles = templateTiles(views[0])
    const sub = tiles.length > 1
      ? `模板宽于 A4 单页，已按 1:1 切成 ${tiles.length} 张（沿标注竖边拼贴，切勿缩放）`
      : undefined
    blocks.push({
      label: '1:1 模板页（剪下贴在木料上描线）',
      pages: tiles.map((_, i) => ({
        sub: i === 0 ? sub : undefined,
        body: <TemplateTilePage vm={views[0]!} index={i} total={tiles.length} />,
      })),
    })
  }
  blocks.push({
    label: '打印校验尺（先校准 1:1）',
    pages: [{
      body: (
        <div className="print-view-block">
          <CheckRuler />
        </div>
      ),
    }],
  })
  if (isDovetail && r.dovetail) {
    blocks.push({
      label: '齿号索引（编号与图中圆标一致）',
      pages: [{ body: <ToothIndex dt={r.dovetail} ratio={joint.params.dovetail?.angleRatio ?? 8} /> }],
    })
  }
  blocks.push({
    label: '切割步骤',
    pages: [{ body: <CutSteps cut={cut} /> }],
  })

  const total = blocks.reduce((s, b) => s + b.pages.length, 0)
  let pageNo = 0
  return (
    <div className="page print-page" data-testid="print-page">
      <div className="print-toolbar no-print">
        <button className="btn btn-primary" data-testid="do-print" onClick={() => window.print()}>
          打印（1:1）
        </button>
        <button className="btn" onClick={() => navigate(`/plan/${plan.id}`)}>返回编辑</button>
        <span className="note">共 {total} 页：A4、纵向、100% 缩放；打印前关闭「适应页面/缩放」，先用校验尺核对</span>
      </div>
      {blocks.map((b, bi) =>
        b.pages.map((pg, pi) => {
          pageNo += 1
          const same = b.pages.length > 1 ? `（${pi + 1}/${b.pages.length}）` : ''
          return (
            <section className="print-sheet" key={`${bi}-${pi}`} data-testid="print-sheet">
              <header className="print-sheet-head">
                <div className="psh-left">
                  <strong className="psh-title" data-testid="psh-title">{plan.title}</strong>
                  <span className="psh-kind">{KIND_LABEL[joint.kind]}</span>
                  <span className="psh-label">{b.label}{same}</span>
                  {pg.sub && <span className="psh-sub">{pg.sub}</span>}
                </div>
                <div className="psh-page">第 {pageNo} 页 / 共 {total} 页</div>
              </header>
              <div className="print-sheet-body">{pg.body}</div>
            </section>
          )
        }),
      )}
    </div>
  )
}

/** 燕尾齿号索引：逐行列齿顶宽/齿根宽/中心位置，编号与视图圆标一一对应 */
function ToothIndex({
  dt,
  ratio,
}: {
  dt: NonNullable<ReturnType<typeof computeJoint>['dovetail']>
  ratio: 6 | 7 | 8
}) {
  return (
    <div className="tooth-index" data-testid="tooth-index">
      <p className="note">
        编号与正视图/俯视图中的圆标数字一致（从拼接端左到右）；中心位置 = 齿左缘 + 齿顶宽÷2，
        以齿板展示面左边缘为 0。
      </p>
      <table className="tooth-table tooth-index-table" data-testid="tooth-index-table">
        <thead>
          <tr>
            <th>齿号</th>
            <th>齿顶宽 mm（展示面）</th>
            <th>齿根宽 mm（背面）</th>
            <th>中心位置 mm（距左端）</th>
          </tr>
        </thead>
        <tbody>
          {dt.teeth.map((t) => (
            <tr key={t.index}>
              <td><span className="tooth-badge">{t.index}</span></td>
              <td>{fmt01(t.topW)}</td>
              <td>{fmt01(t.rootW)}</td>
              <td>{fmt01(t.faceX + t.topW / 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        共 {dt.teeth.length} 齿；斜度 1:{ratio}，单边斜移 {fmt01(dt.slopeOffset)}mm；
        半齿边距 {fmt01(dt.margin)}mm（左右对称）；闭合误差 {dt.closureError.toFixed(3)}mm。
      </p>
    </div>
  )
}
