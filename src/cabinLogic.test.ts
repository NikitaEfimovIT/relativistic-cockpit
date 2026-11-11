import { describe, expect, test } from 'vitest'
import {
  SHIELD_REACHES_COURSE, courseOpenness, filterTransmission, geigerRate, handAngle, handBlur, nextStartStep, poissonCount, shieldHeight, statusLamps,
  throttleMarks, wakeLevel,
} from './cabinLogic'
import { CANOPY_CROWN, CANOPY_SILL_LOW } from './cockpitLayout'
import { doseRate, forwardIlluminance, PHI_MAX } from './physics'
import { NIGHT_EXPOSURE, adaptedExposure, meteredIlluminance } from './sky'
import {
  initialSim, readyForStart, setThrottle, stepSim, toggleArm, toggleBus, toggleCabinLights, toggleEngine, toggleLightMode, toggleShield, type SimState,
} from './sim'
import { mulberry32 } from './stars'

const FRAME = 1 / 60

describe('waking the instruments', () => {
  test('a surface stays dark until the power reaches its turn, and ends fully lit', () => {
    expect(wakeLevel(0, 0, 1)).toBe(0)
    expect(wakeLevel(0.2, 0.4, 1)).toBe(0)
    expect(wakeLevel(1, 0.4, 1)).toBe(1)
  })

  test('it flickers on the way up, like a tube that strikes unevenly', () => {
    const levels = Array.from({ length: 40 }, (_, i) => wakeLevel(0.42, 0.4, i * 0.05))
    expect(new Set(levels.map((level) => level.toFixed(2))).size).toBeGreaterThan(1)
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
    }
  })
})

describe('the two clocks', () => {
  test('the hand turns clockwise: a quarter of the dial in a quarter of its period', () => {
    expect(handAngle(0.25, 1)).toBeCloseTo(-Math.PI / 2, 10)
    expect(handAngle(3, 12)).toBeCloseTo(-Math.PI / 2, 10)
  })

  test('a very long flight does not lose precision in the angle', () => {
    expect(handAngle(1e9 + 0.25, 1)).toBeCloseTo(-Math.PI / 2, 4)
  })

  test('at the speed limit the galaxy clock blurs while the ship clock stays sharp', () => {
    // Arrange: one real second is one ship month, and the galaxy clock runs γ times faster
    const shipYearsPerFrame = FRAME / 12
    const galaxyYearsPerFrame = shipYearsPerFrame * 707

    // Assert
    expect(handBlur(shipYearsPerFrame)).toBe(0)
    expect(handBlur(galaxyYearsPerFrame)).toBe(1)
  })

  test('at 0.9 c both month hands can still be followed by eye', () => {
    expect(handBlur((FRAME / 12) * 2.29)).toBe(0)
  })
})

describe('the Geiger counter', () => {
  test('behind the hull or the shield it only ticks at background', () => {
    const background = geigerRate(0, false)
    expect(background).toBeGreaterThan(0)
    expect(background).toBeLessThan(2)
    expect(geigerRate(doseRate(Math.atanh(0.1)), false)).toBe(background)
    expect(geigerRate(doseRate(Math.atanh(0.9)), true)).toBe(background)
  })

  test('without a shield it speeds up with the dose rate, up to a roar with a limit', () => {
    const [half, nine, limit] = [0.5, 0.9, 0.999999].map((beta) => geigerRate(doseRate(Math.atanh(beta)), false))
    expect(half).toBeGreaterThan(geigerRate(0, false))
    expect(nine).toBeGreaterThan(half)
    expect(limit).toBeGreaterThan(nine)
    expect(limit).toBeLessThanOrEqual(400)
  })

  test('the clicks arrive with the requested mean rate', () => {
    // Arrange
    const random = mulberry32(3)
    const frames = 60_000
    const rate = 30

    // Act
    let clicks = 0
    for (let i = 0; i < frames; i++) clicks += poissonCount(rate * FRAME, random)

    // Assert: 30 000 expected, with a standard deviation of about 170
    expect(clicks).toBeGreaterThan(29_000)
    expect(clicks).toBeLessThan(31_000)
  })
})

describe('the status lamps', () => {
  const tones = (s: SimState): Record<string, string> =>
    Object.fromEntries(statusLamps(s).map(({ label, tone }) => [label, tone]))
  const run = (s: SimState, seconds: number): SimState => {
    let state = s
    for (let t = 0; t < seconds; t += FRAME) state = stepSim(state, FRAME)
    return state
  }

  test('everything is dark in a cold ship', () => {
    expect(new Set(Object.values(tones(initialSim())))).toEqual(new Set(['off']))
  })

  test('power and engine go amber while they spool, then green', () => {
    // Act
    const starting = tones(run(toggleEngine(readyForStart(initialSim())), 0.3))
    const running = tones(run(toggleEngine(readyForStart(initialSim())), 12))

    // Assert
    expect(starting['ПИТАНИЕ']).toBe('amber')
    expect(starting['ДВИГАТЕЛЬ']).toBe('amber')
    expect(running['ПИТАНИЕ']).toBe('green')
    expect(running['ДВИГАТЕЛЬ']).toBe('green')
  })

  test('the thrust lamp tells accelerating from braking', () => {
    const engine = run(toggleEngine(readyForStart(initialSim())), 8)
    expect(tones(engine)['ТЯГА']).toBe('off')
    expect(tones(setThrottle(engine, 0.5))['ТЯГА']).toBe('green')
    expect(tones(setThrottle(engine, -0.5))['ТЯГА']).toBe('amber')
  })

  test('arming, shield and cabin lights each have their lamp', () => {
    const powered = toggleBus(initialSim())
    expect(tones(toggleArm(powered))['ВЗВЕДЕНО']).toBe('amber')
    expect(tones(toggleShield(powered))['ЩИТ']).toBe('cyan')
    expect(tones(toggleCabinLights(powered))['СВЕТ']).toBe('amber')
  })

  test('the lamps themselves draw from the bus', () => {
    expect(new Set(Object.values(tones(toggleCabinLights(toggleShield(toggleArm(initialSim()))))))).toEqual(new Set(['off']))
  })
})

