import { EVENT, PHASE, SENSOR_LOST } from './abi.js'
import { parseConfig } from './parse.js'

const MINUTE = 60
const BED_BINS = [[20, 40], [60, 80], [100, 120], [140, 160], [160, 175]]
const AIR_MARKS = [60, 90, 95, 99, 100]
const FULL_PWM = 0.97
const VIN_DIP = 20
const V12_DIP = 10.5
const SETTLED_PER_10_MIN = 0.5

function valid(value) {
    return isFinite(value) && value < SENSOR_LOST
}

// The firmware keeps the last target after a heater is switched off, so act alone does not say it is on
export function heaterOn(cols, heater, i) {
    const state = cols[`${heater}_state`]
    return cols[`${heater}_act`][i] > 0 && (!state || state[i] === 'active')
}

function meanOf(values, from, to) {
    let sum = 0
    let count = 0
    for (let i = from; i < to; i++) {
        if (isFinite(values[i])) {
            sum += values[i]
            count++
        }
    }
    return count > 0 ? sum / count : NaN
}

function mean(values, from, to) {
    let sum = 0
    let count = 0
    for (let i = from; i < to; i++) {
        if (valid(values[i])) {
            sum += values[i]
            count++
        }
    }
    return count > 0 ? sum / count : NaN
}

// First index in [from, to) whose time is at or after the given second
function indexAt(time, second, from, to) {
    let i = from
    while (i < to && time[i] < second) {
        i++
    }
    return i
}

function firstCrossing(time, values, from, to, level) {
    for (let i = from; i < to; i++) {
        if (valid(values[i]) && values[i] >= level) {
            if (i > from && valid(values[i - 1]) && values[i - 1] < level) {
                const share = (level - values[i - 1]) / (values[i] - values[i - 1])
                return time[i - 1] + share * (time[i] - time[i - 1])
            }
            return time[i]
        }
    }
    return NaN
}

// First time a falling curve comes down to a level
function firstFall(time, values, from, to, level) {
    for (let i = from; i < to; i++) {
        if (valid(values[i]) && values[i] <= level) {
            return time[i]
        }
    }
    return NaN
}

function slope(time, values, from, to) {
    let sumT = 0
    let sumV = 0
    let count = 0
    for (let i = from; i < to; i++) {
        sumT += time[i]
        sumV += values[i]
        count++
    }
    if (count < 2) {
        return NaN
    }
    const meanT = sumT / count
    const meanV = sumV / count
    let num = 0
    let den = 0
    for (let i = from; i < to; i++) {
        num += (time[i] - meanT) * (values[i] - meanV)
        den += (time[i] - meanT) * (time[i] - meanT)
    }
    return den > 0 ? num / den : NaN
}

// Same definition as the bench analysis: slope of the longest unbroken block at full PWM within the band
function bedRate(s, low, high, from, to) {
    const bed = s.cols.H2_cur
    const pwm = s.cols.H2_pwm
    let bestFrom = -1
    let bestLength = 0
    let start = -1
    for (let i = from; i <= to; i++) {
        const inside = i < to && pwm[i] >= FULL_PWM && bed[i] >= low && bed[i] < high
        if (inside && start < 0) {
            start = i
        } else if (!inside && start >= 0) {
            if (i - start > bestLength) {
                bestFrom = start
                bestLength = i - start
            }
            start = -1
        }
    }
    return bestLength > 5 ? slope(s.time, bed, bestFrom, bestFrom + bestLength) : NaN
}

// From the step column, or from setpoint changes for a bench CSV without one
export function findSteps(samples, events) {
    const steps = []
    const { n, cols, time } = samples
    const configs = {}
    if (events) {
        for (let e = 0; e < events.length; e++) {
            if (events[e].code === EVENT.STEP_START) {
                configs[events[e].step] = parseConfig(events[e].detail)
            }
        }
    }

    if (cols.step) {
        let from = -1
        for (let i = 0; i <= n; i++) {
            const same = i < n && from >= 0 && cols.step[i] === cols.step[from]
            if (from >= 0 && !same) {
                if (cols.step[from] > 0) {
                    const number = cols.step[from]
                    steps.push({ number, from, to: i, config: configs[number] || null })
                }
                from = -1
            }
            if (i < n && from < 0) {
                from = i
            }
        }
    } else {
        let from = 0
        for (let i = 1; i <= n; i++) {
            const changed = i === n || Math.abs(cols.H2_act[i] - cols.H2_act[from]) > 0.5 || Math.abs(cols.H3_act[i] - cols.H3_act[from]) > 0.5
            if (changed) {
                if (time[i - 1] - time[from] >= MINUTE && (cols.H2_act[from] > 0 || cols.H3_act[from] > 0)) {
                    steps.push({
                        number: steps.length + 1,
                        from,
                        to: i,
                        config: { bed: Math.max(cols.H2_act[from], 0), chamber: Math.max(cols.H3_act[from], 0) }
                    })
                }
                from = i
            }
        }
    }
    return steps
}

