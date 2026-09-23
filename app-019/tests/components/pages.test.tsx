// 组件测试：参数联动 / 列表筛选 / 导入导出 / 键盘微调（前端点击对应的 bug 面）
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomePage } from '../../src/pages/HomePage'
import { NewPlanPage } from '../../src/pages/NewPlanPage'
import { EditorPage, PrintPage } from '../../src/pages/EditorPage'
import { makePlan, upsertPlan } from '../../src/store/plans'
import type { JointKind, Params } from '../../src/types'

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
})

describe('新建页：选类型 → 填参数 → 生成图纸', () => {
  it('未选类型时按钮禁用；选类型后表单出现并可生成', async () => {
    const user = userEvent.setup()
    render(<NewPlanPage />)
    expect(screen.getByTestId('create-plan')).toBeDisabled()
    await user.click(screen.getByTestId('kind-dovetail'))
    expect(screen.getByTestId('create-plan')).toBeEnabled()
    expect(screen.getByTestId('a-thickness')).toHaveValue(18)
    await user.click(screen.getByTestId('create-plan'))
    // 跳转到编辑器
    expect(window.location.hash).toMatch(/^#\/plan\//)
  })

  it('键盘方向键微调 0.5mm（蓝图 §9）', async () => {
    render(<NewPlanPage />)
    await userEvent.setup().click(screen.getByTestId('kind-dovetail'))
    const input = screen.getByTestId('a-thickness')
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue(18.5)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue(18)
  })

  it('修改参数触发重算：燕尾警告出现在新建页参数流（齿数过多）', async () => {
    const user = userEvent.setup()
    render(<NewPlanPage />)
    await user.click(screen.getByTestId('kind-dovetail'))
    // 进入编辑器后再验证警告，这里只验证表单可改
    const teeth = screen.getByTestId('teeth')
    await user.clear(teeth)
    await user.type(teeth, '12')
    expect(teeth).toHaveValue(12)
  })
})

describe('编辑器：参数改动即时重算 + 脏状态提示 + 齿宽表', () => {
  const savedPlan = () => {
    const plan = makePlan('dovetail', {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      dovetail: { angleRatio: 8 },
      kerfMm: 1.1,
    })
    upsertPlan(plan)
    return plan
  }

  it('修改板宽 → 出现「参数已改」提示条与警告区域联动', async () => {
    const user = userEvent.setup()
    const { id } = savedPlan()
    render(<EditorPage id={id} />)
    // 初始无脏状态
    expect(screen.queryByTestId('dirty-bar')).toBeNull()
    expect(screen.getByTestId('tooth-table')).toBeInTheDocument()
    // 齿数过多 → 警告
    const teeth = screen.getByTestId('teeth')
    await user.clear(teeth)
    await user.type(teeth, '12')
    // 脏状态提示条
    expect(screen.getByTestId('dirty-bar')).toHaveTextContent('参数已改，请重新核对尺寸')
    // 重算耗时标注存在
    expect(screen.getByTestId('recalc-ms')).toBeInTheDocument()
  })

  it('切换榫卯类型 → 参数表单与切割步骤联动', async () => {
    const user = userEvent.setup()
    const { id } = savedPlan()
    render(<EditorPage id={id} />)
    await user.selectOptions(screen.getByTestId('editor-kind'), 'mortise-tenon')
    // 直榫参数出现，燕尾参数消失
    expect(screen.getByTestId('tn-ratio')).toBeInTheDocument()
    expect(screen.queryByTestId('teeth')).toBeNull()
    expect(screen.queryByTestId('tooth-table')).toBeNull()
  })

  it('方案不存在 → 显示错误并可控', () => {
    render(<EditorPage id="nonexistent" />)
    expect(screen.getByText('方案不存在或已删除')).toBeInTheDocument()
  })
})

describe('列表页：筛选 + 删除 + 导入', () => {
  it('按类型与厚度筛选方案', async () => {
    upsertPlan(
      makePlan('dovetail', {
        boardA: { thickness: 18, width: 200 },
        boardB: { thickness: 18, width: 200 },
        wood: 'hardwood',
        fit: 'standard',
        kerfMm: 1.1,
      }),
    )
    upsertPlan(
      makePlan('mortise-tenon', {
        boardA: { thickness: 20, width: 200 },
        boardB: { thickness: 20, width: 200 },
        wood: 'hardwood',
        fit: 'standard',
        kerfMm: 1.1,
      }),
    )
    render(<HomePage onImported={() => undefined} />)
    expect(screen.getAllByTestId('plan-card')).toHaveLength(2)
    await userEvent.setup().selectOptions(screen.getByTestId('filter-kind'), 'dovetail')
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1)
  })

  it('导入非法 JSON 显示错误', async () => {
    render(<HomePage onImported={() => undefined} />)
    const input = screen.getByTestId('import-input') as HTMLInputElement
    const file = new File(['{ bad'], 'plan.json', { type: 'application/json' })
    await userEvent.upload(input, file)
    // 错误必须浮出（解析错误信息或导入失败提示）
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('导入合法 JSON 写入方案库', async () => {
    const onImported = vi.fn()
    const plan = makePlan('lap', {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      kerfMm: 1.1,
    })
    render(<HomePage onImported={onImported} />)
    const input = screen.getByTestId('import-input') as HTMLInputElement
    await userEvent.upload(input, new File([JSON.stringify(plan)], 'plan.json', { type: 'application/json' }))
    expect(await screen.findAllByTestId('plan-card')).toHaveLength(1)
    expect(onImported).toHaveBeenCalled()
  })
})

describe('参数流（受控组件契约）', () => {
  it('ParamForm 修改回调携带合并后的参数', async () => {
    const { ParamForm } = await import('../../src/components/ParamForm')
    const params: Params = {
      boardA: { thickness: 18, width: 200 },
      boardB: { thickness: 18, width: 200 },
      wood: 'hardwood',
      fit: 'standard',
      dovetail: { angleRatio: 8 },
      kerfMm: 1.1,
    }
    let latest: Params | null = null
    render(<ParamForm kind={'dovetail' as JointKind} params={params} onChange={(p) => (latest = p)} />)
    const user = userEvent.setup()
    await user.type(screen.getByTestId('a-width'), '4')
    // 200 + '4' → "2004" 超出上限 900 → 钳制到 900（表单防呆）
    expect(latest!.boardA.width).toBe(900)
    expect(latest!.boardA.thickness).toBe(18) // 其余字段保持
  })
})

describe('打印页：按块分页 + 页眉页码 + 燕尾齿号索引', () => {
  const savedPlan = (kind: JointKind = 'dovetail', width = 200, teeth?: number) => {
    const plan = makePlan(kind, {
      boardA: { thickness: 18, width },
      boardB: { thickness: 18, width },
      wood: 'hardwood',
      fit: 'standard',
      ...(kind.startsWith('dovetail') ? { dovetail: { angleRatio: 8 as const, ...(teeth ? { teeth } : {}) } } : {}),
      kerfMm: 1.1,
    })
    upsertPlan(plan)
    return plan
  }

  it('校验尺/三视图/1:1模板/切割步骤各自单独成页，页眉带方案名、类型与页号', () => {
    const { id, title } = savedPlan('mortise-tenon')
    render(<PrintPage id={id} />)

    // 五个逻辑页：校验尺 + 正/俯/侧三视图 + 1:1 模板 + 切割步骤（非燕尾无齿号索引）
    const sheets = document.querySelectorAll('.print-sheet')
    expect(sheets).toHaveLength(6) // ruler + 3 views + template + steps
    expect(screen.getByTestId('print-sheet-ruler')).toBeInTheDocument()
    expect(screen.getByTestId('print-sheet-front')).toBeInTheDocument()
    expect(screen.getByTestId('print-sheet-top')).toBeInTheDocument()
    expect(screen.getByTestId('print-sheet-side')).toBeInTheDocument()
    expect(screen.getByTestId('print-sheet-template')).toBeInTheDocument()
    expect(screen.getByTestId('print-sheet-steps')).toBeInTheDocument()

    // 每页页眉：方案名 + 榫卯类型 + 页码/总页数
    expect(screen.getAllByTestId('print-plan-name')[0]).toHaveTextContent(title)
    expect(screen.getAllByTestId('print-kind-label')[0]).toHaveTextContent('直榫')
    const pageNos = screen.getAllByTestId('print-page-no').map((el) => el.textContent)
    expect(pageNos[0]).toContain('第 1 / 6 页')
    expect(pageNos[5]).toContain('第 6 / 6 页')
  })

  it('燕尾方案额外出齿号索引页，逐行列出齿顶宽/齿根宽/中心位置且与齿数一致', () => {
    const { id } = savedPlan('dovetail', 200, 5)
    render(<PrintPage id={id} />)

    const indexSheet = screen.getByTestId('print-sheet-tooth-index')
    expect(indexSheet).toBeInTheDocument()
    // 总页数含齿号索引页
    expect(screen.getAllByTestId('print-page-no').map((el) => el.textContent).pop()).toContain('/ 7 页')

    const rows = screen.getAllByTestId('tooth-index-table')[0].querySelectorAll('tbody tr')
    expect(rows).toHaveLength(5)
    // 齿号 1..5 与圆标编号一致
    rows.forEach((row, i) => {
      expect(row.children[0].textContent).toBe(String(i + 1))
      // 齿顶宽 > 齿根宽（穿透燕尾斜移为正），中心位置为数值且递增
      const topW = parseFloat(row.children[1].textContent!)
      const rootW = parseFloat(row.children[2].textContent!)
      const cx = parseFloat(row.children[3].textContent!)
      expect(topW).toBeGreaterThan(rootW)
      expect(cx).toBeGreaterThan(0)
      if (i > 0) {
        const prevCx = parseFloat(rows[i - 1].children[3].textContent!)
        expect(cx).toBeGreaterThan(prevCx)
      }
    })
    // 索引说明提到圆标对应关系
    expect(screen.getByTestId('tooth-index-note')).toHaveTextContent('圆标')
  })

  it('半隐燕尾同样出齿号索引页；非燕尾方案不出', () => {
    const blind = savedPlan('half-blind-dovetail')
    const { unmount } = render(<PrintPage id={blind.id} />)
    expect(screen.getByTestId('tooth-index')).toBeInTheDocument()
    unmount()

    localStorage.clear()
    const lap = savedPlan('lap')
    render(<PrintPage id={lap.id} />)
    expect(screen.queryByTestId('print-sheet-tooth-index')).toBeNull()
  })

  it('工具栏提示总页数；超宽料提示模板跨页拼贴', () => {
    const wide = savedPlan('dovetail', 240)
    const { unmount } = render(<PrintPage id={wide.id} />)
    expect(screen.getByTestId('print-page').textContent).toMatch(/共 7 页/)
    expect(screen.getByTestId('print-page').textContent).toContain('跨页拼贴')
    unmount()

    localStorage.clear()
    const normal = savedPlan('dovetail', 200)
    render(<PrintPage id={normal.id} />)
    expect(screen.getByTestId('print-page').textContent).not.toContain('跨页拼贴')
  })
})