describe('the start-up checklist', () => {
  test('points at one switch at a time: bus, light mode, arming, start', () => {
    expect(nextStartStep(initialSim())).toBe('bus')
    expect(nextStartStep(toggleBus(initialSim()))).toBe('light')
    expect(nextStartStep(toggleLightMode(toggleBus(initialSim())))).toBe('arm')
    expect(nextStartStep(readyForStart(initialSim()))).toBe('engine')
    expect(nextStartStep(toggleEngine(readyForStart(initialSim())))).toBeNull()
  })

  test('a switch thrown out of turn does not skip the one before it', () => {
    expect(nextStartStep(toggleEngine(toggleArm(initialSim())))).toBe('bus')
  })
})

describe('the eye and the light of the CMB', () => {
  const HALF_FOV = 0.65
  const levelOnCabin = (phi: number, offCourse: number): number => {
    const illuminance = forwardIlluminance(phi)
    return adaptedExposure(meteredIlluminance(illuminance, 0, offCourse, HALF_FOV), 1) * illuminance
  }

  test('looking away from the disc does not flood the cabin with light', () => {
    for (let phi = 0; phi <= PHI_MAX; phi += 0.25) {
      expect(levelOnCabin(phi, 0), `ahead, φ = ${phi}`).toBeLessThan(2)
      expect(levelOnCabin(phi, 1.7), `astern, φ = ${phi}`).toBeLessThan(20)
    }
  })

  test('looking away from the disc lets the eye open, so the lit cabin can be seen', () => {
    const levelAhead = levelOnCabin(PHI_MAX, 0)
    const levelAstern = levelOnCabin(PHI_MAX, 1.7)
    expect(levelAstern).toBeGreaterThan(5 * levelAhead)
  })

  test('at rest the meter reads nothing, wherever the pilot looks', () => {
    for (const offCourse of [0, 0.5, 1, 2]) {
      expect(adaptedExposure(meteredIlluminance(0, 0, offCourse, HALF_FOV), 1)).toBe(NIGHT_EXPOSURE)
    }
  })

  test('the reading changes smoothly as the disc leaves the view', () => {
    const readings = [0.7, 0.8, 0.9, 1.0, 1.1].map((offCourse) => meteredIlluminance(100, 0, offCourse, HALF_FOV))
    for (let i = 1; i < readings.length; i++) expect(readings[i]).toBeLessThanOrEqual(readings[i - 1])
    expect(readings[0]).toBe(100)
    expect(readings[4]).toBeCloseTo(5, 10)
  })
})

describe('the shutters and the glass', () => {
  test('the blast shields rise from below the sills to over the crown, and reach the course at eye level', () => {
    expect(shieldHeight(0)).toBeLessThan(CANOPY_SILL_LOW)
    expect(shieldHeight(1)).toBeGreaterThan(CANOPY_CROWN)
    expect(shieldHeight(SHIELD_REACHES_COURSE)).toBeCloseTo(0, 10)
    expect(SHIELD_REACHES_COURSE).toBeGreaterThan(0.2)
    expect(SHIELD_REACHES_COURSE).toBeLessThan(0.8)
  })

  test('the course is clear until the shields reach it, then the light is cut', () => {
    expect(courseOpenness(0)).toBe(1)
    expect(courseOpenness(0.1)).toBe(1)
    expect(courseOpenness(1)).toBe(0)
    let previous = 1
    for (let c = 0; c <= 1; c += 0.02) {
      expect(courseOpenness(c)).toBeLessThanOrEqual(previous)
      previous = courseOpenness(c)
    }
  })

  test('the tinted glass lets a thousandth of the light through, and half tinted the square root of that', () => {
    expect(filterTransmission(0)).toBe(1)
    expect(filterTransmission(1)).toBeCloseTo(1e-3, 12)
    expect(filterTransmission(0.5)).toBeCloseTo(10 ** -1.5, 8)
  })
})
describe('the lamps along the thrust track', () => {
  const lit = (throttle: number): string => throttleMarks(throttle, 9).map((on) => (on ? '#' : '.')).join('')

  test('at the detent only the middle lamp is lit', () => {
    expect(lit(0)).toBe('....#....')
  })

  test('they light from the detent to the setting: ahead for thrust, behind for braking', () => {
    expect(lit(1)).toBe('....#####')
    expect(lit(0.5)).toBe('....###..')
    expect(lit(-0.5)).toBe('..###....')
    expect(lit(-1)).toBe('#####....')
  })

  test('a lamp lights only once the setting reaches it', () => {
    expect(lit(0.2)).toBe('....#....')
    expect(lit(-0.3)).toBe('...##....')
  })
})
