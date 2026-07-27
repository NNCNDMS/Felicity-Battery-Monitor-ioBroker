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
Felicity script: startup
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
returns a key that isn't mapped yet, it shows up in the log at `debug`
level:

```
Unmapped settings keys: someKey, anotherKey
```

Extending the mapping takes two edits:

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
