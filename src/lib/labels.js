// Names as the machine and DWC use them (config.g, M563); the data column follows in brackets
export const SENSOR_NAMES = {
    S0: 'Left Head (S0)',
    S1: 'Right Head (S1)',
    S2: 'Bed (S2)',
    S3: 'Chamber air (S3)',
    S4: 'Chamber heater element (S4)'
}

export const HEATER_NAMES = {
    H0: 'Left Head heater',
    H1: 'Right Head heater',
    H2: 'Bed heater',
    H3: 'Chamber heater'
}

export const FAN_NAMES = {
    F0: 'Right Head hotend fan (F0)',
    F1: 'Right Head part cooling fan (F1)',
    F2: 'Left Head hotend fan (F2)',
    F3: 'Left Head part cooling fan (F3)',
    F4: 'Chamber heater fan (F4)',
    F6: 'White LEDs (F6)',
    F7: 'HEPA fan (F7)'
}

const MODEL_FIELDS = {
    R: 'model: heating rate at full power, C/s',
    K: 'model: cooling rate',
    Kfan: 'model: cooling rate with the fan on',
    Ex100: 'model: cooling exponent x 100',
    D: 'model: dead time, s',
    maxPwm: 'model: maximum PWM',
    V: 'model: voltage it was tuned at, 0 = no compensation',
    P: 'fault: time the rise may lag before a fault, s (M570 P)',
    T: 'fault: allowed excursion from the target, C (M570 T)',
    bad: 'fault: bad readings before a fault (M570 R)',
    max: 'over-temperature limit, C (M143)',
    P_before: 'fault time before the test set the default, s',
    T_before: 'allowed excursion before the test set the default, C'
}

const KEYS = {
    abi: 'Data format version',
    test_version: 'Test version',
    plan: 'Mode',
    serial: 'Serial number entered by the operator',
    rtc: '1 = times are real clock times',
    board0_id: 'Main board ID',
    board1_id: 'Expansion board ID',
    fw0: 'Main board firmware',
    fw1: 'Expansion board firmware',
    fwdate0: 'Main board firmware date',
    fwdate1: 'Expansion board firmware date',
    release: 'Firmware package version',
    hepaFan: 'HEPA speed set by the user, 0-255',
    heaterFaultTimer: 'Action after heater fault: -1 warn only, 0 power off at once, N power off after N s',
    chamberWait: 'Print start waits for the chamber',
    brushY: 'Nozzle brush Y position, null = default',
    vin0_min_boot: 'Lowest 24 V since the board started, V',
    v12_min_boot: 'Lowest 12 V since the board started, V',
    mcu0_min_boot: 'Lowest main board MCU temperature since start, C',
    pid_bed_log: '1 = a bed PID tuning log exists',
    sensor_chamber_log: '1 = a chamber sensor tuning log exists'
}

export function headerMeaning(key) {
    if (KEYS[key]) {
        return KEYS[key]
    }
    let m = key.match(/^(H\d)_(.+)$/)
    if (m && HEATER_NAMES[m[1]] && MODEL_FIELDS[m[2]]) {
        return `${HEATER_NAMES[m[1]]}, ${MODEL_FIELDS[m[2]]}`
    }
    m = key.match(/^S(\d)_(offset|slope)$/)
    if (m && SENSOR_NAMES[`S${m[1]}`]) {
        return `${SENSOR_NAMES[`S${m[1]}`]} calibration ${m[2]} (M308 ${m[2] === 'offset' ? 'U' : 'V'})`
    }
    return ''
}

// ht<epoch> holds the printer's local time written as UTC; ht<1000000 + upTime> means the clock was not set
export function runTimeLabel(folder) {
    const id = parseInt(folder.substring(2), 10)
    if (!(id >= 1e9)) {
        return 'no clock'
    }
    return new Date(id * 1000).toISOString().substring(0, 16).replace('T', ' ')
}
