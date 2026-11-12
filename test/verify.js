// Logic check on the bench CSVs: node test/verify.js
import { readFileSync } from 'node:fs'
import { parseSamples, parseEvents, parseHeader, parseConfig } from '../src/lib/parse.js'
import { airCheck, findPowerDips, findSteps, stepKpi, runKpi, runStatus, findFaults, unexpectedGaps } from '../src/lib/kpi.js'
import { headerMeaning, runTimeLabel } from '../src/lib/labels.js'
import { textsFromZip } from '../src/lib/zipfiles.js'
import { FILES } from '../src/lib/abi.js'
import { replay, whatIf } from '../src/lib/faultModel.js'

const BASE = '/home/remenod/VisionMiner/troubleshooting/heater-faults-fleet/'
let failed = 0
function check(name, actual, expected, tolerance) {
    const ok = Math.abs(actual - expected) <= tolerance
    if (!ok) {
        failed++
    }
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${Number(actual).toFixed(3)} (expected ${expected} +- ${tolerance})`)
}
const load = (path) => parseSamples(readFileSync(BASE + path, 'latin1'))

// Values below come from analysis-2026-10-27-157.md and the 2.1 margin table in test-design-2026-10-30.md
const markiz = load('bench-2026-10-26-plate/samples.csv')
const m = runKpi(markiz)
check('Markiz bed rate 60', m.bedRates[1].rate, 0.196, 0.004)
check('Markiz bed rate 100', m.bedRates[2].rate, 0.143, 0.004)
check('Markiz bed rate 140', m.bedRates[3].rate, 0.099, 0.004)
check('Markiz bed rate 160', m.bedRates[4].rate, 0.080, 0.004)
check('Markiz air 60->95 min', m.air60To95, 25.2, 0.3)

const r157 = load('bench-2026-10-27-157-usb/samples.csv')
const p = runKpi(r157)
check('157 air 60->95 min', p.air60To95, 20.4, 0.3)
check('157 bed rate 60', p.bedRates[1].rate, 0.180, 0.004)

const r138 = load('bench-2026-10-30-138/samples.csv')
const a = runKpi(r138)
check('138 air 60->95 min', a.air60To95, 32.5, 0.3)
check('138 S4 max >= 169', a.s4Max, 169.5, 1)

// Replay: a healthy curve must not fault, and the V4 seed margin is in the band of the design's table
const seed = { name: 'V4', R: 0.125, K: 0.072, Kfan: 0, E: 1.4, D: 18.2 }
const sensitive = { name: 'S', P: 60, T: 50 }
const h = replay(markiz.time, markiz.cols.H2_cur, markiz.cols.H2_act, markiz.cols.H2_pwm, seed, sensitive)
check('Markiz bed healthy: no fault', h.fired ? 1 : 0, 0, 0)
console.log(`     min margin ${h.minMargin.toFixed(1)}x, checked ${(h.checkedSeconds / 60).toFixed(1)} min, blind ${(h.blindSeconds / 60).toFixed(1)} min`)

// A heater that never heats must fault: flat curve at 30 C, bed target 100, full PWM
const flatTime = new Float64Array(1200)
const flat = new Float64Array(1200).fill(30)
const goal = new Float64Array(1200).fill(100)
const full = new Float64Array(1200).fill(1)
for (let i = 0; i < 1200; i++) {
    flatTime[i] = i
}
const dead = replay(flatTime, flat, goal, full, seed, sensitive)
check('Dead bed faults', dead.fired && dead.fired.type === 'rise' ? 1 : 0, 1, 0)
if (dead.fired) {
    console.log(`     fired at ${dead.fired.time.toFixed(0)} s, expected ${dead.fired.expected.toFixed(3)} C/s`)
}

// Target 100 at the chamber: excursion needs air below 30 and above 45 together, so it can never fire
const chamber = { name: 'C', R: 0.1, K: 0.895, Kfan: 0, E: 1.35, D: 55 }
const held = new Float64Array(1200).fill(60)
const heldGoal = new Float64Array(1200).fill(100)
const heldPwm = new Float64Array(1200).fill(1)
const stuck = replay(flatTime, held, heldGoal, heldPwm, chamber, { name: 'D', P: 600, T: 70 })
check('Chamber at 60 C, target 100: blind', stuck.fired ? 1 : 0, 0, 0)

// Quick on Markiz 10-30: air never reached 95 while heating, the supply dipped at 54 min
const quick = load('bench-2026-10-30-quick-markiz/ht1793380329/samples.csv')
check('Quick: no 60-95 from the cooling log', Number.isNaN(runKpi(quick).air60To95) ? 1 : 0, 1, 0)
check('Quick: air 60 to 90, min', runKpi(quick).air60To90, 40, 0.5)
const dips = findPowerDips(quick)
check('Quick: one supply dip', dips.length, 1, 0)
check('Quick: dip time, min', dips.length ? dips[0].time / 60 : -1, 54, 0.2)
check('Quick: dip 24 V', dips.length ? dips[0].vin : -1, 5.1, 0.01)

// How a run ended
const eventsOf = (path) => parseEvents(readFileSync(BASE + path, 'latin1'))
const quickStatus = runStatus(eventsOf('bench-2026-10-30-quick-markiz/ht1793380329/events.csv'), dips)
check('Quick: finished', quickStatus.ended ? 1 : 0, 1, 0)
check('Quick: two reasons', quickStatus.reasons.length, 2, 0)
const stopped = runStatus(eventsOf('bench-2026-10-30-dry-markiz/ht1001676/events.csv'), [])
check('Emergency Stop run: not finished', stopped.ended ? 1 : 0, 0, 0)
check('Emergency Stop run: last step', stopped.lastStep, 1, 0)
check('Bench CSV without events: nothing to say', runStatus([], []).ended ? 1 : 0, 1, 0)

// 3162 (US, 850 W 110 V), Extended: steps that lower the bed, heated nozzles, expected gaps, the S3 check
const usDir = 'bench-2026-11-03-3162-us/ht1793697210/'
const us = load(usDir + 'samples.csv')
const usSteps = findSteps(us, eventsOf(usDir + 'events.csv'))
const usKpis = usSteps.map((step) => stepKpi(us, step))
const at = (n) => usKpis[usSteps.findIndex((step) => step.number === n)]
check('3162 step 4 (bed 200 to 160): reached, min', at(4).bedReached, 8.0, 0.3)
check('3162 step 4: no overshoot from above', Number.isNaN(at(4).bedOver) ? 1 : 0, 1, 0)
check('3162 step 2: overshoot when heating', at(2).bedOver, 1.3, 0.3)
check('3162 step 11 (nozzles at 200): no air minus heads', Number.isNaN(at(11).airMinusLeft) ? 1 : 0, 1, 0)
check('3162: homing and Z gaps are expected', unexpectedGaps(us, usSteps).length, 0, 0)
check('3162: S3 minus heads, half-HEPA hold (step 2)', airCheck(usSteps, usKpis).value, 3.0, 0.2)
const qSteps = findSteps(quick, eventsOf('bench-2026-10-30-quick-markiz/ht1793380329/events.csv'))
check('Markiz Quick: S3 minus heads, half-HEPA hold', airCheck(qSteps, qSteps.map((step) => stepKpi(quick, step))).value, -7.4, 0.2)
const usHeader = parseHeader(readFileSync(BASE + usDir + 'header.csv', 'latin1'))
check('Every header key has a meaning', Object.keys(usHeader).filter((key) => !headerMeaning(key)).length, 0, 0)
console.log(`     ht1793697210 = ${runTimeLabel('ht1793697210')}, ht1001676 = ${runTimeLabel('ht1001676')}`)
check('Run time from the folder name', runTimeLabel('ht1793697210') === '2026-11-03 09:13' ? 1 : 0, 1, 0)
const JSZip = (await import('/home/remenod/VisionMiner/duet/dwc-plugin-debug-tools/.dwc-build/node_modules/jszip/lib/index.js')).default
const zipTexts = await textsFromZip(JSZip, readFileSync('/home/remenod/Downloads/Telegram Desktop/heattest_murica_1/download.zip'), FILES)
check('ZIP import: all four files', Object.keys(zipTexts).length, 4, 0)
check('ZIP import: same samples', zipTexts.samples === readFileSync(BASE + usDir + 'samples.csv', 'latin1') ? 1 : 0, 1, 0)

// Short rows and carry-forward, per the contract
const text = 't,upTime,step,ph,status,H2_cur,H2_act,slow,H2_state\n100.5,10,1,1,idle,30,180,7,active\n101.5,11,1,1,idle,31,180\n102.5,12,2,1,idle,32,180,8,fault\n103.5,13,2'
const s = parseSamples(text)
check('Rows, partial last line dropped', s.n, 3, 0)
check('Slow value carried', s.cols.slow[1], 7, 0)
const f = findFaults(s)
check('Fault found from rows', f.length, 1, 0)
check('Step split', findSteps(s, null).length, 2, 0)
const events = parseEvents('t,upTime,step,code,detail\n1,2,1,FAULT,"Heater ""2"", fault"\n')
check('Quoted event', events[0].detail === 'Heater "2", fault' ? 1 : 0, 1, 0)
check('Config value', parseConfig('start=1 bed=130').bed, 130, 0)
check('Header value', parseFloat(parseHeader('key,value\nabi,1\n').abi), 1, 0)

const mins = (v) => (v === null ? '-' : v < 0 ? 'never' : v.toFixed(1))
// Whole what-if on a real run: it must complete and give a row per model and level
const started = Date.now()
const w = whatIf(markiz, null, 0.04, 0.035, 26)
console.log(`whatIf: ${w.bed.length} bed rows, ${w.chamber.length} chamber rows, ${Date.now() - started} ms`)
check('Bed rows', w.bed.length, 6, 0)
check('Chamber rows', w.chamber.length, 3, 0)
for (let i = 0; i < w.bed.length; i++) {
    const r = w.bed[i]
    console.log(`  ${r.model.padEnd(8)} ${r.level.padEnd(10)} margin ${r.minMargin.toFixed(1)} checked ${r.checkedMinutes.toFixed(1)} blind ${r.blindMinutes.toFixed(1)} dead heat-up ${mins(r.heatUpDead)} half ${mins(r.heatUpHalf)} dead hold ${mins(r.holdDead)} half ${mins(r.holdHalf)}`)
}
check('Moderate bed: dead heater in hold never seen', w.bed[1].holdDead, -1, 0)
check('Sensitive bed: dead heater in hold is seen', w.bed[0].holdDead > 0 ? 1 : 0, 1, 0)
check('Default chamber: dead heater in hold never seen', w.chamber[0].holdDead, -1, 0)
for (let i = 0; i < w.chamber.length; i++) {
    const r = w.chamber[i]
    console.log(`  chamber  ${r.level.padEnd(10)} margin ${r.minMargin.toFixed(1)} checked ${r.checkedMinutes.toFixed(1)} blind ${r.blindMinutes.toFixed(1)} dead heat-up ${mins(r.heatUpDead)} half ${mins(r.heatUpHalf)} dead hold ${mins(r.holdDead)} half ${mins(r.holdHalf)}`)
}
const steps = findSteps(markiz, null)
console.log('Markiz steps from setpoints:', steps.length)
if (steps.length) {
    const k = stepKpi(markiz, steps[0])
    console.log('  first step', JSON.stringify({ min: k.minutes, air95: k.air[95], max: k.airMax, s4: k.s4Max, duty: k.chamberDuty }))
}
// A real run of the macros, read back: the firmware keeps act after a heater is off, and rpm is above the sensor limit
const DRY = BASE + 'bench-2026-10-30-dry-markiz/ht1000109/'
const dry = parseSamples(readFileSync(DRY + 'samples.csv', 'utf8'))
const dryEvents = parseEvents(readFileSync(DRY + 'events.csv', 'utf8'))
const dryHeader = parseHeader(readFileSync(DRY + 'header.csv', 'utf8'))
check('Dry run rows', dry.n, 567, 0)
const drySteps = findSteps(dry, dryEvents)
check('Dry run steps', drySteps.length, 6, 0)
check('Dry run HEPA rpm is read', stepKpi(dry, drySteps[2]).hepaRpm > 1000 ? 1 : 0, 1, 0)
const dryCooling = runKpi(dry).cooling
check('Dry run cooling log found', dryCooling ? 1 : 0, 1, 0)
const dryWhat = whatIf(dry, dryHeader, NaN, NaN, NaN)
check('Dry run: cooling is not a fault', dryWhat.bed[0].fired ? 1 : 0, 0, 0)
check('Dry run: own model from the header', dryWhat.bed[0].model === 'this machine' ? 1 : 0, 1, 0)
console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
