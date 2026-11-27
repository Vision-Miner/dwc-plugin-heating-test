import { EVENT } from './abi.js'

// Only the first line is the operator's: the test's instructions below it hold digits of their own
export function readingVolts(text) {
    const number = text.split('\n')[0].match(/\d+(?:[.,]\d+)?/)
    return number ? parseFloat(number[0].replace(',', '.')) : NaN
}

// Voltmeter files in the order they were taken, each timed by its VOLTMETER event, which carries the upTime of the take.
// A file with no event has no time and comes last.
export function voltmeterReadings(files, events, samples) {
    const readings = []
    const timed = {}
    const upTime = samples.cols.upTime
    const last = samples.n - 1
    for (let e = 0; e < events.length; e++) {
        const file = events[e].detail
        if (events[e].code !== EVENT.VOLTMETER || files[file] === undefined || timed[file]) {
            continue
        }
        timed[file] = true
        const reading = { file, text: files[file], volts: readingVolts(files[file]), step: events[e].step, time: NaN, index: -1 }
        if (upTime) {
            let i = 0
            while (i < samples.n && upTime[i] < events[e].upTime) {
                i++
            }
            // End.g takes the last reading after the last row
            reading.index = Math.min(i, last)
            reading.time = i <= last ? samples.time[i] : samples.time[last] + events[e].upTime - upTime[last]
        }
        readings.push(reading)
    }
    const names = Object.keys(files).sort()
    for (let i = 0; i < names.length; i++) {
        if (!timed[names[i]]) {
            readings.push({ file: names[i], text: files[names[i]], volts: readingVolts(files[names[i]]), step: NaN, time: NaN, index: -1 })
        }
    }
    return readings
}
