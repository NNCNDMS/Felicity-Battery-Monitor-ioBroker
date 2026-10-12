# Felicity-Battery-Monitor-ioBroker (TCP)

A [ioBroker](https://www.iobroker.net/) JavaScript-adapter script that polls
telemetry, firmware information and BMS configuration from Felicity-family
batteries via their unofficial local TCP API on port 53970.

No cloud, no third-party service — everything happens on your local network.

## Screenshot

<img width="1400" height="734" alt="Bild1" src="https://github.com/user-attachments/assets/ff490697-8b3c-40a4-970d-6ab7409d1330" />

## Features

- Live telemetry every 30 s: SOC, voltage, current, power, temperatures
- Individual cell voltages (1–16 cells) with drift diagnostics
- Full BMS configuration snapshot every 60 min:
  cell voltage thresholds, current limits, temperature protections,
  balancing parameters
- Undocumented BMS settings stored as raw values, clearly marked as
  unconfirmed
- Robust parser that handles Felicity's single-quoted, multi-block JSON
- All data stored under `0_userdata.0.Felicity.*`

## Hardware Compatibility

Tested with:

- **LUX-E-48100LG03** — 48 V / 100 Ah LiFePO4

Expected to work with (same WiFi module firmware and TCP protocol):

- Felicity **FLA48200**
- Other Felicity-family batteries responding to the `wifilocalMonitor:*`
  command set

If your battery is reachable via TCP on port 53970 and replies to
`wifilocalMonitor:get dev real infor`, this script should work for you.

## Requirements

- ioBroker with the **JavaScript adapter** (v9 or newer)
- Battery WiFi module reachable from your ioBroker host

## Installation

1. Open ioBroker Admin → **Scripts** → create a new **JavaScript** script.
2. Paste the contents of [`Felicity_BMS_Control.js`](./Felicity_BMS_Control.js).
3. Edit the `HOST` constant near the top of the file:
   ```javascript
   const HOST = '111.111.111.111';   // <-- your battery's IP
   ```
4. Save and start the script.

On first run the script creates all datapoints under
`0_userdata.0.Felicity.*` and starts polling. Expected log output:

```
Felicity script v1.0.0: startup
Creating states under 0_userdata.0.Felicity.* ...
States ready.
First runtime poll OK: SOC=66%, V=54.4V, I=30.7A, P=1670W
Init done. Runtime interval 30000 ms, meta interval 3600000 ms.
```

## Configuration

The following constants near the top of the script can be adjusted:

| Constant | Default | Description |
|---|---|---|
| `HOST` | `'111.111.111.111'` | Battery WiFi module IP |
| `PORT` | `53970` | TCP port (Felicity standard) |
| `POLL_RUNTIME_MS` | `30000` | Runtime telemetry interval (ms) |
| `POLL_META_MS` | `3600000` | Configuration snapshot interval (ms, 1 h) |
| `STATE_PREFIX` | `'0_userdata.0.Felicity'` | ioBroker path for all states |
| `TIMEOUT_MS` | `5000` | TCP timeout per command |

## Datapoints

All datapoints live under `0_userdata.0.Felicity.*`.

### Live telemetry (30 s cadence)

| State | Unit | Description |
|---|---|---|
| `soc` | % | State of Charge |
| `voltage` | V | Pack voltage |
| `current` | A | Pack current — positive = charge, negative = discharge |
| `power` | W | Signed power |
| `charge_power` | W | Charge power (0 while discharging) |
| `discharge_power` | W | Discharge power (0 while charging) |
| `direction` | — | `charging`, `discharging` or `idle` |
| `temp1`, `temp2` | °C | BMS temperature sensors |

### Cell diagnostics

| State | Unit | Description |
|---|---|---|
| `cell_01_v` … `cell_16_v` | V | Individual cell voltages |
| `max_cell_v` | V | Highest cell voltage |
| `min_cell_v` | V | Lowest cell voltage |
| `cell_drift` | V | max − min (imbalance indicator) |

### Status

| State | Description |
|---|---|
| `state` | Human-readable: `full`, `standby`, `charging`, `discharging` |
| `fault` | Fault code (0 = no fault) |
| `warning` | Warning code (0 = no warning) |

### Battery identification (60 min cadence)

| State | Description |
|---|---|
| `fw_version` | Battery firmware version |
| `bms_m1_fw`, `bms_m2_fw` | BMS module firmware versions |
| `battery_type`, `battery_subtype` | Model identifiers |
| `serial` | Battery serial number |
| `wifi_serial` | WiFi module serial number |

### Threshold naming convention

Felicity's BMS uses a consistent naming pattern for each threshold family:

| Suffix | Meaning |
|---|---|
| `_protect` | Hard trip (protection triggers) |
| `_protect2` | Second-stage / harder trip |
| `_alarm` | Warning threshold |
| `_alarm_reset` | Hysteresis reset from alarm |
| `_protect_reset` | Hysteresis reset from protection |

Not every firmware exposes every level — missing ones simply stay empty.

### Configuration — cell voltage

| High side | Low side | Unit |
|---|---|---|
| `cell_ov_protect` | `cell_uv_protect` | V |
| `cell_ov_protect2` | `cell_uv_protect2` | V |
| `cell_ov_alarm` | `cell_uv_alarm` | V |
| `cell_ov_alarm_reset` | `cell_uv_alarm_reset` | V |
| `cell_ov_protect_reset` | `cell_uv_protect_reset` | V |

### Configuration — pack current

| Charge | Discharge | Unit |
|---|---|---|
| `charge_protect` | `discharge_protect` | A |
| `charge_protect2` | `discharge_protect2` | A |
| `charge_alarm` | `discharge_alarm` | A |
| `charge_alarm_reset` | `discharge_alarm_reset` | A |

### Configuration — temperature

| Charge (high) | Charge (low) | Discharge (high) | Discharge (low) |
|---|---|---|---|
| `chg_temp_hi_protect` | `chg_temp_lo_protect` | `dis_temp_hi_protect` | `dis_temp_lo_protect` |
| `chg_temp_hi_protect2` | `chg_temp_lo_protect2` | `dis_temp_hi_protect2` | `dis_temp_lo_protect2` |
| `chg_temp_hi_alarm` | `chg_temp_lo_alarm` | `dis_temp_hi_alarm` | `dis_temp_lo_alarm` |
| `chg_temp_hi_alarm_reset` | `chg_temp_lo_alarm_reset` | `dis_temp_hi_alarm_reset` | `dis_temp_lo_alarm_reset` |

Plus MOSFET / heatsink temperature: `mosfet_temp_protect`, `mosfet_temp_alarm`.

All values in °C. Note that the BMS reports configuration temperatures as
plain °C, whereas the live temperatures (`temp1`, `temp2`) arrive in
tenths of a degree and are divided by 10.

### Configuration — balancing

| State | Unit | Description |
|---|---|---|
| `balance_enabled` | bool | Balancing master switch |
| `balance_by_voltage` | bool | Voltage-triggered balancing enabled |
| `balance_by_temp` | bool | Temperature-triggered balancing enabled |
| `balance_delta_trigger` | V | Delta voltage that starts balancing |

### Configuration — miscellaneous

| State | Unit | Description |
|---|---|---|
| `ttl_pack` | — | Number of parallel packs |
| `cell_v_80` | V | Cell voltage at 80 % SOC calibration point |
| `cell_v_20` | V | Cell voltage at 20 % SOC calibration point |

### Housekeeping

| State | Description |
|---|---|
| `online` | `true` if the last poll succeeded |
| `last_update` | ISO timestamp of the last runtime poll |
| `last_meta_update` | ISO timestamp of the last meta poll |
| `raw_response` | Last raw payload from the battery (troubleshooting) |

### Unconfirmed settings — `settings_raw.*`

The BMS reports a number of settings keys whose meaning is not documented
anywhere. Rather than guessing silently, the script stores them **unscaled**
under `0_userdata.0.Felicity.settings_raw.<original key>`. No units are set,
because none is confirmed.

Where a plausible interpretation exists, the datapoint name carries it with a
trailing **"?"**. These interpretations are educated guesses derived from the
observed values and from the behaviour of comparable BMS (in particular
Pylontech, whose CAN/RS485 protocol Felicity batteries emulate towards the
inverter). **They are not confirmed by Felicity.**

| Key | Value seen¹ | Interpretation |
|---|---|---|
| `iExTime` | 1440 | Idle time until sleep? (min) — 1440 min = 24 h; Pylontech has a comparable idle-to-sleep timer |
| `fRstCnt` | 10 | Max. number of automatic fault recoveries? |
| `fClrTi` | 60 | Fault clear delay? (s) |
| `mRtnEn` | 0 | Manual reset required after fault? |
| `bLigEn` | 0 | LED indicator enable? |
| `wSlNum` | 0 | Number of slaves? (parallel packs) |
| `wMlAdd` | 0 | Master/slave address? (parallel packs) |
| `wMlRes` | 0 | Unknown, possibly parallel-pack related |
| `sExTime` | 5 | Unknown (standby time?), unit unclear |
| `cDDep` | 31 | Unknown — untypical as a SOC limit, possibly a bitmask (0x1F) |
| `wHMHt` | 0 | Unknown (heater?) |
| `bWirMo` | 0 | Unknown (communication mode?) |
| `fRecEn` | 0 | Unknown (fault recovery or fault record enable?) |
| `cTempC` | 0 | Unknown |
| `CommVer` | 1 | Protocol version |
| `DevSN` | — | Device serial, same as `serial` |
| `modID` | 1 | Module ID |
| `index` | 2 | Response block index? |
| `Type` | 112 | Battery type code |

¹ LUX-E-48100LG03, single pack. Values on other models or firmware versions
may differ.

**Help wanted:** If you can confirm a meaning — for example by changing a
parameter in the manufacturer's app and watching which key changes — please
open an issue or pull request. Please do not experiment with protection
parameters for this purpose.

## Protocol

The script sends three commands over raw TCP:

| Command | Cadence | Purpose |
|---|---|---|
| `wifilocalMonitor:get dev real infor` | 30 s | Runtime telemetry |
| `wifilocalMonitor:get dev basice infor` | 60 min | Firmware & model information |
| `wifilocalMonitor:get dev set infor` | 60 min | Configuration snapshot |

Responses arrive as ASCII text with single-quoted JSON (sometimes multiple
concatenated blocks in the settings response). The script normalises quote
characters and merges blocks before parsing.

## Adding Unknown Settings Keys

Firmware revisions expose different sets of `settings` keys. If your BMS
returns a key that is neither mapped nor listed in `RAW_SETTINGS`, it shows
up in the log at `info` level together with its value:

```
Unmapped settings: someKey=42, anotherKey=0
```

**Meaning unknown:** add the key to `RAW_SETTINGS` so its raw value is
stored under `settings_raw.*`:

```javascript
['someKey', 'someKey – unknown', 'number'],
```

**Meaning confirmed:** promote it to a proper datapoint. This takes two
edits (and removing the entry from `RAW_SETTINGS`, if present):

1. **`STATES_SETTINGS`** — add a datapoint definition
   ```javascript
   ['my_new_state', 'Human Readable Name', 'V', 'value.voltage', 'number'],
   ```
2. **`SETTINGS_MAP`** — map the Felicity key to the datapoint with a scale
   function (`V` for mV→V, `A` for dA→A, `T` for temperature in plain °C,
   `B` for boolean, `I` for identity / no scaling)
   ```javascript
   someKey: ['my_new_state', V],
   ```

Pull requests welcome.

## Troubleshooting

**No states appear in `0_userdata.0.Felicity`**
- Check the log for `Runtime poll error: Timeout after 5000ms` — HOST/PORT
  wrong, or a firewall is blocking the connection
- Verify the WiFi module is reachable, e.g. `nc -v <IP> 53970`
- Make sure the JavaScript adapter is v9 or newer

**"Object … can't be copied: {}" warnings on script start**
- Harmless — happens when states from an earlier version already exist as
  empty stubs. Delete the affected states under `0_userdata.0.Felicity.*`
  in Admin → Objects and restart the script.

**Values look wrong (temperatures at 300 °C, currents in the thousands)**
- Firmware variant with a different scaling factor. Inspect
  `raw_response` and file an issue.

## Credits

- Original Home Assistant integration and TCP protocol reverse-engineering:
  [vitalik33-tir/HA-felicity-battery](https://github.com/vitalik33-tir/HA-felicity-battery)
- ioBroker port and settings-key expansion: this repository

## License

MIT — same as the upstream project.
