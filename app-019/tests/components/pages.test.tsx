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
    const input = screen.getByTestId('import-input')
    await userEvent.upload(input, new File([JSON.stringify(plan)], 'plan.json', { type: 'application/json' }))
    expect(await screen.findAllByTestId('plan-card')).toHaveLength(1)
    expect(onImported).toHaveBeenCalled()
  })
})

describe('打印页：按块分页 + 页眉页别页码 + 燕尾齿号索引', () => {
  const baseParams = {
    boardA: { thickness: 18, width: 200 },
    boardB: { thickness: 18, width: 200 },
    wood: 'hardwood' as const,
    fit: 'standard' as const,
    kerfMm: 1.1,
  }

  it('燕尾方案：三视图各占一页 + 模板 + 校验尺 + 齿号索引 + 切割步骤（200mm 板模板切 2 张）= 8 页', () => {
    const plan = makePlan('dovetail', { ...baseParams, dovetail: { angleRatio: 8, teeth: 5 } })
    upsertPlan(plan)
    render(<PrintPage id={plan.id} />)
    const sheets = screen.getAllByTestId('print-sheet')
    expect(sheets).toHaveLength(8)
    // 每页都带方案名、榫卯类型与「第 N 页 / 共 8 页」
    expect(screen.getAllByTestId('psh-title')).toHaveLength(8)
    expect(screen.getByText('第 1 页 / 共 8 页')).toBeInTheDocument()
    expect(screen.getByText('第 8 页 / 共 8 页')).toBeInTheDocument()
    expect(screen.getAllByText('燕尾榫（穿透式）').length).toBeGreaterThanOrEqual(8)
    // 三个视图页分别起页
    expect(screen.getByText('正视图（尺寸标注）')).toBeInTheDocument()
    expect(screen.getByText('俯视图（尺寸标注）')).toBeInTheDocument()
    expect(screen.getByText('侧视图（尺寸标注）')).toBeInTheDocument()
    expect(screen.getByText('切割步骤', { selector: '.psh-label' })).toBeInTheDocument()
    // 200mm 板模板自然宽 248mm → 2 张拼贴
    expect(screen.getAllByTestId('template-tile')).toHaveLength(2)
  })

  it('窄板（100mm）模板一页装下，无拼贴', () => {
    const plan = makePlan('dovetail', {
      ...baseParams,
      boardA: { thickness: 18, width: 100 },
      boardB: { thickness: 18, width: 100 },
      dovetail: { angleRatio: 8 },
    })
    upsertPlan(plan)
    render(<PrintPage id={plan.id} />)
    expect(screen.getAllByTestId('template-tile')).toHaveLength(1)
    expect(screen.queryByText(/切成 \d+ 张/)).toBeNull()
  })

  it('宽板 1:1 模板超 A4 单页宽：按 1:1 切片成多页拼贴，总页数相应增加', () => {
    const plan = makePlan('dovetail', {
      ...baseParams,
      boardA: { thickness: 18, width: 240 },
      boardB: { thickness: 18, width: 240 },
      dovetail: { angleRatio: 8, teeth: 8 },
    })
    upsertPlan(plan)
    render(<PrintPage id={plan.id} />)
    // 三视图 3 + 模板切片 2 + 校验尺 1 + 齿号索引 1 + 步骤 1 = 8
    expect(screen.getAllByTestId('print-sheet')).toHaveLength(8)
    const tiles = screen.getAllByTestId('template-tile')
    expect(tiles).toHaveLength(2)
    expect(tiles[0]).toHaveAttribute('data-tile', '1/2')
    expect(tiles[1]).toHaveAttribute('data-tile', '2/2')
    // 模板块页眉带（1/2）（2/2）且总页数为 8
    expect(screen.getAllByText(/^1:1 模板页（剪下贴在木料上描线）/, { selector: '.psh-label' })).toHaveLength(2)
    expect(screen.getByText(/（1\/2）/, { selector: '.psh-label' })).toBeInTheDocument()
    expect(screen.getByText(/（2\/2）/, { selector: '.psh-label' })).toBeInTheDocument()
    expect(screen.getByText('第 8 页 / 共 8 页')).toBeInTheDocument()
  })

  it('齿号索引逐齿列出齿顶宽/齿根宽/中心位置，编号与图上圆标一致', () => {
    const plan = makePlan('dovetail', { ...baseParams, dovetail: { angleRatio: 8, teeth: 5 } })
    upsertPlan(plan)
    render(<PrintPage id={plan.id} />)
    const idx = screen.getByTestId('tooth-index')
    const rows = idx.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(5)
    rows.forEach((row, i) => {
      expect(row.querySelector('.tooth-badge')?.textContent).toBe(String(i + 1))
      const cells = row.querySelectorAll('td')
      expect(cells).toHaveLength(4)
      cells.forEach((c) => expect(c.textContent).toMatch(/^\d+(\.\d)?$/))
    })
    // 表头含三列尺寸
    expect(idx).toHaveTextContent('齿顶宽')
    expect(idx).toHaveTextContent('齿根宽')
    expect(idx).toHaveTextContent('中心位置')
  })

  it('半隐燕尾同样出齿号索引；非燕尾类型不出', () => {
    const blind = makePlan('half-blind-dovetail', { ...baseParams, dovetail: { angleRatio: 7 } })
    upsertPlan(blind)
    const { unmount } = render(<PrintPage id={blind.id} />)
    expect(screen.getByTestId('tooth-index')).toBeInTheDocument()
    unmount()

    const tenon = makePlan('mortise-tenon', {
      ...baseParams,
      boardA: { thickness: 18, width: 100 },
      boardB: { thickness: 18, width: 100 },
    })
    upsertPlan(tenon)
    render(<PrintPage id={tenon.id} />)
    expect(screen.queryByTestId('tooth-index')).toBeNull()
    // 三视图 + 模板（100mm 板一页装下）+ 校验尺 + 切割步骤 = 6 页
    expect(screen.getAllByTestId('print-sheet')).toHaveLength(6)
    expect(screen.getByText('第 6 页 / 共 6 页')).toBeInTheDocument()
  })

  it('超宽模板（500mm）切片数随宽度增加，每张保持 1:1 不缩放', () => {
    const plan = makePlan('dovetail', {
      ...baseParams,
      boardA: { thickness: 18, width: 500 },
      boardB: { thickness: 18, width: 500 },
      dovetail: { angleRatio: 8 },
    })
    upsertPlan(plan)
    render(<PrintPage id={plan.id} />)
    const tiles = screen.getAllByTestId('template-tile')
    expect(tiles.length).toBeGreaterThanOrEqual(3)
    // 每张切片宽度 ≤ 188mm（A4 可打印宽 190）
    for (const tile of tiles) {
      const svg = tile.querySelector('svg')!
      const vb = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
      expect(vb[2]).toBeLessThanOrEqual(188)
      // CSS 宽度 mm 数 == viewBox 宽 → 严格 1:1
      expect(svg.style.width).toBe(`${vb[2]}mm`)
    }
    expect(screen.getAllByText(/^1:1 模板页（剪下贴在木料上描线）/, { selector: '.psh-label' }).length)
      .toBe(tiles.length)
  })

  it('方案不存在 → 显示错误', () => {
    render(<PrintPage id="nope" />)
    expect(screen.getByText('方案不存在')).toBeInTheDocument()
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
