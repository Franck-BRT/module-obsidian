import { describe, expect, it } from 'vitest'
import { unzip, ZipError } from './unzip'
import { utf8, zip } from './zip'

// Written by Python's zipfile with ZIP_DEFLATED, not by anything in this plugin: a reader
// tested only against its own writer agrees with itself whatever it does. Holds a
// directory entry, a 40-byte binary and a ReqIF-ish text that compresses well.
const PYTHON_DEFLATED =
  'UEsDBBQAAAAIAKVxOF0AAAAAAgAAAAAAAAAHAAAAaW1hZ2VzLwMAUEsDBBQAAAAIAKVxOF08LqYNKgAAACgAAAARAAAAaW1hZ2VzL3NjaGVtYS5wbmdjYGRiZmFlY+fg5OLm4eXjFxAUEhYRFROXkJSSlpGVk1dQVFJWUVVTBwBQSwMEFAAAAAgApXE4XdPMCm0oAAAAtQEAAAwAAABleHBvcnQucmVxaWazCXIN1PV0s3OtyExPzUtOVSg6vLLg8MqSwytT9RRGBQeVoI0+NLIAUEsBAhQDFAAAAAgApXE4XQAAAAACAAAAAAAAAAcAAAAAAAAAAAAQAP1BAAAAAGltYWdlcy9QSwECFAMUAAAACAClcThdPC6mDSoAAAAoAAAAEQAAAAAAAAAAAAAAgAEnAAAAaW1hZ2VzL3NjaGVtYS5wbmdQSwECFAMUAAAACAClcThd08wKbSgAAAC1AQAADAAAAAAAAAAAAAAAgAGAAAAAZXhwb3J0LnJlcWlmUEsFBgAAAAADAAMArgAAANIAAAAAAA=='

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

describe('unzip', () => {
  it('unpacks what another tool deflated', async () => {
    const entries = await unzip(bytesOf(PYTHON_DEFLATED))
    expect(entries.map((entry) => entry.name)).toEqual(['images/schema.png', 'export.reqif'])
    expect([...entries[0].data]).toEqual([...Array(40).keys()])
    expect(new TextDecoder().decode(entries[1].data)).toBe(`<REQ-IF>${'Exigence répétée. '.repeat(20)}</REQ-IF>`)
  })

  it('reads a stored archive, which is what this plugin writes', async () => {
    const entries = await unzip(zip([{ name: 'a.txt', data: utf8('un') }]))
    expect(new TextDecoder().decode(entries[0].data)).toBe('un')
  })

  // A hundred megabytes of attached images should not be unpacked to read one XML file.
  it('unpacks only the entries asked for', async () => {
    const entries = await unzip(bytesOf(PYTHON_DEFLATED), (name) => name.endsWith('.reqif'))
    expect(entries.map((entry) => entry.name)).toEqual(['export.reqif'])
  })

  // An import read from corrupt bytes is an import of requirements nobody wrote.
  it('refuses an entry whose bytes do not match their checksum', async () => {
    const archive = zip([{ name: 'a.txt', data: utf8('exigence') }])
    const at = archive.indexOf('e'.charCodeAt(0), 30)
    archive[at] = 'E'.charCodeAt(0)
    await expect(unzip(archive)).rejects.toThrow(/checksum/)
  })

  it('says a file is not an archive at all', async () => {
    await expect(unzip(utf8('<REQ-IF/>'))).rejects.toBeInstanceOf(ZipError)
  })
})