// S3 reads about 3 C lower at half HEPA than once the air is mixed, so air figures belong to their HEPA setting
const HEPA_LABELS = ['HEPA auto', 'HEPA off, then half', 'HEPA half']

export function stepLabel(step) {
    const c = step.config
    if (!c) {
        return `Step ${step.number}`
    }
    if (c.bed === 0 && c.chamber === 0) {
        return 'Cooling log'
    }
    let label = `Bed ${c.bed}, chamber ${c.chamber}`
    if (isFinite(c.z)) {
        label += `, Z${c.z}`
    }
    if (HEPA_LABELS[c.hepa]) {
        label += `, ${HEPA_LABELS[c.hepa]}`
    }
    return label
}

export function stepKpi(samples, step) {
    const { cols, time } = samples
    const { from, to } = step
    const end = time[to - 1]
    const after = (minutes) => indexAt(time, end - minutes * MINUTE, from, to)
    const last5 = after(5)
    const last10 = after(10)
    const start = time[from]
    const minutesFromStart = (second) => (second - start) / MINUTE

    // No crossings in a cooling log: the jump of S3 when HEPA changes is not a rise
    const heating = !step.config || step.config.chamber > 0
    const air = {}
    for (let m = 0; m < AIR_MARKS.length; m++) {
        air[AIR_MARKS[m]] = heating ? minutesFromStart(firstCrossing(time, cols.S3, from, to, AIR_MARKS[m])) : NaN
    }

    let airMax = -Infinity
    let bedMax = -Infinity
    let s4Max = -Infinity
    let s4Over165 = 0
    let s4Over170 = 0
    for (let i = from; i < to; i++) {
        if (valid(cols.S3[i]) && cols.S3[i] > airMax) {
            airMax = cols.S3[i]
        }
        if (valid(cols.S2[i]) && cols.S2[i] > bedMax) {
            bedMax = cols.S2[i]
        }
        if (valid(cols.S4[i])) {
            if (cols.S4[i] > s4Max) {
                s4Max = cols.S4[i]
            }
            if (i > from) {
                const dt = time[i] - time[i - 1]
                if (cols.S4[i] >= 165) {
                    s4Over165 += dt
                }
                if (cols.S4[i] >= 170) {
                    s4Over170 += dt
                }
            }
        }
    }

    const nozzleEnd = (name) => mean(cols[name], last5, to)
    const nozzleMove = (name) => {
        const rate = slope(time, cols[name], last10, to)
        return isFinite(rate) ? rate * 10 * MINUTE : NaN
    }
    const airEnd = mean(cols.S3, last5, to)
    const leftMove = nozzleMove('S0')
    const rightMove = nozzleMove('S1')
    const bedTarget = step.config ? step.config.bed : NaN

    // A step that lowers the bed reaches its target from above and has no overshoot
    const fromAbove = bedTarget > 0 && cols.S2[from] > bedTarget + (bedTarget >= 140 ? 2 : 10)
    const bedReachedAt = !(bedTarget > 0) ? NaN : fromAbove
        ? firstFall(time, cols.S2, from, to, bedTarget + (bedTarget >= 140 ? 2 : 10))
        : firstCrossing(time, cols.S2, from, to, bedTarget >= 140 ? bedTarget - 2 : bedTarget - 10)
    // Heated nozzles say nothing about the air
    const nozzlesHeated = (cols.H0_act && cols.H0_act[to - 1] > 0) || (cols.H1_act && cols.H1_act[to - 1] > 0)
    return {
        minutes: (end - start) / MINUTE,
        bedStart: cols.S2[from],
        airStart: cols.S3[from],
        bedReached: minutesFromStart(bedReachedAt),
        bedOver: bedTarget > 0 && !fromAbove ? bedMax - bedTarget : NaN,
        bedPwm: meanOf(cols.H2_pwm, last5, to),
        air,
        airMax,
        airEnd,
        airMove: (() => {
            const rate = slope(time, cols.S3, last10, to)
            return isFinite(rate) ? rate * 10 * MINUTE : NaN
        })(),
        chamberDuty: meanOf(cols.H3_pwm, last10, to),
        s4Max,
        s4Over165: s4Over165 / MINUTE,
        s4Over170: s4Over170 / MINUTE,
        airMinusLeft: nozzlesHeated ? NaN : airEnd - nozzleEnd('S0'),
        airMinusRight: nozzlesHeated ? NaN : airEnd - nozzleEnd('S1'),
        nozzlesSettled: Math.abs(leftMove) < SETTLED_PER_10_MIN && Math.abs(rightMove) < SETTLED_PER_10_MIN,
        hepaRpm: meanOf(cols.F7_rpm, last5, to),
        hepaAct: meanOf(cols.F7_act, last5, to)
    }
}

