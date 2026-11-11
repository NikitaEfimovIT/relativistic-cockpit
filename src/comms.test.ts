import { describe, expect, test } from 'vitest'
import { LINK_RANGE_LY, MESSAGES, commLink, messagesDue } from './comms'
import { C, LY, PHI_MAX, YEAR, advanceShip, rest } from './physics'
import { distanceToGo, indexOfTarget, launchCourse } from './voyage'

/** At rest where the pilot stops for `target`, `years` of galaxy time after launch. */
const stoppedAt = (name: string, years: number) => {
  const course = launchCourse(indexOfTarget(name))
  return { course, ship: { ...rest(), x: distanceToGo(course, 0), t: years * YEAR } }
}

describe('the link with the Earth', () => {
  test('at launch the Earth is heard live, a twelfth of a second late', () => {
    // Arrange
    const course = launchCourse()

    // Act
    const link = commLink(course, rest())

    // Assert
    expect(link.delay).toBeCloseTo(2.5e7 / C, 3)
    expect(link.earthSeen).toBeCloseTo(-link.delay, 9)
    expect(link.rate).toBeCloseTo(1, 6)
    expect(link.isUp).toBe(true)
  })

  test('flying away, the Earth\'s broadcasts play out at the Doppler factor, e^−φ straight astern', () => {
    // Arrange: coasting at φ = 3, a light year out
    const course = launchCourse()
    const phi = 3
    const ship = { ...rest(), phi, x: LY }
    const later = advanceShip(ship, 0, 1e5)

    // Act
    const [now, then] = [commLink(course, ship), commLink(course, later)]

    // Assert
    expect(now.rate).toBeCloseTo(Math.exp(-phi), 6)
    expect((then.earthSeen - now.earthSeen) / 1e5).toBeCloseTo(Math.exp(-phi), 6)
  })

  test('at cruise the signal sinks below the receiver, and comes back once stopped at α Cen', () => {
    // Arrange
    const course = launchCourse()
    const cruising = { ...rest(), phi: PHI_MAX, x: 2 * LY }
    const { ship: stopped } = stoppedAt('α Центавра A', 6)

    // Act
    const [lost, back] = [commLink(course, cruising), commLink(course, stopped)]

    // Assert: 20·lg(D·R/d), with D = e^−φ and R the range at rest
    expect(lost.margin).toBeCloseTo(20 * Math.log10((Math.exp(-PHI_MAX) * LINK_RANGE_LY) / 2), 2)
    expect(lost.isUp).toBe(false)
    expect(back.margin).toBeCloseTo(20 * Math.log10(LINK_RANGE_LY / 4.37), 0)
    expect(back.isUp).toBe(true)
  })

  test('Vega, 25 light years out, still hears the Earth at rest; Arcturus, 37 out, does not', () => {
    const vega = stoppedAt('Вега', 40)
    const arcturus = stoppedAt('Арктур', 50)
    expect(commLink(vega.course, vega.ship).isUp).toBe(true)
    expect(commLink(arcturus.course, arcturus.ship).isUp).toBe(false)
  })

  test('on arrival at α Cen six years after launch, only the first year and a half of the Earth has been heard', () => {
    const { course, ship } = stoppedAt('α Центавра A', 6.04)
    const link = commLink(course, ship)
    expect(link.earthNow / YEAR).toBeCloseTo(6.04, 6)
    expect(link.earthSeen / YEAR).toBeGreaterThan(1.6)
    expect(link.earthSeen / YEAR).toBeLessThan(1.75)
  })
})

describe('the messages from the Earth', () => {
  test('are sent in order, from the moment of launch', () => {
    expect(MESSAGES[0].sentAfter).toBe(0)
    MESSAGES.slice(1).forEach((message, i) => expect(message.sentAfter).toBeGreaterThan(MESSAGES[i].sentAfter))
  })

  test('are due once the light that carries them has arrived', () => {
    expect(messagesDue(-1)).toBe(0)
    expect(messagesDue(0)).toBe(1)
    expect(messagesDue(Infinity)).toBe(MESSAGES.length)
  })
})
