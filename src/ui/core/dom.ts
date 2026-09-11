/**
 * Tiny DOM helpers. The extension has no UI framework: these three functions
 * plus the store in `store.ts` are the whole rendering layer.
 */

type Attrs = Record<string, string | number | boolean | EventListener | undefined>

function applyAttrs(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else if (key === 'class') {
      node.setAttribute('class', String(value))
    } else if (key === 'text') {
      node.textContent = String(value)
    } else if (value === true) {
      node.setAttribute(key, '')
    } else {
      node.setAttribute(key, String(value))
    }
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  applyAttrs(node, attrs)
  for (const child of children) {
    if (child === null || child === undefined) continue
    node.append(child)
  }
  return node
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node> = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  applyAttrs(node, attrs)
  for (const child of children) node.append(child)
  return node
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/**
 * Pointer drag helper shared by knobs, faders and the resize grip.
 * Reports movement in pixels since the drag began; `onEnd` always runs, so
 * callers can rely on it to commit or clean up.
 */
export function onDrag(
  target: HTMLElement,
  handlers: {
    onStart?: (event: PointerEvent) => void
    onMove: (delta: { x: number; y: number }, event: PointerEvent) => void
    onEnd?: () => void
  },
): () => void {
  let origin: { x: number; y: number } | null = null

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return
    origin = { x: event.clientX, y: event.clientY }
    target.setPointerCapture(event.pointerId)
    handlers.onStart?.(event)
    event.preventDefault()
  }
  const move = (event: PointerEvent) => {
    if (!origin) return
    handlers.onMove({ x: event.clientX - origin.x, y: event.clientY - origin.y }, event)
  }
  const up = (event: PointerEvent) => {
    if (!origin) return
    origin = null
    try {
      target.releasePointerCapture(event.pointerId)
    } catch {
      // The pointer may already have been released by the browser.
    }
    handlers.onEnd?.()
  }

  target.addEventListener('pointerdown', down)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)

  return () => {
    target.removeEventListener('pointerdown', down)
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', up)
  }
}
