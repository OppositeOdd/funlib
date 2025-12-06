import type { Funscript } from '..'
import type { ms } from '../types'
import { FunAction } from '..'
import { channelNameToAxis, speedToHexCached } from '../utils/converter'
import { actionsToLines, actionsToZigzag, mergeLinesSpeed, toStats } from '../utils/manipulations'
import { lerp } from '../utils/misc'

export interface SvgOptions {
  // rendering
  /** width of graph lines */
  lineWidth?: number
  /** text to display in the header */
  title?: ((script: Funscript, suggested: string) => string) | string | null
  /** text to display in the left square */
  icon?: ((script: Funscript, suggested: string) => string) | string | null
  /** font to use for text */
  font?: string
  /** font to use for axis text */
  iconFont?: string
  /** halo around text */
  halo?: boolean
  /** replace title heatmap with solid color */
  solidTitleBackground?: boolean
  /** opacity of the graph background (heatmap) */
  graphOpacity?: number
  /** opacity of the title background (heatmap) */
  titleOpacity?: number
  /** heatmap precition */
  mergeLimit?: number
  /** normalize actions before rendering */
  normalize?: boolean
  /** truncate title with ellipsis if too long */
  titleEllipsis?: boolean
  /** move title to separate line, doubling header height */
  titleSeparateLine?: boolean | 'auto'

  // sizing
  /** width of funscript axis */
  width?: number
  /** height of funscript axis */
  height?: number
  /** height of header */
  titleHeight?: number
  /** spacing between header and graph */
  titleSpacing?: number
  /** width of funscript axis */
  iconWidth?: number
  /** margin between funscript axis and graph */
  iconSpacing?: number
  /** duration in milliseconds. Set to 0 to use script.actualDuration */
  durationMs?: ms | 0
  /** display chapter bar at the top of the heatmap */
  showChapters?: boolean
  /** height of chapter bar in pixels */
  chapterHeight?: number
}
/** y between one axis G and the next */
const SPACING_BETWEEN_AXES = 0
/** y between one funscript and the next */
const SPACING_BETWEEN_FUNSCRIPTS = 4
/** padding around the svg, reduces width and adds to y */
const SVG_PADDING = 0

const HANDY_ICON = '☞'

export const svgDefaultOptions: Required<SvgOptions> = {
  title: null,
  icon: null,
  lineWidth: 0.5,
  font: 'Arial, sans-serif',
  iconFont: 'Consolas, monospace',
  halo: true,
  solidTitleBackground: false,
  graphOpacity: 0.2,
  titleOpacity: 0.7,
  mergeLimit: 500,
  normalize: true,
  titleEllipsis: true,
  titleSeparateLine: 'auto',
  width: 690,
  height: 52,
  titleHeight: 20,
  titleSpacing: 0,
  iconWidth: 46,
  iconSpacing: 0,
  durationMs: 0,
  showChapters: false,
  chapterHeight: 10,
}

export type SvgSubOptions<K extends keyof SvgOptions> = {
  [P in K]-?: Required<SvgOptions & { durationMs?: ms }>[P]
}

const isBrowser = typeof document !== 'undefined'

export function textToSvgLength(text: string, font: string) {
  if (!isBrowser) return 0

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  context.font = font
  const width = context.measureText(text).width
  return width
}

/**
 * Escapes text for safe usage in SVG by converting special characters to HTML entities.
 * Works in both browser and non-browser environments without DOM manipulation.
 */
