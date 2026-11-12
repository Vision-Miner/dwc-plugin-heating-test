import { STRING_COLUMNS } from './abi.js'

const GAP_SECONDS = 10

// Columnar form: a typed array per numeric column, so a 6-hour run stays cheap to chart.
// Missing values carry forward, which is also what fills the slow columns between their rows.
export function parseSamples(text) {
    const lines = text.split('\n')
    lines.pop()     // empty after the final newline, or a row still being written
    if (lines.length < 2) {
        throw new Error('samples.csv has no data rows')
    }

    const names = lines[0].trim().split(',')
    const tIndex = names.indexOf('t')
    if (tIndex < 0) {
        throw new Error('samples.csv has no t column')
    }

    const capacity = lines.length - 1
    const cols = {}
    for (let c = 0; c < names.length; c++) {
        cols[names[c]] = STRING_COLUMNS.has(names[c]) ? new Array(capacity) : new Float64Array(capacity)
    }

    const last = new Array(names.length).fill(NaN)
    const lastText = new Array(names.length).fill('')
    let n = 0
    for (let l = 1; l < lines.length; l++) {
        const cells = lines[l].replace(/\r$/, '').split(',')
        const t = parseFloat(cells[tIndex])
        if (!isFinite(t)) {
            continue
        }
        for (let c = 0; c < names.length; c++) {
            const cell = c < cells.length ? cells[c] : ''
            const column = cols[names[c]]
            if (STRING_COLUMNS.has(names[c])) {
                if (cell !== '') {
                    lastText[c] = cell
                }
                column[n] = lastText[c]
            } else {
                const value = cell === '' ? NaN : parseFloat(cell)
                if (isFinite(value)) {
                    last[c] = value
                }
                column[n] = last[c]
            }
        }
        n++
    }
    if (n === 0) {
        throw new Error('samples.csv has no valid rows')
    }

    // Seconds from the first row, never going backwards
    const time = new Float64Array(n)
    const t = cols.t
    const gaps = []
    const reboots = []
    const upTime = cols.upTime
    for (let i = 1; i < n; i++) {
        const dt = t[i] - t[i - 1]
        time[i] = time[i - 1] + (dt > 0 ? dt : 0)
        if (dt > GAP_SECONDS) {
            gaps.push({ time: time[i - 1], seconds: dt })
        }
        if (upTime && upTime[i] < upTime[i - 1]) {
            reboots.push(time[i])
        }
    }

    return { n, names, cols, time, gaps, reboots }
}

function splitQuoted(line) {
    const cells = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cell += '"'
                    i++
                } else {
                    quoted = false
                }
            } else {
                cell += ch
            }
        } else if (ch === '"') {
            quoted = true
        } else if (ch === ',') {
            cells.push(cell)
            cell = ''
        } else {
            cell += ch
        }
    }
    cells.push(cell)
    return cells
}

export function parseEvents(text) {
    const events = []
    const lines = text.split('\n')
    for (let l = 1; l < lines.length; l++) {
        const line = lines[l].replace(/\r$/, '')
        if (line === '') {
            continue
        }
        const cells = splitQuoted(line)
        if (cells.length >= 4) {
            events.push({
                t: parseFloat(cells[0]),
                upTime: parseFloat(cells[1]),
                step: parseInt(cells[2], 10),
                code: cells[3],
                detail: cells.length > 4 ? cells[4] : ''
            })
        }
    }
    return events
}

export function parseHeader(text) {
    const header = {}
    const lines = text.split('\n')
    for (let l = 1; l < lines.length; l++) {
        const line = lines[l].replace(/\r$/, '')
        if (line === '') {
            continue
        }
        const cells = splitQuoted(line)
        if (cells.length >= 2) {
            header[cells[0]] = cells[1]
        }
    }
    return header
}

// "start=1 bed=130 chamber=100" -> { start: 1, bed: 130, chamber: 100 }
export function parseConfig(detail) {
    const config = {}
    const pairs = detail.trim().split(/\s+/)
    for (let i = 0; i < pairs.length; i++) {
        const eq = pairs[i].indexOf('=')
        if (eq > 0) {
            config[pairs[i].substring(0, eq)] = parseFloat(pairs[i].substring(eq + 1))
        }
    }
    return config
}
