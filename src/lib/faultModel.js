import { heaterOn } from './kpi.js'

// Replay of the firmware's heater fault checks on a recorded curve, plus what-if levels, models and failures.
// Logic from RRF 3.5.4 LocalHeater.cpp:178-208, 285-352, 514-519 and FOPDT.cpp:328-340.
// The bed and chamber heaters run on the EXP3HC, whose source is not available: same logic is assumed.
const SAMPLE_SECONDS = 0.25                 // HeatSampleIntervalMillis
const CLOSE_ENOUGH = 1.5                    // TemperatureCloseEnough
const LOW_AMBIENT = 15                      // LowAmbientTemperature
const MAX_AMBIENT = 45                      // MaxAmbientTemperature
const BED_RISE_FACTOR = 0.3                 // MinBedTemperatureRiseFactor
const NEVER = -1
const FAILURE_HORIZON_SECONDS = 7200
const FAILURE_STEP_SECONDS = 2

export const LEVELS = {
    H2: [
        { name: 'Sensitive', P: 60, T: 50 },
        { name: 'Moderate', P: 600, T: 300 },
        { name: 'Off', P: 999999, T: 999999 }
    ],
    H3: [
        { name: 'Default', P: 600, T: 70 },
        { name: 'Moderate', P: 3600, T: 600 },
        { name: 'Off', P: 999999, T: 999999 }
    ]
}

const BED_SEEDS = [
    { name: 'V4 seed', R: 0.125, K: 0.072, Kfan: 0, E: 1.4, D: 18.2 },
    { name: 'V3 seed', R: 0.185, K: 0.054, Kfan: 0, E: 1.4, D: 41.1 }
]
const CHAMBER_SEED = { name: 'config.g', R: 0.1, K: 0.895, Kfan: 0, E: 1.35, D: 55 }

function modelFromHeader(header, heater, name) {
    if (!header || !isFinite(parseFloat(header[`${heater}_R`]))) {
        return null
    }
    return {
        name,
        R: parseFloat(header[`${heater}_R`]),
        K: parseFloat(header[`${heater}_K`]),
        Kfan: parseFloat(header[`${heater}_Kfan`]) || 0,
        E: parseFloat(header[`${heater}_Ex100`]) / 100,
        D: parseFloat(header[`${heater}_D`])
    }
}

function expectedRate(model, temperature, pwm) {
    const rise = Math.max(temperature - LOW_AMBIENT, 0) * 0.01
    return model.R * pwm - model.K * Math.pow(rise, model.E) - rise * model.Kfan
}

