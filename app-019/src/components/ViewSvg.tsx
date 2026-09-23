// SVG 渲染器：白底黑线 + 浅蓝细尺寸线 + 齿序编号圆标（黑白打印友好）
import type { ViewModel, VDim, VLine } from '../geometry/views'

export const PAD = { l: 22, r: 26, t: 26, b: 40 }

/** 1:1 自然打印宽度（mm）：内容 + 尺寸标注留白 */
export function naturalMm(vm: ViewModel): { w: number; h: number } {
  return { w: vm.contentW + PAD.l + PAD.r, h: vm.contentH + PAD.t + PAD.b }
}

function lineEl(l: VLine, key: number) {
  const clsMap: Record<VLine['cls'], string> = {
    cut: 'ln-cut',
    thin: 'ln-thin',
    saw: 'ln-saw',
    hidden: 'ln-hidden',
  }
  return <line key={key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={clsMap[l.cls]} />
}

function dimEl(d: VDim, i: number) {
  const isH = d.orient === 'h'
  const x1 = isH ? d.from : d.at
  const y1 = isH ? d.at : d.from
  const x2 = isH ? d.to : d.at
  const y2 = isH ? d.at : d.to
  const tick = 2.5
  const ticks = isH ? (
    <>
      <line x1={x1} y1={y1 - tick} x2={x1} y2={y1 + tick} className="ln-dim" />
      <line x1={x2} y1={y2 - tick} x2={x2} y2={y2 + tick} className="ln-dim" />
    </>
  ) : (
    <>
      <line x1={x1 - tick} y1={y1} x2={x1 + tick} y2={y1} className="ln-dim" />
      <line x1={x2 - tick} y1={y2} x2={x2 + tick} y2={y2} className="ln-dim" />
    </>
  )
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const label = isH ? (
    <text x={mx} y={y1 - 2} textAnchor="middle" className="dim-text">{d.label}</text>
  ) : (
    <text
      x={x1 + (d.at < 0 ? -3 : 3)}
      y={my}
      textAnchor="middle"
      className="dim-text"
      transform={`rotate(${d.at < 0 ? -90 : 90} ${x1 + (d.at < 0 ? -3 : 3)} ${my})`}
    >
      {d.label}
    </text>
  )
  return (
    <g key={`dim${i}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="ln-dim" />
      {ticks}
      {label}
    </g>
  )
}

function ViewContents({ vm }: { vm: ViewModel }) {
  return (
    <g transform={`translate(${PAD.l}, ${PAD.t})`}>
      <rect x={0} y={0} width={vm.contentW} height={vm.contentH} fill="none" stroke="none" />
      {vm.lines.map((l, i) => lineEl(l, i))}
      {vm.dims.map((d, i) => dimEl(d, i))}
      {vm.texts.map((t, i) => (
        <text
          key={`t${i}`}
          x={t.x}
          y={t.y}
          textAnchor={t.anchor ?? 'start'}
          className={`view-text ${t.cls ?? ''}`}
        >
          {t.text}
        </text>
      ))}
      {vm.marks.map((m, i) => (
        <g key={`m${i}`}>
          <circle cx={m.x} cy={m.y} r={4.5} className="mark-circle" />
          <text x={m.x} y={m.y + 2} textAnchor="middle" className="mark-text">
            {m.text}
          </text>
        </g>
      ))}
    </g>
  )
}

export function ViewSvg({ vm, widthMm }: { vm: ViewModel; widthMm?: number }) {
  const w = vm.contentW + PAD.l + PAD.r
  const h = vm.contentH + PAD.t + PAD.b
  const style = widthMm ? { width: `${widthMm}mm` } : undefined
  return (
    <svg
      data-view={vm.id}
      viewBox={`0 0 ${w} ${h}`}
      style={style}
      className="view-svg"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ViewContents vm={vm} />
      <text x={4} y={h - 6} className="view-title">
        {vm.title}
      </text>
    </svg>
  )
}

/** 1:1 模板切片宽度（mm）：A4 可打印宽 190，留 2mm 边 */
export const TEMPLATE_TILE_W = 188

/**
 * 1:1 模板：宽于单页时按 TILE_W 横向切片。SVG 坐标中内容位于
 * [PAD.l, PAD.l+contentW]；首片视窗从 0 开始（带左侧标注留白），
 * 覆盖内容 0..(TILE_W-PAD.l)；后续片视窗按内容坐标连续推进，
 * 片间以「内容 C_i 处竖边」为拼贴对齐边。每片严格 1:1。
 */
export function templateTiles(vm: ViewModel): { x: number; w: number }[] {
  const nat = naturalMm(vm)
  if (nat.w <= TEMPLATE_TILE_W) return [{ x: 0, w: nat.w }]
  const tiles: { x: number; w: number }[] = []
  const firstSpan = TEMPLATE_TILE_W - PAD.l // 首片覆盖的内容宽度
  tiles.push({ x: 0, w: TEMPLATE_TILE_W })
  for (let c = firstSpan; c < vm.contentW; c += TEMPLATE_TILE_W) {
    const start = PAD.l + c
    tiles.push({ x: start, w: Math.min(TEMPLATE_TILE_W, nat.w - start) })
  }
  return tiles
}

/** 单个模板切片（打印时一片一页，超宽模板多页拼贴，严格 1:1） */
export function TemplateTilePage({
  vm,
  index,
  total,
}: {
  vm: ViewModel
  index: number
  total: number
}) {
  const h = naturalMm(vm).h
  const t = templateTiles(vm)[index]
  if (!t) return null
  return (
    <div className="template-tile" data-testid="template-tile" data-tile={`${index + 1}/${total}`}>
      <svg
        viewBox={`${t.x} 0 ${t.w} ${h}`}
        xmlns="http://www.w3.org/2000/svg"
        className="view-svg template-svg"
        style={{ width: `${t.w}mm`, height: `${h}mm` }}
      >
        <ViewContents vm={vm} />
        {index > 0 && <line x1={t.x} y1={0} x2={t.x} y2={h} className="tile-join-line" />}
      </svg>
      <p className="note tile-cap">
        1:1 模板拼贴 {index + 1}/{total}：{index + 1 < total
          ? '沿本片右缘裁齐，与下一片左缘对接（图中 1mm = 实际 1mm，切勿缩放）'
          : '末片，含右侧尺寸标注'}
      </p>
    </div>
  )
}

/** 100mm 校验尺：打印后实测验证 1:1 */
export function CheckRuler() {
  const ticks = []
  for (let i = 0; i <= 100; i += 5) {
    const len = i % 10 === 0 ? 5 : i % 50 === 0 ? 6 : 3
    ticks.push(<line key={i} x1={i} y1={0} x2={i} y2={len} className="ln-cut" />)
  }
  return (
    <div className="ruler-wrap" data-testid="check-ruler">
      <svg viewBox="-2 -2 106 14" style={{ width: '106mm' }} xmlns="http://www.w3.org/2000/svg">
        <line x1={0} y1={0} x2={100} y2={0} className="ln-cut" />
        <line x1={0} y1={0} x2={0} y2={6} className="ln-cut" />
        <line x1={100} y1={0} x2={100} y2={6} className="ln-cut" />
        {ticks}
        <text x={0} y={11} className="mark-text">0</text>
        <text x={100} y={11} textAnchor="end" className="mark-text">100mm</text>
      </svg>
      <p className="note">打印校验尺：打印后用直尺量 0→100 应为 100mm（误差 ≤1mm）。若不符，打印时关闭「适应页面/缩放」，按 100% 打印。</p>
    </div>
  )
}
