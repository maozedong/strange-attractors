/**
 * The pictures the cat map scrambles: the bundled photo and a one-frame webcam snapshot.
 *
 * Both become N x N RGBA8 arrays in texture order (row 0 = bottom of the picture, so the
 * image is upright on a PlaneGeometry with no flipY), alpha forced to 255. They are cached
 * here at module level, so remounting the stage neither re-decodes the photo nor asks for
 * the camera again.
 */
import { useStore } from '../../store'
import { CAT_N } from './catMap'

/** Read by the UI (poll it, like swarmStatus). */
export const catStatus = {
  /** why the last camera request failed, in words for the visitor; null after a success */
  cameraError: null as string | null,
  /** a camera request is in flight (permission prompt open, or waiting for exposure) */
  capturing: false,
  /** the bundled photo could not be loaded (the stage stays empty) */
  loadError: null as string | null,
}

const CAT_URL = import.meta.env.BASE_URL + 'img/cat.jpg'
/**
 * Where the square crop sits vertically in the 960 x 1163 photo, 0 = top, 0.5 = centred.
 * A centred crop clips the tip of the left ear (it reaches y ~ 48); 0.12 keeps it with a
 * little headroom and trims plain chest fur at the bottom instead.
 */
const CAT_CROP_FOCUS = 0.12
/** Let auto-exposure and white balance settle before taking the frame. */
const CAMERA_SETTLE_MS = 500
/** Give up if the camera is granted but delivers no frame for this long. */
const CAMERA_FRAME_TIMEOUT_MS = 5000

let catPixels: Uint8Array | null = null
let catLoad: Promise<Uint8Array> | null = null
let cameraPixels: Uint8Array | null = null
let cameraSerial = 0
let cameraCapture: Promise<boolean> | null = null

/** The bundled photo, once loaded; null before. */
export function getCatPixels(): Uint8Array | null {
  return catPixels
}

/** The last camera snapshot; null until one succeeds. */
export function getCameraPixels(): Uint8Array | null {
  return cameraPixels
}

/** Bumped by every successful capture, so the stage knows to show the new picture. */
export function getCameraSerial(): number {
  return cameraSerial
}

/** Start decoding the bundled photo (idempotent). Failure is reported in catStatus.loadError. */
export function loadCatPixels(): Promise<Uint8Array> {
  if (catLoad) return catLoad
  catLoad = (async () => {
    const img = new Image()
    img.decoding = 'async'
    img.src = CAT_URL
    await img.decode()
    const pixels = squarePixels(img, img.naturalWidth, img.naturalHeight, CAT_CROP_FOCUS, false)
    catPixels = pixels
    catStatus.loadError = null
    return pixels
  })()
  catLoad.catch((e: unknown) => {
    catStatus.loadError = `The cat photo could not be loaded (${e instanceof Error ? e.message : String(e)}).`
    console.error('[ArnoldCat]', catStatus.loadError)
    catLoad = null // allow a retry on the next mount
  })
  return catLoad
}

/**
 * Take one webcam frame and make it the picture: asks for the front camera, waits ~0.5 s,
 * grabs a centred square (mirrored, so it reads like a mirror), stops the camera, and sets
 * `cat.source = 'camera'`, which restarts the stage at step 0 with the new picture.
 *
 * Call it from a click handler so the permission prompt belongs to a user gesture. Calling
 * it again retakes the photo; calls while one is in flight share it. On failure (denied,
 * no camera, insecure page) the stage keeps or returns to the cat (`source = 'cat'`),
 * `catStatus.cameraError` says why, and the promise resolves to false. After a failure,
 * setting `source = 'camera'` alone does not ask again (it falls back to the cat); only
 * another captureCamera() call, i.e. another click, retries.
 */
export function captureCamera(): Promise<boolean> {
  if (cameraCapture) return cameraCapture
  catStatus.capturing = true
  const run = grabCameraFrame().then(
    (pixels) => {
      cameraPixels = pixels
      cameraSerial++
      catStatus.cameraError = null
      useStore.getState().setCat({ source: 'camera' })
      return true
    },
    (e: unknown) => {
      catStatus.cameraError = describeCameraError(e)
      console.warn('[ArnoldCat] camera unavailable:', e)
      // always a store write, so a UI that reads catStatus while rendering shows the error
      useStore.getState().setCat({ source: 'cat' })
      return false
    },
  )
  cameraCapture = run.finally(() => {
    catStatus.capturing = false
    cameraCapture = null
  })
  return cameraCapture
}

async function grabCameraFrame(): Promise<Uint8Array> {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!media || typeof media.getUserMedia !== 'function') {
    throw new CameraUnavailable(
      typeof window !== 'undefined' && !window.isSecureContext
        ? 'The camera only works on a secure (https) page.'
        : 'This browser does not give pages access to a camera.',
    )
  }
  const stream = await media.getUserMedia({ video: { facingMode: 'user' }, audio: false })
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.srcObject = stream
    await video.play()
    const start = performance.now()
    while (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      if (performance.now() - start > CAMERA_FRAME_TIMEOUT_MS) {
        throw new CameraUnavailable('The camera started but sent no picture.')
      }
      await sleep(50)
    }
    await sleep(CAMERA_SETTLE_MS)
    return squarePixels(video, video.videoWidth, video.videoHeight, 0.5, true)
  } finally {
    for (const track of stream.getTracks()) track.stop()
    video.pause()
    video.srcObject = null
  }
}

class CameraUnavailable extends Error {
  override name = 'CameraUnavailable'
}

function describeCameraError(e: unknown): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : ''
  switch (name) {
    case 'CameraUnavailable':
      return (e as Error).message
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow it for this page to use your own picture.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera could not be started. Another app may be using it.'
    default:
      return 'The camera could not be used.'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Crop the largest square (centred horizontally, at `focusY` vertically), shrink it to
 * CAT_N x CAT_N and return texture-order RGBA8. Shrinking halves the image while it is at
 * least twice the target, so every bilinear draw is at most 2:1 and together they act as a
 * box filter; one big draw would alias fur and whiskers into sparkle.
 */
function squarePixels(
  source: CanvasImageSource,
  width: number,
  height: number,
  focusY: number,
  mirror: boolean,
): Uint8Array {
  const N = CAT_N
  if (!(width > 0 && height > 0)) throw new Error(`source has no size (${width} x ${height})`)
  const side = Math.min(width, height)
  let image: CanvasImageSource = source
  let sx = (width - side) / 2
  let sy = (height - side) * focusY
  let size = side

  while (size >= 2 * N) {
    const half = Math.ceil(size / 2)
    const canvas = makeCanvas(half)
    canvas.ctx.drawImage(image, sx, sy, size, size, 0, 0, half, half)
    image = canvas.el
    sx = 0
    sy = 0
    size = half
  }

  const out = makeCanvas(N)
  if (mirror) out.ctx.setTransform(-1, 0, 0, 1, N, 0)
  out.ctx.drawImage(image, sx, sy, size, size, 0, 0, N, N)
  const rgba = out.ctx.getImageData(0, 0, N, N).data

  // canvas rows run top-down; texture rows run bottom-up
  const pixels = new Uint8Array(N * N * 4)
  const row = N * 4
  for (let y = 0; y < N; y++) {
    pixels.set(rgba.subarray((N - 1 - y) * row, (N - y) * row), y * row)
  }
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
  return pixels
}

function makeCanvas(size: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas')
  el.width = size
  el.height = size
  const ctx = el.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { el, ctx }
}