// Heaters off for the last stretch of the run: bed heat loss per minute, which separates a leak from weak heating
function coolingLoss(samples) {
    const { n, cols, time } = samples
    let from = n
    const off = (i) => !heaterOn(cols, 'H2', i) && !heaterOn(cols, 'H3', i)
    while (from > 0 && off(from - 1)) {
        from--
    }
    if (cols.ph) {
        for (let i = 0; i < n; i++) {
            if (cols.ph[i] === PHASE.END_LOG) {
                from = Math.max(from, i)
                break
            }
        }
    }
    if (from >= n || time[n - 1] - time[from] < MINUTE) {
        return null
    }
    const to = indexAt(time, time[from] + 20 * MINUTE, from, n)
    const bedRate_ = slope(time, cols.S2, from, to)
    const gap = mean(cols.S2, from, to) - mean(cols.S3, from, to)
    const airRate = slope(time, cols.S3, from, to)
    return {
        minutes: (time[to - 1] - time[from]) / MINUTE,
        bedPerMinute: gap > 0 ? -bedRate_ * MINUTE / gap : NaN,
        airRate: airRate * MINUTE
    }
}

export function runKpi(samples) {
    const { n, cols, time } = samples

    const bedRates = []
    for (let b = 0; b < BED_BINS.length; b++) {
        bedRates.push({ low: BED_BINS[b][0], high: BED_BINS[b][1], rate: bedRate(samples, BED_BINS[b][0], BED_BINS[b][1], 0, n) })
    }

    // Before anything heats, all sensors sit at one temperature
    let coldEnd = 0
    while (coldEnd < n && !heaterOn(cols, 'H2', coldEnd) && !heaterOn(cols, 'H3', coldEnd)) {
        coldEnd++
    }
    let cold = null
    if (coldEnd > 5 && cols.S2[coldEnd - 1] <= 45 && cols.S3[coldEnd - 1] <= 45) {
        const from = Math.max(indexAt(time, time[coldEnd - 1] - MINUTE, 0, coldEnd), 0)
        const left = mean(cols.S0, from, coldEnd)
        const right = mean(cols.S1, from, coldEnd)
        const bed = mean(cols.S2, from, coldEnd)
        const air = mean(cols.S3, from, coldEnd)
        const element = mean(cols.S4, from, coldEnd)
        cold = {
            spread: Math.max(left, right, bed, air, element) - Math.min(left, right, bed, air, element),
            airOffset: air - (left + right + bed) / 3,
            air
        }
    }

    // First rise of air from 60 C, chamber heater on: the jump of S3 when HEPA changes in a cooling log is not a rise
    const airRise = (top) => {
        let at60 = NaN
        for (let i = 0; i < n; i++) {
            if (valid(cols.S3[i]) && heaterOn(cols, 'H3', i)) {
                if (!isFinite(at60) && cols.S3[i] >= 60) {
                    at60 = time[i]
                } else if (isFinite(at60) && cols.S3[i] >= top) {
                    return (time[i] - at60) / MINUTE
                }
            }
        }
        return NaN
    }
    const air60To90 = airRise(90)
    const air60To95 = airRise(95)

    let s4Max = -Infinity
    const vinMin = { vin0: Infinity, v12: Infinity }
    for (let i = 0; i < n; i++) {
        if (valid(cols.S4[i]) && cols.S4[i] > s4Max) {
            s4Max = cols.S4[i]
        }
        if (cols.vin0_min && cols.vin0_min[i] < vinMin.vin0) {
            vinMin.vin0 = cols.vin0_min[i]
        }
        if (cols.v12_min && cols.v12_min[i] < vinMin.v12) {
            vinMin.v12 = cols.v12_min[i]
        }
    }

    return {
        hours: time[n - 1] / 3600,
        bedRates,
        cold,
        air60To90,
        air60To95,
        s4Max,
        vinMin,
        cooling: coolingLoss(samples),
        gaps: samples.gaps.length,
        reboots: samples.reboots.length
    }
}

