// The legends of the controls in three languages, as crews read them: Russian, English and Chinese. A legend is written
// in Russian where it is drawn and shown in the language chosen; the screens, the manual and the letters stay Russian.
// The English follows NASA and ISS usage where there is one; the Chinese is the author's, not a native speaker's.
import { useSyncExternalStore } from 'react'

export type Lang = 'ru' | 'en' | 'zh'
export const LANGS: readonly Lang[] = ['ru', 'en', 'zh']
export const LANG_NAMES: Readonly<Record<Lang, string>> = { ru: 'RU', en: 'EN', zh: '中文' }

const LEGENDS: Readonly<Record<string, readonly [en: string, zh: string]>> = {
  // the panel and the desks
  'ШИНА': ['MAIN BUS', '主母线'],
  'ВЗВЕДЕНИЕ': ['ARM', '预位'],
  'ВЗВЕДЕНО': ['ARMED', '已预位'],
  'ДВИГАТЕЛЬ': ['ENGINE', '发动机'],
  'ЩИТ': ['SHIELD', '护盾'],
  'ГЛ. АВАРИЯ': ['MASTER ALARM', '主告警'],
  'ВЫБРАТЬ': ['SELECT', '选择'],
  'ЧАСЫ': ['CLOCK', '时钟'],
  'СЧЁТЧИК': ['GEIGER', '计数器'],
  'ТЯГА': ['THRUST', '推力'],
  'АВТОТОРМОЖЕНИЕ': ['AUTO BRAKE', '自动制动'],
  'БОРТ, лет': ['SHIP, yr', '船时，年'],
  'ГАЛАКТИКА, лет': ['GALAXY, yr', '银河时，年'],
  'СВЕТ. РЕЖИМ': ['LIGHT MODE', '光速模式'],
  'ДОСВЕТ ПУСК': ['SUBLIGHT START', '亚光速启动'],
  'ДОСВЕТ': ['SUBLIGHT', '亚光速'],
  'НАДДУВ': ['PRESSURIZE', '增压'],
  'ПОДАЧА': ['FEED', '供给'],
  'ПЕРЕКР.': ['X-FEED', '交叉供给'],
  'РУЧН. УПР.': ['MAN ATT', '手动姿态'],
  'ОРИЕНТАЦИЯ': ['ATTITUDE', '姿态'],
  'ОТСЕЧКА': ['CUTOFF', '切断'],
  // the walls of the cockpit
  'СВЕТ': ['LIGHTS', '照明'],
  'ВЕНТИЛЯЦИЯ': ['FANS', '通风'],
  'ПОГЛОТИТЕЛЬ': ['CO₂ SCRUB', 'CO₂吸收'],
  'ЖИЗНЕОБЕСПЕЧЕНИЕ': ['LIFE SUPPORT', '生命保障'],
  'АВТОМАТЫ ЗАЩИТЫ': ['CIRCUIT BREAKERS', '断路器'],
  'ФОНАРЬ И ИНДИКАЦИЯ': ['CANOPY & DISPLAYS', '舱盖与显示'],
  'НАВИГАЦИЯ': ['NAV', '导航'],
  'СВЯЗЬ': ['COMM', '通信'],
  'ДОЗИМЕТР': ['DOSIMETER', '剂量计'],
  'КАМЕРА': ['CAMERA', '摄像机'],
  'ИНДИКАТОРЫ': ['HUD', '平显'],
  'ШТОРКИ': ['SHUTTERS', '遮光板'],
  'ТОНИРОВКА': ['TINT', '滤光'],
  'ЯРКОСТЬ': ['DIMMER', '亮度'],
  // the annunciator and the status lamps
  'ПИТАНИЕ': ['POWER', '电源'],
  'РАДИАЦИЯ': ['RADIATION', '辐射'],
  'ДОЗА': ['DOSE', '剂量'],
  'ТОРМОЗИ': ['BRAKE', '制动'],
  'НЕТ СВЯЗИ': ['NO LINK', '无通信'],
  'НЕ ВЗВЕДЁН': ['NOT ARMED', '未预位'],
  'ЖИЗНЕОБЕСП.': ['LIFE SUPP.', '生保'],
  'ТОПЛИВО': ['FUEL', '燃料'],
  // the life-support console and the room panel
  'РЕАКТОР': ['REACTOR', '反应堆'],
  'ВЕНТИЛЯТОРЫ': ['FANS', '风扇'],
  'КИСЛОРОД': ['O₂ GEN', '制氧'],
  'ОБОГРЕВ 1': ['HEATER 1', '加热器1'],
  'ОБОГРЕВ 2': ['HEATER 2', '加热器2'],
  'УСТАВКА': ['SETPOINT', '设定'],
  'УСТАВКА −': ['SETPOINT −', '设定 −'],
  'УСТАВКА +': ['SETPOINT +', '设定 +'],
  'СБРОС ДАВЛ.': ['VENT', '泄压'],
  'ИЗОЛЯЦИЯ': ['ISOLATE', '隔离'],
  'ВОЗДУХ И СВЕТ': ['AIR & LIGHTS', '空气与照明'],
  'ТЕПЛО': ['HEAT', '热控'],
  'ДАВЛЕНИЕ': ['PRESSURE', '压力'],
  'ТЕМПЕРАТУРА': ['TEMPERATURE', '温度'],
  'кПа': ['kPa', 'kPa'],
  // what E does to what is in the sight, on foot
  'E — сесть': ['E — sit down', 'E — 坐下'],
  'E — выдвинуть': ['E — pull out', 'E — 拉出'],
  'E — задвинуть': ['E — push in', 'E — 推回'],
  'E — нажать': ['E — press', 'E — 按下'],
  'E — включить': ['E — switch on', 'E — 打开'],
  'E — выключить': ['E — switch off', 'E — 关闭'],
}

/** A legend in `lang`; one with no translation, a number or an arrow, stays as it is written. */
export function legendIn(text: string, lang: Lang): string {
  if (lang === 'ru') return text
  const found = LEGENDS[text]
  return found ? found[lang === 'en' ? 0 : 1] : text
}

const readLang = (): Lang => {
  const asked = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('lang')
  return LANGS.find((lang) => lang === asked) ?? 'ru'
}

let current: Lang = readLang()
const listeners = new Set<() => void>()

export const currentLang = (): Lang => current

/** The language of the legends, chosen by ?lang= or by the switch in the corner; kept in the address for a reload. */
export function setLang(lang: Lang): void {
  current = lang
  const url = new URL(window.location.href)
  url.searchParams.set('lang', lang)
  window.history.replaceState(null, '', url)
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The language now; a component that shows a legend draws again when it changes. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, currentLang)
