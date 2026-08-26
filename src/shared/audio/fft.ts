/** The smallest power of two greater than or equal to `value`, at least 1. */
export function nextPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1
  return 2 ** Math.ceil(Math.log2(value))
}

const windowCache = new Map<number, Float32Array>()

/**
 * A Hann window.
 *
 * Without one, a block cut in the middle of a period looks to the transform
 * like a discontinuity, which smears energy across bins that carry no signal.
 */
export function hannWindow(size: number): Float32Array {
  const cached = windowCache.get(size)
  if (cached !== undefined) return cached

  const window = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size))
  }
  windowCache.set(size, window)
  return window
}

/**
 * The magnitude spectrum of a real signal.
 *
 * An in-place radix-2 Cooley-Tukey transform over separate real and
 * imaginary arrays. Only the first half is returned: for a real input the
 * second half mirrors it and carries nothing new.
 */
/**
 * The transform's working arrays, kept between blocks.
 *
 * `magnitudeSpectrum` runs about forty-seven times a second and used to
 * allocate two arrays of the block size each time. They are entirely
 * internal — only the magnitudes are handed back, and those stay freshly
 * allocated so a caller can hold on to them.
 */
const buffers = new Map<number, { real: Float64Array; imaginary: Float64Array }>()

function scratch(size: number): { real: Float64Array; imaginary: Float64Array } {
  let held = buffers.get(size)
  if (held === undefined) {
    held = { real: new Float64Array(size), imaginary: new Float64Array(size) }
    buffers.set(size, held)
  }
  return held
}

export function magnitudeSpectrum(samples: Float32Array): Float32Array {
  const size = samples.length
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(`FFT size must be a power of two, got ${size}`)
  }

  const window = hannWindow(size)
  const { real, imaginary } = scratch(size)

  for (let i = 0; i < size; i += 1) {
    real[i] = samples[i]! * window[i]!
    imaginary[i] = 0
  }

  // Bit-reversal permutation, so the butterflies below can run in place.
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      // Swapped through a scalar. Destructuring allocates two arrays per
      // swap, and there are some five hundred swaps per block, forty-seven
      // blocks a second.
      const swapReal = real[i]!
      real[i] = real[j]!
      real[j] = swapReal
      const swapImaginary = imaginary[i]!
      imaginary[i] = imaginary[j]!
      imaginary[j] = swapImaginary
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const stepReal = Math.cos(angle)
    const stepImaginary = Math.sin(angle)

    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1
      let twiddleImaginary = 0

      for (let offset = 0; offset < length / 2; offset += 1) {
        const a = start + offset
        const b = a + length / 2

        const productReal = real[b]! * twiddleReal - imaginary[b]! * twiddleImaginary
        const productImaginary = real[b]! * twiddleImaginary + imaginary[b]! * twiddleReal

        real[b] = real[a]! - productReal
        imaginary[b] = imaginary[a]! - productImaginary
        real[a] = real[a]! + productReal
        imaginary[a] = imaginary[a]! + productImaginary

        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal
        twiddleReal = nextReal
      }
    }
  }

  const half = size / 2
  const magnitudes = new Float32Array(half)
  // Scaled so a full-amplitude sine reads back at its own amplitude: the
  // Hann window halves the coherent gain, hence the factor four.
  const scale = 4 / size
  for (let i = 0; i < half; i += 1) {
    magnitudes[i] = Math.hypot(real[i]!, imaginary[i]!) * scale
  }
  return magnitudes
}