export function textToSvgText(text: string): string {
  if (!text) return text

  // Define HTML entity mappings for characters that need escaping in SVG
  const entityMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
    '/': '&#x2F;',
  }

  return text.replace(/[&<>"'/]/g, char => entityMap[char] || char)
}

/**
 * Truncates text with ellipsis to fit within the specified width.
 * Uses a simple while loop to iteratively remove characters until the text fits.
 */
export function truncateTextWithEllipsis(text: string, maxWidth: number, font: string): string {
  if (!text) return text
  if (textToSvgLength(text, font) <= maxWidth) return text

  while (text && textToSvgLength(text + '…', font) > maxWidth) {
    text = text.slice(0, -1)
  }
  return text + '…'
}

/**
 * Converts a Funscript to SVG path elements representing the motion lines.
 * Each line is colored based on speed and positioned within the specified dimensions.
 */
export function toSvgLines(
  script: Funscript,
  ops: SvgSubOptions<'durationMs' | 'mergeLimit' | 'lineWidth'>,
  ctx: { width: number, height: number },
) {
  const { lineWidth, mergeLimit, durationMs } = ops
  const { width, height } = ctx
  const round = (x: number) => +x.toFixed(2)

  function lineToStroke(a: FunAction, b: FunAction) {
    const at = (a: FunAction) => round((a.at / durationMs * (width - 2 * lineWidth)) + lineWidth)
    const pos = (a: FunAction) => round((100 - a.pos) * (height - 2 * lineWidth) / 100 + lineWidth)
    return `M ${at(a)} ${pos(a)} L ${at(b)} ${pos(b)}`
  }
  const lines = actionsToLines(script.actions)
  mergeLinesSpeed(lines, mergeLimit)

  lines.sort((a, b) => a[2] - b[2])
  // global styles: stroke-width="${w}" fill="none" stroke-linecap="round"
  return lines.map(([a, b, speed]) => `<path d="${lineToStroke(a, b)}" stroke="${speedToHexCached(speed)}"></path>`)
}

/**
 * Creates an SVG linear gradient definition based on a Funscript's speed variations over time.
 * The gradient represents speed changes throughout the script duration with color transitions.
 */
export function toSvgBackgroundGradient(
  script: Funscript,
  { durationMs }: SvgSubOptions<'durationMs'>,
  linearGradientId: string,
) {
  const round = (x: number) => +x.toFixed(2)

  const lines = actionsToLines(actionsToZigzag(script.actions))
    .flatMap((e) => {
      const [a, b, s] = e
      const len = b.at - a.at
      if (len <= 0) return []
      if (len < 2000) return [e]
      // split into len/1000-1 periods
      const N = ~~((len - 500) / 1000)
      const ra = Array.from({ length: N }, (_, i) => {
        return [
          new FunAction({ at: lerp(a.at, b.at, i / N), pos: lerp(a.pos, b.pos, i / N) }),
          new FunAction({ at: lerp(a.at, b.at, (i + 1) / N), pos: lerp(a.pos, b.pos, (i + 1) / N) }),
          s,
        ] as const
      })
      return ra
    })
  // merge lines so they are at least 500 long
  for (let i = 0; i < lines.length - 1; i++) {
    const [a, b, ab] = lines[i], [c, d, cd] = lines[i + 1]
    if (d.at - a.at < 1000) {
      const speed = (ab * (b.at - a.at) + cd * (d.at - c.at)) / ((b.at - a.at) + (d.at - c.at))
      lines.splice(i, 2, [a, d, speed])
      i--
    }
  }
  let stops = lines
    .filter((e, i, a) => {
      const p = a[i - 1], n = a[i + 1]
      if (!p || !n) return true
      if (p[2] === e[2] && e[2] === n[2]) return false
      return true
    })
    .map(([a, b, speed]) => {
      const at = (a.at + b.at) / 2
      return { at, speed }
    })
  // add start, first, last, end stops
  if (lines.length) {
    const first = lines[0], last = lines.at(-1)!
    stops.unshift({ at: first[0].at, speed: first[2] })
    if (first[0].at > 100) {
      stops.unshift({ at: first[0].at - 100, speed: 0 })
    }
    stops.push({ at: last[1].at, speed: last[2] })
    if (last[1].at < durationMs - 100) {
      stops.push({ at: last[1].at + 100, speed: 0 })
    }
  }
  // remove duplicates
  stops = stops.filter((e, i, a) => {
    const p = a[i - 1], n = a[i + 1]
    if (!p || !n) return true
    if (p.speed === e.speed && e.speed === n.speed) return false
    return true
  })

  return `
      <linearGradient id="${linearGradientId}">
        ${stops.map(s => `<stop offset="${round(Math.max(0, Math.min(1, s.at / durationMs)))}" stop-color="${speedToHexCached(s.speed)}"${(
            s.speed >= 100 ? '' : ` stop-opacity="${round(s.speed / 100)}"`
          )}></stop>`).join('\n          ')
        }
      </linearGradient>`
}

/**
 * Creates a complete SVG background with gradient fill based on a Funscript's speed patterns.
 * Includes both the gradient definition and the rectangle that uses it.
 */
export function toSvgBackground(
  script: Funscript,
  ops: SvgSubOptions<'width' | 'height' | 'durationMs'>,
  ctx?: { bgOpacity?: number, rectId?: string },
) {
  const { width, height, durationMs } = ops
  const { bgOpacity, rectId } = ctx ?? {}
  const id = `grad_${Math.random().toString(26).slice(2)}`

  return `
    <defs>${toSvgBackgroundGradient(script, { durationMs }, id)}</defs>
    <rect${rectId ? ` id="${rectId}"` : ''} width="${width}" height="${height}" fill="url(#${id})" opacity="${bgOpacity ?? svgDefaultOptions.graphOpacity}"></rect>`
}

/**
 * Creates a complete SVG document containing multiple Funscripts arranged vertically.
 * Each script and its axes are rendered as separate visual blocks with proper spacing.
 */
export function toSvgElement(scripts: Funscript | Funscript[], ops: SvgOptions): string {
  scripts = Array.isArray(scripts) ? scripts : [scripts]
  const fullOps = { ...svgDefaultOptions, ...ops }
  fullOps.width -= SVG_PADDING * 2
  const round = (x: number) => +x.toFixed(2)

  // Check if any script has chapters and showChapters is enabled
  const firstScript = scripts[0]
  const hasChapters = fullOps.showChapters &&
    firstScript?.metadata?.chapters &&
    firstScript.metadata.chapters.length > 0
  const chapterOffset = hasChapters ? fullOps.chapterHeight : 0

  const pieces: string[] = []
  let y = SVG_PADDING + chapterOffset
  for (let s of scripts) {
    if (fullOps.normalize) s = s.clone().normalize()
    const durationMs = fullOps.durationMs || s.actualDuration * 1000
    // Only show title for the first script
    pieces.push(toSvgG(s, { ...fullOps, durationMs, title: fullOps.title }, {
      transform: `translate(${SVG_PADDING}, ${y})`,
      onDoubleTitle: () => y += fullOps.titleHeight,
    }))
    y += fullOps.height + SPACING_BETWEEN_AXES
    for (const a of s.listChannels) {
      // Axes never show title
      pieces.push(toSvgG(a, { ...fullOps, durationMs, title: fullOps.title ?? '' }, {
        transform: `translate(${SVG_PADDING}, ${y})`,
        isSecondaryAxis: true,
        onDoubleTitle: () => y += fullOps.titleHeight,
      }))
      y += fullOps.height + SPACING_BETWEEN_AXES
    }
    y += SPACING_BETWEEN_FUNSCRIPTS - SPACING_BETWEEN_AXES
  }
  y -= SPACING_BETWEEN_FUNSCRIPTS
  y += SVG_PADDING

  // Generate chapter bar if enabled, unsure where to put this but feel free to move to better location
  let chapterSvg = ''
  if (hasChapters) {
  // Randomly chosen colors, could probably be changed to reflect average speeds or something similar
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2']
    const durationMs = fullOps.durationMs || firstScript.actualDuration * 1000
    const chapterY = SVG_PADDING
    const graphWidth = fullOps.width - fullOps.iconWidth - (fullOps.iconWidth > 0 ? fullOps.iconSpacing : 0)
    const xOffset = SVG_PADDING + fullOps.iconWidth + (fullOps.iconWidth > 0 ? fullOps.iconSpacing : 0)

    const chapterRects: string[] = []
    const textHalos: string[] = []
    const textElements: string[] = []

    // Helper function to convert time string to milliseconds, not sure if this code is doubled up already
    const timeToMs = (timeStr: string): number => {
      const parts = timeStr.split(':')
      const hours = parseInt(parts[0], 10)
      const minutes = parseInt(parts[1], 10)
      const seconds = parseFloat(parts[2])
      return (hours * 3600 + minutes * 60 + seconds) * 1000
    }
    // Build chapter elements
    firstScript.metadata.chapters.forEach((chapter, idx) => {
      const startMs = (chapter as any).startAt ?? timeToMs((chapter as any).startTime)
      const endMs = (chapter as any).endAt ?? timeToMs((chapter as any).endTime)

      const startX = (startMs / durationMs) * graphWidth + xOffset
      const endX = (endMs / durationMs) * graphWidth + xOffset
      const chapterWidth = endX - startX
      const color = colors[idx % colors.length]

      chapterRects.push(
        `    <rect x="${round(startX)}" y="${chapterY}" width="${round(chapterWidth)}" height="${fullOps.chapterHeight}" fill="${color}" opacity="0.5" rx="2" ry="2"/>`
      )

      // Only render chapter name text if the chapter is wide enough
      if (chapterWidth > 30) {
        const textX = round(startX + chapterWidth / 2)
        const textY = round(chapterY + fullOps.chapterHeight / 2 + 3)
        const fontSize = round(fullOps.chapterHeight * 0.7)

        // Copy font styling from main SVG
        textHalos.push(
          `      <text x="${textX}" y="${textY}" font-size="${fontSize}px" font-family="${fullOps.font}" text-anchor="middle" font-weight="bold">${textToSvgText(chapter.name)}</text>`
        )
        textElements.push(
          `    <text x="${textX}" y="${textY}" font-size="${fontSize}px" font-family="${fullOps.font}" text-anchor="middle" font-weight="bold">${textToSvgText(chapter.name)}</text>`
        )
      }
    })

    chapterSvg = `  <g id="chapters">
${chapterRects.join('\n')}
${textHalos.length > 0 ? `    <g stroke="white" opacity="0.5" paint-order="stroke fill markers" stroke-width="3" stroke-dasharray="none" stroke-linejoin="round" fill="transparent">\n${textHalos.join('\n')}\n    </g>\n` : ''}${textElements.join('\n')}
  </g>
`
  }

  return `<svg class="funsvg" width="${round(fullOps.width)}" height="${round(y)}" xmlns="http://www.w3.org/2000/svg"
    font-size="${round(fullOps.titleHeight * 0.8)}px" font-family="${fullOps.font}"
>
${chapterSvg}${pieces.join('\n')}
</svg>`
}

/**
 * Creates an SVG group (g) element for a single Funscript with complete visualization.
 * Includes background, graph lines, titles, statistics, axis labels, and borders.
 * This is the core rendering function for individual script visualization.
 */
export function toSvgG(
  script: Funscript,
  ops: SvgSubOptions<keyof SvgOptions>,
  ctx: {
    transform: string
    onDoubleTitle: () => void
    isSecondaryAxis?: boolean
    isForHandy?: boolean
  },
): string {
  const {
    title,
    icon,
    lineWidth: w,
    graphOpacity,
    titleOpacity,
    titleHeight,
    titleSpacing,
    height,
    iconFont,
    width,
    solidTitleBackground,
    titleEllipsis,
    titleSeparateLine,
    font,
    durationMs,
    iconWidth,
  } = ops
  const { isSecondaryAxis, isForHandy } = ctx
  const iconSpacing = iconWidth === 0 ? 0 : ops.iconSpacing

  let titleText: string = ''
  if (script.file?.filePath) {
    titleText = script.file.filePath
  } else if (script.parent?.file) {
    // title = '<' + axisToName(script.id) + '>'
    titleText = ''
  }
  if (typeof title === 'function') {
    titleText = title(script, titleText)
  } else if (typeof title === 'string') {
    titleText = title
  }

  let iconText: string = isForHandy && !isSecondaryAxis
    ? HANDY_ICON
    : script.channel ? channelNameToAxis(script.channel, script.channel) : 'L0'
  if (typeof icon === 'function') {
    iconText = icon(script, iconText)
  } else if (typeof icon === 'string') {
    iconText = icon
  }

  const stats = toStats(script.actions, { durationSeconds: durationMs / 1000 })
  if (isSecondaryAxis) delete (stats as Partial<typeof stats>).Duration

  const statCount = Object.keys(stats).length

  const round = (x: number) => +x.toFixed(2)

  const proportionalFontSize = round(titleHeight * 0.8)
  const statLabelFontSize = round(titleHeight * 0.4)
  const statValueFontSize = round(titleHeight * 0.72)

  let useSeparateLine = false

  // Define x positions for key SVG elements
  const xx = {
    iconStart: 0, // Start of axis area
    iconEnd: iconWidth, // End of axis area
    titleStart: iconWidth + iconSpacing, // Start of title/graph area (after axis + spacing)
    svgEnd: width, // End of SVG (full width)
    graphWidth: width - iconWidth - iconSpacing, // Width of the graph area
    statText: (i: number) => round(width - (7 + i * 46) * (titleHeight / 20)), // X position for stat labels/values
    get iconText() { return round(this.iconEnd / 2) }, // X position for axis text (centered)
    get titleText() { return round(this.titleStart + titleHeight * 0.2) }, // X position for title text (proportional to title height)
    get textWidth() { return this.statText(useSeparateLine ? 0 : statCount) - this.titleText },
  }

  if (titleText && titleSeparateLine !== false
    && textToSvgLength(titleText, `${proportionalFontSize}px ${font}`) > xx.textWidth) {
    useSeparateLine = true
  }
  if (titleText && titleEllipsis
    && textToSvgLength(titleText, `${proportionalFontSize}px ${font}`) > xx.textWidth) {
    titleText = truncateTextWithEllipsis(titleText, xx.textWidth, `${proportionalFontSize}px ${font}`)
  }
  if (useSeparateLine) {
    ctx.onDoubleTitle()
  }

  // Calculate the actual graph height from total height
  const graphHeight = height - titleHeight - titleSpacing

  // Warn if encountered NaN actions
  const badActions = script.actions.filter(e => !Number.isFinite(e.pos))
  if (badActions.length) {
    console.log('badActions', badActions)
    badActions.map(e => e.pos = 120)
    titleText += '::bad'
    iconText = '!!!'
  }

  // Define y positions for key SVG elements
  const yy = {
    top: 0, // Top of SVG
    get titleExtra() { return useSeparateLine ? titleHeight : 0 },
    get titleBottom() { return round(titleHeight + this.titleExtra) }, // Bottom of title area
    get graphTop() { return round(this.titleBottom + titleSpacing) }, // Top of graph area
    get svgBottom() { return round(height + this.titleExtra) }, // Bottom of SVG (total block height)
    get iconText() { return round((this.top + this.svgBottom) / 2 + 4 + this.titleExtra / 2) }, // Y position for axis text (centered)
    titleText: round(titleHeight * 0.75), // Y position for title text (proportional to titleHeight)
    get statLabelText() { return round(titleHeight * 0.35 + this.titleExtra) }, // Y position for stat labels (proportional)
    get statValueText() { return round(titleHeight * 0.92 + this.titleExtra) }, // Y position for stat values (proportional)
  }
  const bgGradientId = `funsvg-grad-${script.channel ?? ''}-${script.actions.length}-${script.actions[0]?.at || 0}`

  const iconColor = speedToHexCached(stats.AvgSpeed)
  const iconOpacity = round(titleOpacity * Math.max(0.5, Math.min(1, stats.AvgSpeed / 100)))

  return [
    `<g transform="${ctx.transform}">`,
    '  <g class="funsvg-bgs">',
    `    <defs>${toSvgBackgroundGradient(script, { durationMs }, bgGradientId)}</defs>`,
    iconWidth > 0 && `    <rect class="funsvg-bg-axis-drop" x="0" y="${yy.top}" width="${xx.iconEnd}" height="${yy.svgBottom - yy.top}" fill="#ccc" opacity="${round(graphOpacity * 1.5)}"></rect>`,
    `    <rect class="funsvg-bg-title-drop" x="${xx.titleStart}" width="${xx.graphWidth}" height="${yy.titleBottom}" fill="#ccc" opacity="${round(graphOpacity * 1.5)}"></rect>`,
    iconWidth > 0 && `    <rect class="funsvg-bg-axis" x="0" y="${yy.top}" width="${xx.iconEnd}" height="${yy.svgBottom - yy.top}" fill="${iconColor}" opacity="${iconOpacity}"></rect>`,
    `    <rect class="funsvg-bg-title" x="${xx.titleStart}" width="${xx.graphWidth}" height="${yy.titleBottom}" fill="${solidTitleBackground ? iconColor : `url(#${bgGradientId})`}" opacity="${round(solidTitleBackground ? iconOpacity : titleOpacity)}"></rect>`,
    `    <rect class="funsvg-bg-graph" x="${xx.titleStart}" width="${xx.graphWidth}" y="${yy.graphTop}" height="${graphHeight}" fill="url(#${bgGradientId})" opacity="${round(graphOpacity)}"></rect>`,
    '  </g>',

    `  <g class="funsvg-lines" transform="translate(${xx.titleStart}, ${yy.graphTop})" stroke-width="${w}" fill="none" stroke-linecap="round">`,
    toSvgLines(script, ops, { width: xx.graphWidth, height: graphHeight }).map(line => `    ${line}`),
    '  </g>',

    '  <g class="funsvg-titles">',
    ops.halo && [
      `    <g class="funsvg-titles-halo" stroke="white" opacity="0.5" paint-order="stroke fill markers" stroke-width="3" stroke-dasharray="none" stroke-linejoin="round" fill="transparent">`,
      `      <text class="funsvg-title-halo" x="${xx.titleText}" y="${yy.titleText}"> ${textToSvgText(titleText)} </text>`,
      Object.entries(stats).reverse().map(([k, v], i) => [
        `      <text class="funsvg-stat-label-halo" x="${xx.statText(i)}" y="${yy.statLabelText}" font-weight="bold" font-size="${statLabelFontSize}px" text-anchor="end"> ${k} </text>`,
        `      <text class="funsvg-stat-value-halo" x="${xx.statText(i)}" y="${yy.statValueText}" font-weight="bold" font-size="${statValueFontSize}px" text-anchor="end"> ${v} </text>`,
      ]),
      '    </g>',
    ],
    iconWidth > 0 && `    <text class="funsvg-axis" x="${xx.iconText}" y="${yy.iconText}" font-size="${round(Math.max(12, iconWidth * 0.75))}px" font-family="${iconFont}" text-anchor="middle" dominant-baseline="middle"> ${textToSvgText(iconText)} </text>`,
    `    <text class="funsvg-title" x="${xx.titleText}" y="${yy.titleText}"> ${textToSvgText(titleText)} </text>`,
    Object.entries(stats).reverse().map(([k, v], i) => [
      `    <text class="funsvg-stat-label" x="${xx.statText(i)}" y="${yy.statLabelText}" font-weight="bold" font-size="${statLabelFontSize}px" text-anchor="end"> ${k} </text>`,
      `    <text class="funsvg-stat-value" x="${xx.statText(i)}" y="${yy.statValueText}" font-weight="bold" font-size="${statValueFontSize}px" text-anchor="end"> ${v} </text>`,
    ]),
    '  </g>',
    '</g>',
  ]
    .flat(4)
    .filter((e): e is string => !!e)
    .join('\n')
}

/**
 * Creates a blob URL for downloading or displaying Funscript(s) as an SVG file.
 * Useful for generating downloadable SVG files or creating object URLs for display.
 */
export function toSvgBlobUrl(script: Funscript | Funscript[], ops: SvgOptions) {
  const svg = toSvgElement(script, ops)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  return URL.createObjectURL(blob)
}
