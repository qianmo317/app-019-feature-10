// E2E：模拟真实用户从首页点击到出图、保存、导出/导入、打印的全流程
import { test, expect, type Page } from '@playwright/test'

async function goto(page: Page, path = '/') {
  await page.goto(path)
  // 仅首页断言 home-page；其他路由由用例自行断言各自页面 testid
  if (path === '/' || path === '') {
    await expect(page.getByTestId('home-page')).toBeVisible()
  }
}

test.describe('全流程：选类型 → 填尺寸 → 出三视图 → 打印 1:1 模板（蓝图 §12 验收）', () => {
  test('新建燕尾榫方案 → 编辑器出图 → 保存 → 列表可检索', async ({ page }) => {
    await goto(page)
    await page.getByTestId('new-plan').click()

    // 选类型
    await page.getByTestId('kind-dovetail').click()
    await page.getByTestId('a-width').fill('240')
    await page.getByTestId('create-plan').click()

    // 编辑器：三视图 + 齿宽表 + 切割步骤
    await expect(page.getByTestId('editor-page')).toBeVisible()
    await expect(page.locator('[data-view="front"]')).toBeVisible()
    await expect(page.locator('[data-view="top"]')).toBeVisible()
    await expect(page.locator('[data-view="side"]')).toBeVisible()
    await expect(page.getByTestId('tooth-table')).toBeVisible()
    await expect(page.getByTestId('cut-steps')).toBeVisible()
    await expect(page.getByTestId('recalc-ms')).toContainText(/重算耗时 [\d.]+ms/)

    // 保存 → 回列表
    await page.getByTestId('save-plan').click()
    await expect(page.getByTestId('dirty-bar')).toBeHidden()
    await page.getByTestId('nav-home').click()
    const card = page.getByTestId('plan-card').first()
    await expect(card).toContainText('燕尾榫（穿透式）')
    await expect(card).toContainText('240')
  })

  test('参数改动 → 脏状态提示 → 保存后消失；警告场景（齿数过多）', async ({ page }) => {
    await goto(page, '/#/new')
    await page.getByTestId('kind-dovetail').click()
    await page.getByTestId('a-width').fill('60')
    await page.getByTestId('teeth').fill('12')
    await page.getByTestId('create-plan').click()

    await expect(page.getByTestId('editor-page')).toBeVisible()
    // 齿数过多：齿根低于最小安全值 → 警告不静默
    const warnings = page.getByTestId('warnings')
    await expect(warnings).toBeVisible()
    await expect(warnings).toContainText('低于硬木最小安全值')
    await expect(warnings).toContainText('建议减少齿数')

    // 改动出现脏条，保存后消失
    await page.getByTestId('kerf').fill('2.2')
    await expect(page.getByTestId('dirty-bar')).toBeVisible()
    await page.getByTestId('save-plan').click()
    await expect(page.getByTestId('dirty-bar')).toBeHidden()
  })

  test('键盘方向键微调 0.5mm（蓝图 §9）', async ({ page }) => {
    await goto(page, '/#/new')
    await page.getByTestId('kind-dovetail').click()
    const input = page.getByTestId('a-thickness')
    await input.focus()
    await page.keyboard.press('ArrowUp')
    await expect(input).toHaveValue('18.5')
    await page.keyboard.press('ArrowDown')
    await expect(input).toHaveValue('18')
  })

  test('导出 JSON → 删除 → 导入 → 参数与图纸完全一致（蓝图 §10）', async ({ page }) => {
    await goto(page, '/#/new')
    await page.getByTestId('kind-dovetail').click()
    await page.getByTestId('a-width').fill('240')
    await page.getByTestId('teeth').fill('8')
    await page.getByTestId('create-plan').click()
    await expect(page.getByTestId('editor-page')).toBeVisible()

    // 导出（捕获下载）
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-json').click(),
    ])
    const path = await download.path()
    expect(path).toBeTruthy()

    // 记录导出前图纸关键数据
    const frontBox = await page.locator('[data-view="front"]').getAttribute('viewBox')
    const topBox = await page.locator('[data-view="top"]').getAttribute('viewBox')
    expect(frontBox).toBeTruthy()
    // 三视图一致性：正视图与俯视图内容宽度相同（viewBox 宽相等）
    expect(frontBox!.split(' ')[2]).toBe(topBox!.split(' ')[2])

    // 回列表，删除该方案，再导入同一文件
    await page.getByTestId('nav-home').click()
    await expect(page.getByTestId('plan-card')).toHaveCount(1)
    await page.locator('[data-testid^="delete-"]').click()
    await expect(page.getByTestId('plan-card')).toHaveCount(0)

    await page.setInputFiles('[data-testid="import-input"]', path!)
    await expect(page.getByTestId('plan-card')).toHaveCount(1)

    // 打开导入的方案：参数一致
    await page.getByTestId('plan-card').first().click()
    await expect(page.getByTestId('editor-page')).toBeVisible()
    await expect(page.getByTestId('a-width')).toHaveValue('240')
    await expect(page.getByTestId('teeth')).toHaveValue('8')
    expect(await page.locator('[data-view="front"]').getAttribute('viewBox')).toBe(frontBox)
  })

  test('打印视图：按块分页 + 页眉页码 + 燕尾齿号索引 + 打印调用', async ({ page }) => {
    // 拦截 window.print
    await page.addInitScript(() => {
      ;(window as unknown as { __printed: boolean }).__printed = false
      window.print = () => {
        ;(window as unknown as { __printed: boolean }).__printed = true
      }
    })
    await goto(page, '/#/new')
    await page.getByTestId('kind-dovetail').click()
    await page.getByTestId('create-plan').click()
    await page.getByTestId('go-print').click()

    await expect(page.getByTestId('print-page')).toBeVisible()
    // 燕尾：三视图各一页 + 1:1 模板（200mm 默认板切 2 张）+ 校验尺 + 齿号索引 + 切割步骤 = 8 页
    await expect(page.getByTestId('print-sheet')).toHaveCount(8)
    // 页眉：方案名 / 榫卯类型 / 页别 / 第 N 页 / 共 M 页
    await expect(page.getByText('第 1 页 / 共 8 页')).toBeVisible()
    await expect(page.getByText('第 8 页 / 共 8 页')).toBeVisible()
    await expect(page.locator('.psh-kind').first()).toHaveText('燕尾榫（穿透式）')
    // 校验尺与模板页保留
    await expect(page.getByTestId('check-ruler')).toBeVisible()
    await expect(page.getByTestId('check-ruler')).toContainText('100mm')
    // 1:1 模板按 188mm 切片成 2 张拼贴
    await expect(page.locator('.psh-label', { hasText: '1:1 模板页' })).toHaveCount(2)
    await expect(page.getByTestId('template-tile')).toHaveCount(2)
    // 齿号索引：逐齿列出齿顶宽/齿根宽/中心位置
    const idxRows = page.locator('[data-testid="tooth-index-table"] tbody tr')
    expect(await idxRows.count()).toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('tooth-index')).toContainText('中心位置')
    await page.getByTestId('do-print').click()
    const printed = await page.evaluate(() => (window as unknown as { __printed: boolean }).__printed)
    expect(printed).toBe(true)
  })

  test('六种榫卯类型均可出图（类型切换联动）', async ({ page }) => {
    const kinds = [
      'half-blind-dovetail',
      'mortise-tenon',
      'dowel',
      'lap',
      'panel-glue',
    ]
    for (const kind of kinds) {
      await goto(page, '/#/new')
      await page.getByTestId(`kind-${kind}`).click()
      await page.getByTestId('create-plan').click()
      await expect(page.getByTestId('editor-page')).toBeVisible()
      await expect(page.locator('[data-view="front"]')).toBeVisible()
      await expect(page.locator('[data-view="top"]')).toBeVisible()
      await expect(page.locator('[data-view="side"]')).toBeVisible()
      await expect(page.getByTestId('cut-steps')).toBeVisible()
    }
  })

  test('知识卡页面展示 7 张经验卡', async ({ page }) => {
    await goto(page, '/#/library')
    await expect(page.getByTestId('library-page')).toBeVisible()
    await expect(page.getByTestId('knowledge-card')).toHaveCount(7)
  })
})
