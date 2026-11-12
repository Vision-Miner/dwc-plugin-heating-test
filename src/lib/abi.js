// Data contract with sys/lib/heattest/ in vm22-v4-firmware. See ABI.md.
export const ABI_VERSION = 1
export const RUNS_DIR = '0:/sys/logs/heattest'
export const RUN_PREFIX = 'ht'
export const FILES = {
    samples: 'samples.csv',
    events: 'events.csv',
    header: 'header.csv',
    summary: 'summary.txt'
}

export const STRING_COLUMNS = new Set([
    'status', 'b1_state', 'H0_state', 'H1_state', 'H2_state', 'H3_state',
    's0_state', 's1_state', 's2_state', 's3_state', 's4_state', 'log'
])

export const PHASE = { COOL: 0, HEAT: 1, AFTER: 2, END_LOG: 3, WATCH: 4 }
export const EVENT = {
    STEP_START: 'STEP_START',
    FAULT: 'FAULT',
    STOP: 'STOP',
    NOT_REACHED: 'NOT_REACHED',
    WARN: 'WARN',
    RUN_END: 'RUN_END'
}

// At or above this a reading means the sensor is lost (firmware reports 2000)
export const SENSOR_LOST = 1999