// Runs the checks at the firmware's own sample interval. time in seconds, target <= 0 means off.
export function replay(time, temperature, target, pwm, model, level) {
    const result = {
        fired: null,                        // { time, type, expected, measured }
        minMargin: Infinity,
        minMarginAt: NaN,
        checkedSeconds: 0,                  // rise check live, with a positive expected rate
        blindSeconds: 0                     // rising, but expected rate not positive
    }
    const n = time.length
    if (n < 2) {
        return result
    }

    let mode = 'off'
    let lastTarget = -1
    let count = 0
    let timeSetHeating = 0
    let lastValue = 0
    let lastTime = 0
    let index = 0

    for (let now = time[0]; now <= time[n - 1]; now += SAMPLE_SECONDS) {
        while (index + 1 < n - 1 && time[index + 1] <= now) {
            index++
        }
        const span = time[index + 1] - time[index]
        const share = span > 0 ? Math.min((now - time[index]) / span, 1) : 0
        const temp = temperature[index] + share * (temperature[index + 1] - temperature[index])
        const goal = target[index]
        const power = pwm[index]

        if (goal !== lastTarget) {
            if (goal <= 0) {
                mode = 'off'
                count = 0
            } else {
                const next = temp + CLOSE_ENOUGH < goal ? 'heating' : temp > goal + CLOSE_ENOUGH ? 'cooling' : 'stable'
                if (next !== mode) {
                    if (next === 'heating') {
                        lastValue = temp
                        lastTime = now
                        timeSetHeating = now
                    }
                    count = 0
                    mode = next
                }
            }
            lastTarget = goal
        }

        const error = goal - temp
        if (mode === 'heating') {
            if (error <= CLOSE_ENOUGH) {
                mode = 'stable'
                count = 0
            } else if (now - timeSetHeating < model.D * 2) {
                lastValue = temp
                lastTime = now
            } else {
                const expected = expectedRate(model, temp, power)
                if (expected > 0) {
                    result.checkedSeconds += SAMPLE_SECONDS
                } else {
                    result.blindSeconds += SAMPLE_SECONDS
                }
                const interval = now - lastTime
                if (interval >= 3 / expected) {
                    const allowed = expected * interval * BED_RISE_FACTOR
                    const actual = temp - lastValue
                    if (expected > 0 && interval > 0) {
                        const margin = actual / allowed
                        if (margin < result.minMargin) {
                            result.minMargin = margin
                            result.minMarginAt = now
                        }
                    }
                    if (actual < allowed) {
                        count++
                        if (count * SAMPLE_SECONDS > level.P) {
                            result.fired = { time: now, type: 'rise', expected, measured: actual / interval }
                            return result
                        }
                    } else {
                        lastValue = temp
                        lastTime = now
                        if (count !== 0) {
                            count--
                        }
                    }
                }
            }
        } else if (mode === 'stable') {
            if (Math.abs(error) > level.T && temp > MAX_AMBIENT) {
                count++
                if (count * SAMPLE_SECONDS > level.P) {
                    result.fired = { time: now, type: 'excursion', expected: goal, measured: temp }
                    return result
                }
            } else if (count !== 0) {
                count--
            }
        } else if (mode === 'cooling') {
            if (-error <= CLOSE_ENOUGH && goal > MAX_AMBIENT) {
                mode = 'stable'
                count = 0
            }
        }
    }
    return result
}

// The recorded curve up to sample `at`, then a heater delivering `power` of its full output, with the setpoint held.
// First-order losses k towards `ambient`. A later setpoint change in the recording would otherwise look like a new heat-up.
function failureCurve(time, temperature, target, pwm, at, full, ambient, k, power) {
    const steps = Math.ceil(FAILURE_HORIZON_SECONDS / FAILURE_STEP_SECONDS)
    const n = at + 1 + steps
    const curve = { time: new Float64Array(n), temperature: new Float64Array(n), target: new Float64Array(n), pwm: new Float64Array(n) }
    for (let i = 0; i <= at; i++) {
        curve.time[i] = time[i]
        curve.temperature[i] = temperature[i]
        curve.target[i] = target[i]
        curve.pwm[i] = pwm[i]
    }
    const goal = target[at]
    for (let i = at + 1; i < n; i++) {
        const previous = curve.temperature[i - 1]
        curve.time[i] = curve.time[i - 1] + FAILURE_STEP_SECONDS
        curve.temperature[i] = previous + FAILURE_STEP_SECONDS * (power * full - k * (previous - ambient))
        curve.target[i] = goal
        // Below its target the controller would hold full power
        curve.pwm[i] = previous < goal - 5 ? 1 : pwm[at]
    }
    return curve
}

function firstRowWith(n, test) {
    for (let i = 0; i < n; i++) {
        if (test(i)) {
            return i
        }
    }
    return NEVER
}

// Failure moments: 60 s after the heater starts, and 60 s after it first reaches its target
function failureMoments(time, temperature, target) {
    const n = time.length
    const started = firstRowWith(n, (i) => target[i] > 0)
    if (started === NEVER) {
        return null
    }
    let heatUp = started
    while (heatUp + 1 < n && time[heatUp] - time[started] < 60) {
        heatUp++
    }
    const reached = firstRowWith(n, (i) => target[i] > 0 && temperature[i] >= target[i] - 2)
    let hold = NEVER
    if (reached !== NEVER) {
        hold = reached
        while (hold + 1 < n && time[hold] - time[reached] < 60) {
            hold++
        }
    }
    return { heatUp, hold }
}

