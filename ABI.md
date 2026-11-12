# Heating test data contract, version 2

The macros in `vm22-v4-firmware` (`sys/lib/heattest/`) write these files and this plugin reads them. `src/lib/abi.js` holds the same lists. Any change bumps `abi` in `header.csv`.

Run folder: `0:/sys/logs/heattest/ht<id>/`. `<id>` is the epoch at start, or `1000000 + upTime` when the clock is unset.

| File | Written | Required |
|---|---|---|
| `samples.csv` | every sample | yes |
| `events.csv` | on each event | no, but steps lose their configuration without it |
| `header.csv` | once, before heating | no, but the fault replay falls back to seed models without it |
| `summary.txt` | at the end | no |
| `eventlog.txt` | by the firmware (`M929`) | no |
| `start.csv` | once, before heating (version 2) | no |
| `voltmeter-<s>.txt`, `voltmeter-end.txt` | by the operator, moved in by Step.g or End.g (version 2) | no |

Files never carry a BOM. Lines end in `\n`. A last line without `\n` is a row still being written and is ignored.

## samples.csv

The first line holds the column names. The reader goes by name, so order is free and unknown columns are kept and ignored. Numbers are plain decimals.

Fast part, every row:

| Column | Source | Note |
|---|---|---|
| `t` | `state.time` + ms | Epoch seconds with decimals, or seconds from an arbitrary zero when `rtc` is 0 in the header |
| `upTime` | `state.upTime` | Going backwards marks a reboot |
| `step` | Step.g `N` | 0 for the cold wait, 99 for the cooling log |
| `ph` | Step.g | 0 cooling before the step, 1 heating, 2 after reach or timed, 3 cooling log at the end, 4 watching after a stop |
| `status` | `state.status` | |
| `b1_state` | `boards[1].state` | |
| `H0_cur` `H0_act` `H0_pwm` `H0_state` | `heat.heaters[0]` | `current`, `active`, `avgPwm`, `state`. Same for H1, H2, H3. `avgPwm` is a running average, so it decays for about 20 s after the heater goes off: read `state` for on or off |
| `S0` .. `S4` | `sensors.analog[n].lastReading` | 2000 means the sensor is lost |
| `F0_act` `F1_act` `F2_act` `F3_act` `F4_act` `F6_act` `F7_act` | `fans[n].actualValue` | |
| `F7_rpm` | `fans[7].rpm` | |
| `vin0` `vin0_min` | `boards[0].vIn` | `current`, `min` |
| `v12_0` `v12_min` | `boards[0].v12` | `current`, `min` |
| `vin1` | `boards[1].vIn.current` | -1 when absent |
| `atx` | `state.atxPower` | 1 or 0 |
| `mbox` | `state.messageBox.seq` | -1 when no box |

Slow part, appended to every 10th row, absent from the others (rows may simply be shorter):

| Column | Source |
|---|---|
| `s0_state` .. `s4_state` | `sensors.analog[n].state` |
| `mcu0` `mcu0_min` `mcu0_max` `mcu1` `mcu1_min` `mcu1_max` | `boards[n].mcuTemp`; -1 when absent |
| `vin0_max` `v12_max` | `boards[0]` |
| `vin1_min` `vin1_max` `v12_1` `v12_1_min` `v12_1_max` | `boards[1]`; -1 when absent |
| `F0_req` `F1_req` `F2_req` `F3_req` `F4_req` `F6_req` `F7_req` | `fans[n].requestedValue` |
| `F0_lo` `F0_hi` `F2_lo` `F2_hi` `F4_lo` `F4_hi` `F7_lo` `F7_hi` | `fans[n].thermostatic`; -1 when manual |
| `X` `Y` `U` `Z` | `move.axes[n].userPosition` |
| `homed` | 1 when X, Y, U and Z are all homed |
| `tool` | `state.currentTool` |
| `dpd` | `state.deferredPowerDown`, 1 or 0 |
| `log` | `state.logFile` |
| `ram0` `ram1` | `boards[n].freeRam` |

A value missing from a row carries the previous value forward.

## events.csv

First line `t,upTime,step,code,detail`. `detail` is in double quotes, with inner quotes doubled.

