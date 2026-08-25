import { describe, expect, it } from 'vitest'
import { parsePipewireDump } from './sources'

/** An excerpt of a real `pw-dump`, trimmed to the fields that matter. */
const DUMP = JSON.stringify([
  {
    id: 51,
    info: {
      props: {
        'media.class': 'Audio/Sink',
        'node.name': 'alsa_output.pci-0000_00_1f.3.analog-stereo',
        'node.description': 'Built-in Audio Analog Stereo',
      },
    },
  },
  {
    id: 55,
    info: {
      props: {
        'media.class': 'Audio/Source',
        'node.name': 'alsa_input.pci-0000_00_1f.3.analog-stereo',
        'node.description': 'Built-in Audio Analog Stereo',
      },
    },
  },
  {
    id: 82,
    info: {
      props: { 'media.class': 'Stream/Output/Audio', 'node.name': 'speech-dispatcher' },
    },
  },
  { id: 3, info: { props: { 'media.class': 'Midi/Bridge', 'node.name': 'Midi-Bridge' } } },
])

describe('parsePipewireDump', () => {
  it('keeps only the audio sinks', () => {
    const sources = parsePipewireDump(DUMP)

    expect(sources).toHaveLength(1)
    expect(sources[0]).toEqual({
      id: 51,
      name: 'alsa_output.pci-0000_00_1f.3.analog-stereo',
      description: 'Built-in Audio Analog Stereo',
    })
  })

  it('falls back to the node name when there is no description', () => {
    const dump = JSON.stringify([
      { id: 7, info: { props: { 'media.class': 'Audio/Sink', 'node.name': 'bare' } } },
    ])

    expect(parsePipewireDump(dump)[0]?.description).toBe('bare')
  })

  it('ignores a node with no name at all', () => {
    const dump = JSON.stringify([{ id: 7, info: { props: { 'media.class': 'Audio/Sink' } } }])

    expect(parsePipewireDump(dump)).toEqual([])
  })

  it('ignores a node with no numeric id', () => {
    const dump = JSON.stringify([
      { info: { props: { 'media.class': 'Audio/Sink', 'node.name': 'orphan' } } },
    ])

    expect(parsePipewireDump(dump)).toEqual([])
  })

  it('returns an empty list on unreadable JSON', () => {
    expect(parsePipewireDump('not json at all')).toEqual([])
  })

  it('returns an empty list when the dump is not an array', () => {
    expect(parsePipewireDump('{"nodes": []}')).toEqual([])
  })

  it('deduplicates repeated ids', () => {
    const dump = JSON.stringify([
      { id: 7, info: { props: { 'media.class': 'Audio/Sink', 'node.name': 'one' } } },
      { id: 7, info: { props: { 'media.class': 'Audio/Sink', 'node.name': 'one' } } },
    ])

    expect(parsePipewireDump(dump)).toHaveLength(1)
  })
})