function detection(curve, model, level, at) {
    const result = replay(curve.time, curve.temperature, curve.target, curve.pwm, model, level)
    return result.fired ? (result.fired.time - curve.time[at]) / 60 : NEVER
}

// Heater output needed: during heat-up what it was delivering, during a hold what it takes to stay at the setpoint
function fullOutput(time, temperature, at, ambient, k, holding, goal) {
    if (holding) {
        return k * (goal - ambient)
    }
    let end = at
    while (end + 1 < time.length && time[end] - time[at] < 60) {
        end++
    }
    const rate = end > at ? (temperature[end] - temperature[at]) / (time[end] - time[at]) : 0
    return Math.max(rate, 0) + k * (temperature[at] - ambient)
}

function failureColumns(time, temperature, target, pwm, ambientAt, k, model, level) {
    const columns = { heatUpDead: null, heatUpHalf: null, holdDead: null, holdHalf: null }
    const moments = failureMoments(time, temperature, target)
    if (!moments) {
        return columns
    }
    const scenario = (at, holding, power) => {
        const ambient = ambientAt(at)
        const full = fullOutput(time, temperature, at, ambient, k, holding, target[at])
        return detection(failureCurve(time, temperature, target, pwm, at, full, ambient, k, power), model, level, at)
    }
    columns.heatUpDead = scenario(moments.heatUp, false, 0)
    columns.heatUpHalf = scenario(moments.heatUp, false, 0.5)
    if (moments.hold !== NEVER) {
        columns.holdDead = scenario(moments.hold, true, 0)
        columns.holdHalf = scenario(moments.hold, true, 0.5)
    }
    return columns
}

// Rows for one heater: every model at every level, healthy margin plus time to fault on simulated failures
function heaterRows(samples, name, models, levels, ambientAt, k) {
    const { cols, time } = samples
    const temperature = cols[`${name}_cur`]
    const pwm = cols[`${name}_pwm`]
    const target = new Float64Array(samples.n)
    for (let i = 0; i < samples.n; i++) {
        target[i] = heaterOn(cols, name, i) ? cols[`${name}_act`][i] : 0
    }
    const rows = []
    for (let m = 0; m < models.length; m++) {
        for (let l = 0; l < levels.length; l++) {
            const healthy = replay(time, temperature, target, pwm, models[m], levels[l])
            rows.push(Object.assign({
                heater: name,
                model: models[m].name,
                level: levels[l].name,
                P: levels[l].P,
                T: levels[l].T,
                fired: healthy.fired,
                minMargin: healthy.minMargin,
                checkedMinutes: healthy.checkedSeconds / 60,
                blindMinutes: healthy.blindSeconds / 60
            }, failureColumns(time, temperature, target, pwm, ambientAt, k, models[m], levels[l])))
        }
    }
    return rows
}

// bedLoss and airLoss are per minute. Air with the chamber heater dead still follows the bed, about 0.14 of the
// bed's rise above the room (Markiz 10-23, bed 180, chamber off, air near 49 C). Estimates, shown as such.
export function whatIf(samples, header, bedLoss, airLoss, room) {
    const { cols } = samples
    const roomAir = isFinite(room) ? room : 25
    const bedAmbient = (i) => cols.S3[i]
    const airAmbient = (i) => roomAir + 0.14 * Math.max(Math.max(cols.H2_act[i], cols.H2_cur[i]) - roomAir, 0)

    const own = modelFromHeader(header, 'H2', 'this machine')
    const bedModels = own ? [own].concat(BED_SEEDS) : BED_SEEDS
    const chamber = modelFromHeader(header, 'H3', 'this machine') || CHAMBER_SEED

    return {
        bed: heaterRows(samples, 'H2', bedModels, LEVELS.H2, bedAmbient, (bedLoss > 0 ? bedLoss : 0.04) / 60),
        chamber: heaterRows(samples, 'H3', [chamber], LEVELS.H3, airAmbient, (airLoss > 0 ? airLoss : 0.035) / 60)
    }
}