| Code | Detail |
|---|---|
| `RUN_START` | plan name |
| `STEP_START` | `key=value` pairs separated by spaces: `start=2 bed=180 chamber=100 z=350 hepa=1 exit=1 air=99 min=0 cap=60`. `z` is absent when the step leaves the bed where it is. Bed and chamber 0 is the cooling log |
| `BED_REACHED` | |
| `AIR_REACHED` | |
| `NOT_REACHED` | what ran out |
| `STEP_END` | |
| `VOLTMETER` | name of the `voltmeter-<s>.txt` just moved into the run folder (version 2) |
| `FAULT` | written twice: at once with `Heater fault`, then with the text from `state.messageBox.message` when heater-fault.g's box appears |
| `STOP` | the safety condition, for example `S3>=108` |
| `WARN` | free text, for example `Cold wait skipped at bed 52.31, air 48.12` or `Supply dip: 24 V fell to 5.1, 12 V to 4.2` |
| `RUN_END` | `ok` or the reason |

`hepa`: 0 thermostatic, 1 off until the bed is within 2 C and then `hepaFan/2`, 2 `hepaFan/2` at once. `start`: 0 warm, 1 cold, 2 continue. `exit`: 1 on reach, 0 fixed time.

## header.csv

First line `key,value`, then one pair per line. A value holding a comma or a quote is in double quotes. Unknown keys are shown and ignored.

| Keys | Meaning |
|---|---|
| `abi` | this contract's version, 2 |
| `test_version` `plan` `serial` `rtc` | test, plan, operator's serial, 1 when `t` is epoch |
| `mains_rated` `chamber_heater_w` `mains_v_idle` | operator's answers, 0 when not known (version 2): mains class 120 (110-120 V) or 230 (220-240 V), chamber heater 750 or 850 W, outlet voltmeter reading before heating |
| `board0_id` `board1_id` `fw0` `fw1` `fwdate0` `fwdate1` `release` | identity and versions |
| `H<n>_R` `H<n>_K` `H<n>_Kfan` `H<n>_Ex100` `H<n>_D` `H<n>_maxPwm` `H<n>_V` | `model`: heatingRate, coolingRate, fanCoolingRate, coolingExp x 100, deadTime, maxPwm, standardVoltage. The exponent is scaled since the object model prints it to 1 decimal |
| `H<n>_P` `H<n>_T` `H<n>_bad` `H<n>_max` | `maxHeatingFaultTime`, `maxTempExcursion`, `maxBadReadings`, `max` |
| `H2_P_before` `H2_T_before` `H3_P_before` `H3_T_before` | detection level found before the run set the default |
| `S<n>_offset` `S<n>_slope` | `offsetAdj`, `slopeAdj` |
| `hepaFan` `heaterFaultTimer` `chamberWait` `brushY` | settings |
| `vin0_min_boot` `v12_min_boot` `mcu0_min_boot` | minimums before the first `M122` |
| `pid_bed_log` `sensor_chamber_log` | 1 when `sys/logs/pid_bed.txt` or `sensor_chamber.txt` exists |

## Voltmeter readings (version 2)

The first reading, before heating, is `mains_v_idle` in `header.csv`, entered in a box. Readings under load go through a file, because a box would stop the recording: the test runs as a macro on the HTTP channel, and DWC sends every answer through that channel.

`start.csv` is one line, `<upTime at the test start>,<example>`, so that Step.g can name readings by the time from the start and re-create the file. The example is 110 or 220: the mains class the operator chose, or, when not sure, the class of `mains_v_idle`.

When the operator has a voltmeter, the entry macro creates `0:/sys/logs/heattest/voltmeter.txt` holding only the example (`sys/lib/heattest/VoltmeterFile.g`). The operator types the reading over it in DWC's editor and saves. On every row Step.g compares `seqs.volChanges[0]` with its last value. On a change, while the file exists, it moves the file unchanged into the run folder as `voltmeter-<s>.txt`, where `<s>` is seconds from the test start (`upTime` when `start.csv` is missing), re-creates the file with the example and writes a `VOLTMETER` event. The macros never read the operator's content, since a typo would throw and end the run. The entry macro deletes a `voltmeter.txt` left from an earlier run.

Reading the files:
- The first number in a file is the reading in volts at a socket next to the printer. It may carry a unit or a comma.
- The counter also moves on other writes to the card (`echo >`, renames, deletes, uploads, not appends), so a moved file can be an untouched copy. Such a copy holds exactly the example: show it as "same as the example, maybe untouched", not as a reading.
- Time: `<s>` is within one row (about 1 s) of the save. The file's `lastModified` should be the save time from the browser, kept by the rename (unverified).
- End.g deletes what is left when `seqs.volChanges` exists. Without it Step.g moves nothing, and End.g keeps the last save as `voltmeter-end.txt`, with no time but `lastModified`.
