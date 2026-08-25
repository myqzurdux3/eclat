import { execFile } from 'node:child_process'

export interface AudioSource {
  /** PipeWire node id. It changes between sessions and must never be cached. */
  id: number
  name: string
  description: string
}

interface DumpNode {
  id?: unknown
  info?: { props?: Record<string, unknown> }
}

/**
 * Extracts the audio outputs from a `pw-dump` payload.
 *
 * Only `Audio/Sink` nodes are kept: what we want to hear is what leaves the
 * machine, and a sink's monitor carries exactly that. Sources are microphones
 * and streams are individual applications — neither is the mix.
 *
 * Pure, so the parsing is tested without PipeWire.
 */
export function parsePipewireDump(json: string): AudioSource[] {
  let nodes: unknown
  try {
    nodes = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(nodes)) return []

  const sources = new Map<number, AudioSource>()

  for (const node of nodes as DumpNode[]) {
    const props = node.info?.props
    if (props === undefined || props['media.class'] !== 'Audio/Sink') continue

    const id = node.id
    const name = props['node.name']
    if (typeof id !== 'number' || typeof name !== 'string') continue

    const description = props['node.description']
    sources.set(id, {
      id,
      name,
      description: typeof description === 'string' ? description : name,
    })
  }

  return [...sources.values()]
}

/** Lists the audio outputs PipeWire knows about. */
export async function listAudioSources(): Promise<AudioSource[]> {
  return new Promise((resolve) => {
    execFile('pw-dump', ['-N'], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      // PipeWire absent or unreachable: no sources, not a crash.
      resolve(error ? [] : parsePipewireDump(stdout))
    })
  })
}
