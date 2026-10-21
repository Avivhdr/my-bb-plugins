import { describe, expect, it, vi } from 'vitest'
import { abortableSleep, runRescanLoop } from './rescanLoop'

function harness(minutesSequence: number[], scansBeforeAbort: number) {
  const controller = new AbortController()
  const waits: number[] = []
  let scans = 0
  const readMinutes = vi.fn(async () => minutesSequence[Math.min(waits.length, minutesSequence.length - 1)]!)
  const scan = vi.fn(async () => {
    scans += 1
    if (scans >= scansBeforeAbort) controller.abort()
  })
  const sleep = async (ms: number) => {
    waits.push(ms)
  }
  return { controller, waits, readMinutes, scan, sleep }
}

describe('runRescanLoop', () => {
  it('scans at start, then once per interval', async () => {
    const h = harness([5], 3)

    await runRescanLoop({ signal: h.controller.signal, readMinutes: h.readMinutes, scan: h.scan, sleep: h.sleep })

    expect(h.scan).toHaveBeenCalledTimes(3)
    expect(h.waits).toEqual([300_000, 300_000])
  })

  it('reads the interval before every wait, so a change applies after the current wait', async () => {
    const h = harness([5, 30], 3)

    await runRescanLoop({ signal: h.controller.signal, readMinutes: h.readMinutes, scan: h.scan, sleep: h.sleep })

    expect(h.waits).toEqual([300_000, 1_800_000])
  })

  it('keeps going after a failed scan and reports it', async () => {
    const controller = new AbortController()
    const onError = vi.fn()
    let calls = 0
    const scan = async () => {
      calls += 1
      if (calls === 1) throw new Error('disk gone')
      controller.abort()
    }

    await runRescanLoop({ signal: controller.signal, readMinutes: async () => 1, scan, sleep: async () => {}, onError })

    expect(calls).toBe(2)
    expect(onError).toHaveBeenCalledWith('transcript scan failed', expect.any(Error))
  })

  it('does not report the error an abort causes', async () => {
    const controller = new AbortController()
    const onError = vi.fn()
    const scan = async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    }

    await runRescanLoop({ signal: controller.signal, readMinutes: async () => 1, scan, sleep: async () => {}, onError })

    expect(onError).not.toHaveBeenCalled()
  })
})

describe('abortableSleep', () => {
  it('wakes as soon as the signal aborts', async () => {
    const controller = new AbortController()
    const sleeping = abortableSleep(60_000, controller.signal)

    controller.abort()

    await expect(sleeping).resolves.toBeUndefined()
  })
})
