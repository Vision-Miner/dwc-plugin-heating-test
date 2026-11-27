// Data contract with sys/lib/heattest/ in vm22-v4-firmware. See ABI.md.
export const ABI_VERSION = 3
export const RUNS_DIR = '0:/sys/logs/heattest'
export const RUN_PREFIX = 'ht'
// samples-<nnn>.csv, 10 minutes each, from version 3 on
export const SAMPLES_PART = /^samples-\d+\.csv$/
export const FILES = {
    // One file for the whole run before version 3
    samples: 'samples.csv',
    events: 'events.csv',
    header: 'header.csv',
    summary: 'summary.txt'
}
export const VOLTMETER_FILE = /^voltmeter-.+\.txt$/
// Created by the test only while it takes readings; the page writes here only while the file exists
export const VOLTMETER_INPUT = '0:/macros/System/Troubleshooting/Advanced Heating Test - Voltmeter.txt'

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
    VOLTMETER: 'VOLTMETER',
    RUN_END: 'RUN_END'
}

// At or above this a reading means the sensor is lost (firmware reports 2000)
export const SENSOR_LOST = 1999