// Any heater that went into fault, read from the rows, so it works without events.csv
// The firmware's latched minimums catch a dip shorter than a row. Row 0 can still hold the boot value.
export function findPowerDips(samples) {
    const { n, cols, time } = samples
    const dips = []
    if (!cols.vin0_min || !cols.v12_min) {
        return dips
    }
    const low = (i) => cols.vin0_min[i] < VIN_DIP || cols.v12_min[i] < V12_DIP
    for (let i = 1; i < n; i++) {
        if (low(i) && !low(i - 1)) {
            dips.push({ time: time[i], vin: cols.vin0_min[i], v12: cols.v12_min[i] })
        }
    }
    return dips
}

// What the verdict must say beyond faults. Bench CSVs have no events, so nothing can be said about how they ended.
export function runStatus(events, dips) {
    const reasons = []
    if (dips.length) {
        reasons.push('supply dip')
    }
    let ended = events.length === 0
    let lastStep = -1
    for (let i = 0; i < events.length; i++) {
        const event = events[i]
        if (event.code === EVENT.RUN_END) {
            ended = true
        } else if (event.code === EVENT.STEP_START) {
            lastStep = event.step
        } else if (event.code === EVENT.NOT_REACHED && reasons.indexOf('target not reached') < 0) {
            reasons.push('target not reached')
        } else if (event.code === EVENT.WARN && event.detail.indexOf('Cold wait skipped') === 0) {
            reasons.push('cold wait skipped')
        } else if (event.code === EVENT.WARN && event.detail.indexOf('Supply dip') !== 0 && reasons.indexOf('warning') < 0) {
            reasons.push('warning')
        }
    }
    return { ended, lastStep, reasons }
}

// Gaps the test makes itself: homing before step 1 and the Z move at a step start
export function unexpectedGaps(samples, steps) {
    const out = []
    const { gaps, time } = samples
    for (let g = 0; g < gaps.length; g++) {
        const gap = gaps[g]
        let expected = false
        for (let s = 0; s < steps.length && !expected; s++) {
            const start = time[steps[s].from]
            expected = Math.abs(start - gap.time) <= 5 || Math.abs(start - gap.time - gap.seconds) <= 5
        }
        if (!expected) {
            out.push(gap)
        }
    }
    return out
}

// S3 against the heads at the end of the first half-HEPA step at the bucket, step 2 in Quick, Standard and Extended
// alike: the same S3 reads very differently between machines
export function airCheck(steps, stepKpis) {
    for (let i = 0; i < steps.length; i++) {
        const c = steps[i].config
        const k = stepKpis[i]
        if (c && (c.hepa === 1 || c.hepa === 2) && c.bed >= 170 && k.minutes >= 20 && isFinite(k.airMinusLeft) && isFinite(k.airMinusRight)) {
            return { step: steps[i].number, value: (k.airMinusLeft + k.airMinusRight) / 2 }
        }
    }
    return null
}

export function findFaults(samples) {
    const { n, cols, time } = samples
    const faults = []
    for (let h = 0; h < 4; h++) {
        const state = cols[`H${h}_state`]
        if (!state) {
            continue
        }
        let inFault = false
        for (let i = 0; i < n; i++) {
            const now = state[i] === 'fault'
            if (now && !inFault) {
                faults.push({ heater: h, time: time[i], temperature: cols[`H${h}_cur`][i], target: cols[`H${h}_act`][i] })
            }
            inFault = now
        }
    }
    return faults
}
