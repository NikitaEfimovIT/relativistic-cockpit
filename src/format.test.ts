import { expect, test } from 'vitest'
import { auto, distanceText, durationText, earthDate, earthDateTime, sci, shipClock, speedPercent, timerText, warpText } from './format'

test('the ship’s clock reads in days of the flight and the time of day', () => {
  expect(shipClock(0)).toBe('0 сут 00:00')
  expect(shipClock(412 * 86_400 + 6 * 3600 + 15 * 60 + 59)).toBe('412 сут 06:15')
})

test('a delay reads in the unit that keeps it short', () => {
  expect(durationText(2.5e7 / 299_792_458)).toBe('0.08 с')
  expect(durationText(12.5 * 60)).toBe('12.5 мин')
  expect(durationText(4.37 * 31_557_600)).toBe('4.37 г')
  expect(durationText(26_000 * 31_557_600)).toBe('26000 г')
})

test('Earth dates count from the launch on 1 May 2027, and never before it', () => {
  expect(earthDate(0)).toBe('01.05.2027')
  expect(earthDate(10 * 86_400)).toBe('11.05.2027')
  expect(earthDate(-0.08)).toBe('01.05.2027')
})

test('a letter is stamped with the Earth\'s date and time, UTC', () => {
  expect(earthDateTime(3600 + 60)).toBe('01.05.2027 01:01')
  expect(earthDateTime(1e20)).toMatch(/год$/) // past the calendar, the year alone
})

test('distances read in km by a planet, AU in a planetary system and light years beyond', () => {
  expect(distanceText(2.5e7).replace(/\s/g, ' ')).toBe('25 000 км')
  expect(distanceText(1.495978707e11)).toBe('1.00 а. е.')
  expect(distanceText(4.37 * 9.4607e15)).toBe('4.37 св. г')
})

test('the clock rate reads in the largest unit that fits', () => {
  expect(warpText(60)).toBe('1 с = 1.0 мин')
  expect(warpText(86_400 * 3)).toBe('1 с = 3.0 сут')
  expect(warpText(31_557_600 / 2)).toBe('1 с = 6.0 мес.')
  expect(warpText(0.5)).toBe('1 с = 0.5 с')
})

test('scientific notation uses superscripts and handles negative exponents and zero', () => {
  expect(sci(2.34e15)).toBe('2.34·10¹⁵')
  expect(sci(1e-6)).toBe('1.00·10⁻⁶')
  expect(sci(0)).toBe('0')
})

test('auto switches notation only at the extremes', () => {
  expect(auto(707.1, 1)).toBe('707.1')
  expect(auto(0)).toBe('0.00')
  expect(auto(3e7)).toBe('3.00·10⁷')
  expect(auto(7e-4)).toBe('7.00·10⁻⁴')
})

test('speed reads 99.9999 at the cap and never rounds up to 100', () => {
  expect(speedPercent(1e-6)).toBe('99.9999')
  expect(speedPercent(4e-7)).toBe('99.9999')
  expect(speedPercent(1)).toBe('0.0000')
  expect(speedPercent(0.5)).toBe('50.0000')
})

test('the event timer reads hours, minutes and seconds, days in front past a day, and long spans in their units', () => {
  expect(timerText(0)).toBe('00:00:00')
  expect(timerText(3725.9)).toBe('01:02:05')
  expect(timerText(2 * 86_400 + 61)).toBe('2 сут 00:01:01')
  expect(timerText(3 * 31_557_600)).toBe('3.00 г')
})
