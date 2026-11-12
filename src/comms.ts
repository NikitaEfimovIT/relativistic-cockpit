import type { Vec3 } from './galaxy'
import { C, LY, YEAR, type Ship } from './physics'
import { DAY, LAUNCH_JD, earthPosition } from './solarSystem'
import { dopplerTowards, galacticToShip, shipPosition, type Course } from './voyage'

// The radio link with the Earth. Mission control stays at home, at rest in the galaxy frame, and keeps sending. The
// ship hears a transmission when its light catches up, so it always hears an Earth that is d/c old, and on its own
// clock that Earth plays out at the Doppler factor towards it: e^−φ straight astern, a 1414th at six nines.

/** How far a ship at rest can still hear the Earth. A choice for the ship's radio, not a link budget. */
export const LINK_RANGE_LY = 30

const EARTH = earthPosition(LAUNCH_JD)

export interface CommLink {
  readonly delay: number // s, one way: how old the Earth that is heard now is
  readonly earthNow: number // s since launch on the Earth's own clock, which is galaxy time
  readonly earthSeen: number // s since launch on the Earth clock whose light arrives now
  readonly rate: number // Earth seconds heard per ship second
  readonly margin: number // dB over the receiver's threshold
  readonly isUp: boolean
}

export function commLink(course: Course, ship: Ship): CommLink {
  const at = shipPosition(course, ship.x)
  const offset: Vec3 = [EARTH[0] - at[0], EARTH[1] - at[1], EARTH[2] - at[2]]
  const lightYears = Math.max(Math.hypot(...offset), 1e-12)
  const delay = (lightYears * LY) / C
  const rate = dopplerTowards(galacticToShip(course.attitude, [offset[0] / lightYears, offset[1] / lightYears, offset[2] / lightYears]), ship.phi)
  // The received power goes as D²/d²: a plane wave's intensity transforms as D², and the beam spreads as 1/d².
  const margin = 20 * Math.log10((rate * LINK_RANGE_LY) / lightYears)
  return { delay, earthNow: ship.t, earthSeen: ship.t - delay, rate, margin, isUp: margin >= 0 }
}

export interface Message {
  readonly sentAfter: number // s of the Earth's clock after launch
  readonly text: string
}

const MINUTE = 60
const HOUR = 3600

/** What the Earth sends, and when. Mission control repeats each one, so a ship out of touch gets it once back. */
export const MESSAGES: readonly Message[] = [
  { sentAfter: 0, text: 'ЦУП: отделение видим. Траектория расчётная. Хорошего пути.' },
  { sentAfter: MINUTE, text: 'ЦУП: телеметрия идёт ровно. Как самочувствие?' },
  { sentAfter: 5 * MINUTE, text: 'ЦУП: вы на круговой орбите, виток около 11 часов. Главный двигатель работает только в световом режиме: тумблер под крышкой, под экраном навигации справа. Рядом — химический двигатель для манёвров у планет: НАДДУВ, ПОДАЧА, ДОСВЕТ ПУСК и ручка на левой консоли.' },
  { sentAfter: HOUR, text: 'ЦУП: час полёта. Все системы в норме. Мы на связи круглые сутки.' },
  { sentAfter: 2 * HOUR, text: 'ЦУП: если решите подойти к Луне на химическом двигателе — импульс по ходу поднимает апоцентр, а строка СБЛИЖЕНИЕ на экране навигации покажет, насколько близко вы пройдёте. Чек-листы — в руководстве, раздел 10.' },
  { sentAfter: DAY, text: 'ЦУП: первые сутки позади. Здесь ясная ночь, вас ищут в телескопы.' },
  { sentAfter: 3 * DAY, text: 'ЦУП: напоминаем: пульт жизнеобеспечения — в инженерном отсеке, напротив стола. Что делать при отказе, написано в руководстве, раздел «Отказы».' },
  { sentAfter: 7 * DAY, text: 'ЦУП: неделя. Приходила ваша семья. Просили передать, что ждут.' },
  { sentAfter: 14 * DAY, text: 'ЦУП: если пойдёте к центру Галактики — там чёрная дыра Sgr A*. Подходите в два-три отрезка: призыв тормозить звучит за 7 секунд, а опоздание там не пролёт, а гибель. Руководство, раздел 11.' },
  { sentAfter: 30 * DAY, text: 'ЦУП: месяц. Дети нарисовали ваш корабль, рисунок висит в зале управления.' },
  { sentAfter: 90 * DAY, text: 'ЦУП: на стенде клапан сброса давления такой же серии заело открытым. Если заест у вас — ИЗОЛЯЦИЯ, потом НАДДУВ до 101 кПа.' },
  { sentAfter: 0.5 * YEAR, text: 'ЦУП: полгода. Каждый вечер держим для вас открытую частоту.' },
  { sentAfter: YEAR, text: 'ЦУП: год со старта. Здесь снова весна.' },
  { sentAfter: 1.5 * YEAR, text: 'ЦУП: полтора года. Инженеры просят после каждого отказа смотреть журнал: там видно, что случилось и когда.' },
  { sentAfter: 2 * YEAR, text: 'ЦУП: два года. Ответа нет, и быть его ещё не может: свет идёт долго. Ждём.' },
  { sentAfter: 5 * YEAR, text: 'ЦУП: пять лет. Дежурные сменились. Новые знают вас по записям.' },
  { sentAfter: 10 * YEAR, text: 'ЦУП: десять лет. Антенну перестроили. Продолжаем передавать.' },
  { sentAfter: 25 * YEAR, text: 'Земля: двадцать пять лет. О вашем старте рассказывают в школах.' },
  { sentAfter: 50 * YEAR, text: 'Земля: передача автоматическая. Пятьдесят лет. Мы помним.' },
  { sentAfter: 100 * YEAR, text: 'Маяк Земли: сто лет со старта. Передача повторяется.' },
  { sentAfter: 1000 * YEAR, text: 'Маяк Земли: тысяча лет. Кто-то всё ещё держит частоту.' },
]

/** How many messages the Earth had sent `earthSeconds` after launch. */
export const messagesDue = (earthSeconds: number): number => MESSAGES.filter((message) => message.sentAfter <= earthSeconds).length
