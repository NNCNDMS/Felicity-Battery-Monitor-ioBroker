/*
 * Felicity Battery (TCP) Integration for ioBroker
 * ================================================
 *
 * Version: 1.0.0
 * Date:    2026-10-12
 *
 * Reads telemetry, firmware info and configuration parameters from Felicity
 * FLA48200 and compatible batteries via an unofficial local TCP API on
 * port 53970.
 *
 * Based on the Home Assistant integration by vitalik33-tir:
 *   https://github.com/vitalik33-tir/HA-felicity-battery
 * Licensed under MIT (same as the upstream project).
 *
 * Ported to the ioBroker JavaScript adapter by NNCNDMS:
 *   https://github.com/NNCNDMS
 *
 * Tested with:
 *   - LUX-E-48100LG03 (48 V / 100 Ah LiFePO4)
 *   - Should also work with Felicity FLA48200 and other Felicity-family
 *     batteries that share the same WiFi module firmware.
 *
 * Usage:
 *   1. Install this file in the ioBroker javascript adapter (v9 or newer).
 *   2. Set HOST to the IP of your battery's WiFi module.
 *   3. All datapoints are created under 0_userdata.0.Felicity.*
 *
 * Threshold-key naming convention used by the BMS (see SETTINGS_MAP below):
 *   Hi      hard trip (protection)
 *   Hi2     second-stage trip (harder threshold)
 *   HA      alarm/warning
 *   HAB     alarm reset  ("A-Back")
 *   HB      protection reset ("Back")
 *   Lo/L2/LA/LAB/LB   analogous on the low side
 *
 * Unit note:
 *   - Runtime temperatures (BTemp) arrive in deci-°C and are divided by 10.
 *   - Configuration temperatures ('dev set infor') arrive in plain °C.
 *
 * Unconfirmed settings:
 *   Settings keys whose meaning is not documented are stored unscaled under
 *   0_userdata.0.Felicity.settings_raw.<original key>. Interpretations in the
 *   state names are marked with "?" and are educated guesses only.
 *
 * Disclaimer:
 *   The TCP API used here was discovered by traffic analysis and is not
 *   an officially documented interface. Use at your own risk.
 */

const net = require('net');

const SCRIPT_VERSION = '1.0.0';

// ---------- CONFIGURATION ----------
const HOST = '192.168.178.119';       // IP of the battery WiFi module
const PORT = 53970;
const POLL_RUNTIME_MS = 30_000;       // runtime telemetry every 30 s
const POLL_META_MS = 60 * 60_000;     // basic info + settings every 60 min
const STATE_PREFIX = '0_userdata.0.Felicity';
const RAW_PREFIX = 'settings_raw';    // sub-folder for unconfirmed settings
const TIMEOUT_MS = 5000;

log(`Felicity script v${SCRIPT_VERSION}: startup`, 'info');

// ---------- Runtime & meta state definitions ----------
// [id, display name, unit, role, type]
const STATES_RUNTIME = [
    // Runtime telemetry
    ['soc',                     'Battery SOC',              '%',    'value.battery',       'number'],
    ['voltage',                 'Battery Voltage',          'V',    'value.voltage',       'number'],
    ['current',                 'Battery Current',          'A',    'value.current',       'number'],
    ['power',                   'Battery Power',            'W',    'value.power',         'number'],
    ['charge_power',            'Charge Power',             'W',    'value.power',         'number'],
    ['discharge_power',         'Discharge Power',          'W',    'value.power',         'number'],
    ['direction',               'Direction',                '',     'text',                'string'],
    ['temp1',                   'Battery Temp 1',           '°C',   'value.temperature',   'number'],
    ['temp2',                   'Battery Temp 2',           '°C',   'value.temperature',   'number'],
    ['max_cell_v',              'Max Cell Voltage',         'V',    'value.voltage',       'number'],
    ['min_cell_v',              'Min Cell Voltage',         'V',    'value.voltage',       'number'],
    ['cell_drift',              'Cell Voltage Drift',       'V',    'value.voltage',       'number'],
    // Status
    ['state',                   'Battery State',            '',     'text',                'string'],
    ['fault',                   'Fault Code',               '',     'value',               'number'],
    ['warning',                 'Warning Code',             '',     'value',               'number'],
    // Meta / identification
    ['fw_version',              'Battery FW Version',       '',     'text',                'string'],
    ['bms_m1_fw',               'BMS M1 FW',                '',     'text',                'string'],
    ['bms_m2_fw',               'BMS M2 FW',                '',     'text',                'string'],
    ['battery_type',            'Battery Type',             '',     'text',                'string'],
    ['battery_subtype',         'Battery SubType',          '',     'text',                'string'],
    ['serial',                  'Battery Serial',           '',     'text',                'string'],
    ['wifi_serial',             'WiFi Module Serial',       '',     'text',                'string'],
    // Housekeeping
    ['last_update',             'Last Runtime Update',      '',     'text',                'string'],
    ['last_meta_update',        'Last Meta Update',         '',     'text',                'string'],
    ['online',                  'Reachable',                '',     'indicator.reachable', 'boolean'],
    ['raw_response',            'Debug: last raw payload',  '',     'text',                'string'],
];

// Configured limits / thresholds (populated from 'dev set infor')
// Not every firmware exposes every key — missing ones stay empty.
const STATES_SETTINGS = [
    // Simple settings
    ['ttl_pack',                    'Battery Pack Count',                '',   'value',               'number'],
    ['cell_v_80',                   'Cell Voltage @80%',                 'V',  'value.voltage',       'number'],
    ['cell_v_20',                   'Cell Voltage @20%',                 'V',  'value.voltage',       'number'],
    // Cell over-voltage thresholds
    ['cell_ov_protect',             'Cell OV Protect',                   'V',  'value.voltage',       'number'],
    ['cell_ov_protect2',            'Cell OV Protect (Stage 2)',         'V',  'value.voltage',       'number'],
    ['cell_ov_alarm',               'Cell OV Alarm',                     'V',  'value.voltage',       'number'],
    ['cell_ov_alarm_reset',         'Cell OV Alarm Reset',               'V',  'value.voltage',       'number'],
    ['cell_ov_protect_reset',       'Cell OV Protect Reset',             'V',  'value.voltage',       'number'],
    // Cell under-voltage thresholds
    ['cell_uv_protect',             'Cell UV Protect',                   'V',  'value.voltage',       'number'],
    ['cell_uv_protect2',            'Cell UV Protect (Stage 2)',         'V',  'value.voltage',       'number'],
    ['cell_uv_alarm',               'Cell UV Alarm',                     'V',  'value.voltage',       'number'],
    ['cell_uv_alarm_reset',         'Cell UV Alarm Reset',               'V',  'value.voltage',       'number'],
    ['cell_uv_protect_reset',       'Cell UV Protect Reset',             'V',  'value.voltage',       'number'],
    // Charge current thresholds
    ['charge_protect',              'Charge Current Protect',            'A',  'value.current',       'number'],
    ['charge_protect2',             'Charge Current Protect (Stage 2)',  'A',  'value.current',       'number'],
    ['charge_alarm',                'Charge Current Alarm',              'A',  'value.current',       'number'],
    ['charge_alarm_reset',          'Charge Current Alarm Reset',        'A',  'value.current',       'number'],
    // Discharge current thresholds
    ['discharge_protect',           'Discharge Current Protect',         'A',  'value.current',       'number'],
    ['discharge_protect2',          'Discharge Current Protect (2)',     'A',  'value.current',       'number'],
    ['discharge_alarm',             'Discharge Current Alarm',           'A',  'value.current',       'number'],
    ['discharge_alarm_reset',       'Discharge Current Alarm Reset',     'A',  'value.current',       'number'],
    // Charge temperature thresholds (high)
    ['chg_temp_hi_protect',         'Charge Temp High Protect',          '°C', 'value.temperature',   'number'],
    ['chg_temp_hi_protect2',        'Charge Temp High Protect (2)',      '°C', 'value.temperature',   'number'],
    ['chg_temp_hi_alarm',           'Charge Temp High Alarm',            '°C', 'value.temperature',   'number'],
    ['chg_temp_hi_alarm_reset',     'Charge Temp High Alarm Reset',      '°C', 'value.temperature',   'number'],
    // Charge temperature thresholds (low)
    ['chg_temp_lo_protect',         'Charge Temp Low Protect',           '°C', 'value.temperature',   'number'],
    ['chg_temp_lo_protect2',        'Charge Temp Low Protect (2)',       '°C', 'value.temperature',   'number'],
    ['chg_temp_lo_alarm',           'Charge Temp Low Alarm',             '°C', 'value.temperature',   'number'],
    ['chg_temp_lo_alarm_reset',     'Charge Temp Low Alarm Reset',       '°C', 'value.temperature',   'number'],
    // Discharge temperature thresholds (high)
    ['dis_temp_hi_protect',         'Discharge Temp High Protect',       '°C', 'value.temperature',   'number'],
    ['dis_temp_hi_protect2',        'Discharge Temp High Protect (2)',   '°C', 'value.temperature',   'number'],
    ['dis_temp_hi_alarm',           'Discharge Temp High Alarm',         '°C', 'value.temperature',   'number'],
    ['dis_temp_hi_alarm_reset',     'Discharge Temp High Alarm Reset',   '°C', 'value.temperature',   'number'],
    // Discharge temperature thresholds (low)
    ['dis_temp_lo_protect',         'Discharge Temp Low Protect',        '°C', 'value.temperature',   'number'],
    ['dis_temp_lo_protect2',        'Discharge Temp Low Protect (2)',    '°C', 'value.temperature',   'number'],
    ['dis_temp_lo_alarm',           'Discharge Temp Low Alarm',          '°C', 'value.temperature',   'number'],
    ['dis_temp_lo_alarm_reset',     'Discharge Temp Low Alarm Reset',    '°C', 'value.temperature',   'number'],
    // MOSFET / heatsink temperature thresholds
    ['mosfet_temp_protect',         'MOSFET Temp Protect',               '°C', 'value.temperature',   'number'],
    ['mosfet_temp_alarm',           'MOSFET Temp Alarm',                 '°C', 'value.temperature',   'number'],
    // Balancing configuration
    ['balance_enabled',             'Balancing Enabled',                 '',   'indicator',           'boolean'],
    ['balance_by_voltage',          'Balance by Voltage',                '',   'indicator',           'boolean'],
    ['balance_by_temp',             'Balance by Temperature',            '',   'indicator',           'boolean'],
    ['balance_delta_trigger',       'Balance Delta Trigger',             'V',  'value.voltage',       'number'],
];

// Unconfirmed settings, stored unscaled under settings_raw.<key>.
// [original key, display name, type]
// Names ending in "?" are guesses based on observed values and on the
// behaviour of comparable BMS (e.g. Pylontech), NOT on documentation.
// Units are deliberately left empty because none of them is confirmed.
const RAW_SETTINGS = [
    ['CommVer',  'CommVer – protocol version',                      'number'],
    ['DevSN',    'DevSN – device serial (same as serial)',          'string'],
    ['modID',    'modID – module ID',                               'number'],
    ['index',    'index – response block index?',                   'number'],
    ['Type',     'Type – battery type code',                        'number'],
    ['wHMHt',    'wHMHt – unknown (heater?)',                       'number'],
    ['wSlNum',   'wSlNum – number of slaves? (parallel packs)',     'number'],
    ['wMlAdd',   'wMlAdd – master/slave address? (parallel packs)', 'number'],
    ['wMlRes',   'wMlRes – unknown (parallel packs?)',              'number'],
    ['cDDep',    'cDDep – unknown',                                 'number'],
    ['cTempC',   'cTempC – unknown',                                'number'],
    ['fRstCnt',  'fRstCnt – max. automatic fault recoveries?',      'number'],
    ['fClrTi',   'fClrTi – fault clear delay? (s)',                 'number'],
    ['iExTime',  'iExTime – idle time until sleep? (min)',          'number'],
    ['sExTime',  'sExTime – unknown (standby time?)',               'number'],
    ['bWirMo',   'bWirMo – unknown (communication mode?)',          'number'],
    ['bLigEn',   'bLigEn – LED indicator enable?',                  'number'],
    ['mRtnEn',   'mRtnEn – manual reset required after fault?',     'number'],
    ['fRecEn',   'fRecEn – unknown (fault recovery/record enable?)','number'],
];

// Felicity-key -> [state_id, scale function]
// Scale functions convert the raw integer to display units.
const V = (v) => +(v / 1000).toFixed(3);   // mV -> V
const A = (v) => +(v / 10).toFixed(1);     // dA -> A
const T = (v) => +(v / 1).toFixed(1);      // config temperatures are already °C (no division)
const B = (v) => Boolean(v);
const I = (v) => v;

const SETTINGS_MAP = {
    // Basic
    ttlPack:  ['ttl_pack',                    I],
    wCVP80:   ['cell_v_80',                   V],
    wCVP20:   ['cell_v_20',                   V],
    // Cell over-voltage
    cVolHi:   ['cell_ov_protect',             V],
    cVolH2:   ['cell_ov_protect2',            V],
    cVolHA:   ['cell_ov_alarm',               V],
    cVolHAB:  ['cell_ov_alarm_reset',         V],
    cVolHB:   ['cell_ov_protect_reset',       V],
    // Cell under-voltage
    cVolLo:   ['cell_uv_protect',             V],
    cVolL2:   ['cell_uv_protect2',            V],
    cVolLA:   ['cell_uv_alarm',               V],
    cVolLAB:  ['cell_uv_alarm_reset',         V],
    cVolLB:   ['cell_uv_protect_reset',       V],
    // Charge current
    bCCHi:    ['charge_protect',              A],
    bCCHi2:   ['charge_protect2',             A],
    bCCHA:    ['charge_alarm',                A],
    bCCHAB:   ['charge_alarm_reset',          A],
    // Discharge current
    bDCHi:    ['discharge_protect',           A],
    bDCHi2:   ['discharge_protect2',          A],
    bDCHA:    ['discharge_alarm',             A],
    bDCHAB:   ['discharge_alarm_reset',       A],
    // Charge temperature (high side)
    cCTHi:    ['chg_temp_hi_protect',         T],
    cCTHi2:   ['chg_temp_hi_protect2',        T],
    cCTHA:    ['chg_temp_hi_alarm',           T],
    cCTHAB:   ['chg_temp_hi_alarm_reset',     T],
    // Charge temperature (low side)
    cCTLo:    ['chg_temp_lo_protect',         T],
    cCTLo2:   ['chg_temp_lo_protect2',        T],
    cCTLA:    ['chg_temp_lo_alarm',           T],
    cCTLAB:   ['chg_temp_lo_alarm_reset',     T],
    // Discharge temperature (high side)
    cDTHi:    ['dis_temp_hi_protect',         T],
    cDTHi2:   ['dis_temp_hi_protect2',        T],
    cDTHA:    ['dis_temp_hi_alarm',           T],
    cDTHAB:   ['dis_temp_hi_alarm_reset',     T],
    // Discharge temperature (low side)
    cDTLo:    ['dis_temp_lo_protect',         T],
    cDTLo2:   ['dis_temp_lo_protect2',        T],
    cDTLA:    ['dis_temp_lo_alarm',           T],
    cDTLAB:   ['dis_temp_lo_alarm_reset',     T],
    // MOSFET / heatsink
    hTHi:     ['mosfet_temp_protect',         T],
    hTHAlm:   ['mosfet_temp_alarm',           T],
    // Balancing
    balEn:    ['balance_enabled',             B],
    balVEn:   ['balance_by_voltage',          B],
    balTEn:   ['balance_by_temp',             B],
    balVErr:  ['balance_delta_trigger',       V],
};

// Lookup of known raw keys for quick membership tests
const RAW_KEYS = new Set(RAW_SETTINGS.map(([key]) => key));

// Two-digit cell index helper: 1 -> "01", 16 -> "16"
function pad2(n) { return String(n).padStart(2, '0'); }

// Create a single state. existsState() prevents redundant creation attempts
// on script restart, keeping the log clean. createState() in adapter v9
// rejects `def: null` on typed states, so no default value is passed.
function ensureState(id, name, unit, role, type) {
    const fullId = `${STATE_PREFIX}.${id}`;
    return new Promise((resolve) => {
        try {
            if (existsState(fullId)) {
                resolve();
                return;
            }
            createState(fullId, null, false, {
                name, unit, role, type, read: true, write: false,
            }, () => resolve());
        } catch (e) {
            log(`ensureState(${id}) exception: ${e.message}`, 'error');
            resolve();
        }
    });
}

// Write a value via setState() — accepts full foreign IDs.
function setVal(id, value) {
    return new Promise((resolve) => {
        try {
            setState(`${STATE_PREFIX}.${id}`, value, true, () => resolve());
        } catch (e) {
            log(`setVal(${id}) exception: ${e.message}`, 'warn');
            resolve();
        }
    });
}

// Create all datapoints
async function ensureAllStates() {
    log(`Creating states under ${STATE_PREFIX}.* ...`, 'info');
    for (const [id, name, unit, role, type] of STATES_RUNTIME) {
        await ensureState(id, name, unit, role, type);
    }
    for (const [id, name, unit, role, type] of STATES_SETTINGS) {
        await ensureState(id, name, unit, role, type);
    }
    // Unconfirmed settings, raw values under settings_raw.*
    for (const [key, name, type] of RAW_SETTINGS) {
        const role = type === 'string' ? 'text' : 'value';
        await ensureState(`${RAW_PREFIX}.${key}`, name, '', role, type);
    }
    // Cell voltages cell_01_v ... cell_16_v
    for (let i = 1; i <= 16; i++) {
        const id = `cell_${pad2(i)}_v`;
        await ensureState(id, `Cell ${pad2(i)} Voltage`, 'V', 'value.voltage', 'number');
    }
    log('States ready.', 'info');
}

// ---------- TCP transport ----------
// Opens one TCP connection, sends the raw command, collects the response
// until a closing brace is seen (plus a short grace period for trailing data)
function sendCommand(command) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let buffer = Buffer.alloc(0);
        let settled = false;
        let closeTimer = null;

        const done = (err, data) => {
            if (settled) return;
            settled = true;
            if (closeTimer) clearTimeout(closeTimer);
            try { client.destroy(); } catch (e) { /* ignore */ }
            err ? reject(err) : resolve(data);
        };

        const timer = setTimeout(
            () => done(new Error(`Timeout after ${TIMEOUT_MS}ms`)),
            TIMEOUT_MS,
        );

        client.on('connect', () => client.write(command));

        client.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.includes(0x7D)) {
                if (closeTimer) clearTimeout(closeTimer);
                closeTimer = setTimeout(() => {
                    clearTimeout(timer);
                    done(null, buffer.toString('ascii'));
                }, 300);
            }
        });

        client.on('error', err => {
            clearTimeout(timer);
            done(new Error(`TCP error: ${err.message}`));
        });

        client.on('close', () => {
            if (!settled && buffer.length > 0) {
                clearTimeout(timer);
                done(null, buffer.toString('ascii'));
            } else if (!settled) {
                clearTimeout(timer);
                done(new Error('Connection closed without data'));
            }
        });

        client.connect(PORT, HOST);
    });
}

// ---------- Parsers ----------
// Felicity payloads use single quotes and may contain trailing junk;
// normalize and try a strict JSON parse first.
function parseSingleJson(text) {
    let norm = text.replace(/'/g, '"').trim();
    const last = norm.lastIndexOf('}');
    if (last !== -1) norm = norm.substring(0, last + 1);
    try {
        return JSON.parse(norm);
    } catch (e) {
        log(`parseSingleJson failed: ${e.message}`, 'warn');
        return {};
    }
}

// The settings command returns several concatenated JSON objects.
// Track brace depth to isolate each block, then merge them.
function parseMultiJson(text) {
    const norm = text.replace(/'/g, '"').trim();
    const merged = {};
    let depth = 0, start = null;
    for (let i = 0; i < norm.length; i++) {
        const ch = norm[i];
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start !== null) {
                    try {
                        Object.assign(merged, JSON.parse(norm.substring(start, i + 1)));
                    } catch (e) {
                        log(`Skipping invalid JSON block: ${e.message}`, 'debug');
                    }
                    start = null;
                }
            }
        }
    }
    return merged;
}

// ---------- Runtime poll ----------
let firstRuntimeOk = false;
async function pollRuntime() {
    try {
        const raw = await sendCommand('wifilocalMonitor:get dev real infor');
        await setVal('raw_response', raw.substring(0, 1000));

        const d = parseSingleJson(raw);

        // Batt: [[voltage_mV], [current_dA], [null]]
        const vRaw = d.Batt?.[0]?.[0];
        const iRaw = d.Batt?.[1]?.[0];
        const socRaw = d.Batsoc?.[0]?.[0];

        const voltage = vRaw != null ? +(vRaw / 1000).toFixed(2) : null;
        const current = iRaw != null ? +(iRaw / 10).toFixed(1)   : null;
        const power   = (voltage != null && current != null)
            ? Math.round(voltage * current)
            : null;
        const soc = socRaw != null ? +(socRaw / 100).toFixed(1) : null;

        await setVal('soc',             soc);
        await setVal('voltage',         voltage);
        await setVal('current',         current);
        await setVal('power',           power);
        await setVal('charge_power',    power > 0 ? power  : 0);
        await setVal('discharge_power', power < 0 ? -power : 0);

        // Charge/discharge direction with a small deadband
        let direction = 'idle';
        if (current > 0.05) direction = 'charging';
        else if (current < -0.05) direction = 'discharging';
        await setVal('direction', direction);

        // Runtime temperatures (deci-°C -> °C)
        const t1 = d.BTemp?.[0]?.[0];
        const t2 = d.BTemp?.[0]?.[1];
        if (t1 != null) await setVal('temp1', +(t1 / 10).toFixed(1));
        if (t2 != null) await setVal('temp2', +(t2 / 10).toFixed(1));

        // Cell aggregates (mV -> V)
        const maxV = d.BMaxMin?.[0]?.[0];
        const minV = d.BMaxMin?.[0]?.[1];
        if (maxV != null) await setVal('max_cell_v', +(maxV / 1000).toFixed(3));
        if (minV != null) await setVal('min_cell_v', +(minV / 1000).toFixed(3));
        if (maxV != null && minV != null) {
            await setVal('cell_drift', +((maxV - minV) / 1000).toFixed(3));
        }

        // Individual cell voltages 01..16 (65535 = invalid marker)
        const cells = d.BatcelList?.[0] || [];
        for (let i = 0; i < 16; i++) {
            const rawCell = cells[i];
            const val = (rawCell != null && rawCell !== 65535)
                ? +(rawCell / 1000).toFixed(3)
                : null;
            await setVal(`cell_${pad2(i + 1)}_v`, val);
        }

        // Estate code -> human-readable state
        const estate = d.Estate;
        let stateStr = `unknown(${estate})`;
        if (estate === 320)  stateStr = 'full';
        else if (estate === 960)  stateStr = 'standby';
        else if (estate === 9152) stateStr = 'charging';
        else if (estate === 5056) stateStr = 'discharging';
        await setVal('state',   stateStr);
        await setVal('fault',   d.Bfault ?? 0);
        await setVal('warning', d.Bwarn  ?? 0);

        if (d.DevSN)  await setVal('serial',      d.DevSN);
        if (d.wifiSN) await setVal('wifi_serial', d.wifiSN);

        await setVal('online',      true);
        await setVal('last_update', new Date().toISOString());

        if (!firstRuntimeOk) {
            log(`First runtime poll OK: SOC=${soc}%, V=${voltage}V, I=${current}A, P=${power}W`, 'info');
            firstRuntimeOk = true;
        }
    } catch (err) {
        log(`Runtime poll error: ${err.message}`, 'warn');
        await setVal('online', false);
    }
}

// ---------- Meta poll (basic info + settings) ----------
async function pollMeta() {
    // Basic info: firmware versions, battery type, subtype
    try {
        const rawBasic = await sendCommand('wifilocalMonitor:get dev basice infor');
        const b = parseSingleJson(rawBasic);

        if (b.version)  await setVal('fw_version',      String(b.version));
        if (b.M1SwVer)  await setVal('bms_m1_fw',       String(b.M1SwVer));
        if (b.M2SwVer)  await setVal('bms_m2_fw',       String(b.M2SwVer));
        if (b.Type)     await setVal('battery_type',    String(b.Type));
        if (b.SubType)  await setVal('battery_subtype', String(b.SubType));
    } catch (err) {
        log(`Basic info error: ${err.message}`, 'warn');
    }

    // Some WiFi modules dislike back-to-back requests; give the socket a rest
    await new Promise(r => setTimeout(r, 500));

    // Settings: configured limits and thresholds (multi-JSON response)
    try {
        const rawSet = await sendCommand('wifilocalMonitor:get dev set infor');
        const s = parseMultiJson(rawSet);
        log(`Settings keys received: ${Object.keys(s).join(', ')}`, 'debug');

        // Apply everything we know via the SETTINGS_MAP
        for (const key of Object.keys(SETTINGS_MAP)) {
            const raw = s[key];
            if (raw === undefined || raw === null) continue;
            const [stateId, scale] = SETTINGS_MAP[key];
            try {
                await setVal(stateId, scale(raw));
            } catch (e) {
                log(`Setting ${key} -> ${stateId} error: ${e.message}`, 'debug');
            }
        }

        // Store unconfirmed settings unscaled under settings_raw.*
        for (const [key] of RAW_SETTINGS) {
            const raw = s[key];
            if (raw === undefined || raw === null) continue;
            await setVal(`${RAW_PREFIX}.${key}`, raw);
        }

        // Keys that are in neither map (e.g. from other firmware versions)
        const unknown = Object.keys(s).filter(k => !(k in SETTINGS_MAP) && !RAW_KEYS.has(k));
        if (unknown.length) {
            log(`Unmapped settings: ${unknown.map(k => `${k}=${JSON.stringify(s[k])}`).join(', ')}`, 'info');
        }
    } catch (err) {
        log(`Settings error: ${err.message}`, 'warn');
    }

    await setVal('last_meta_update', new Date().toISOString());
}

// ---------- Init ----------
(async () => {
    try {
        await ensureAllStates();
        await pollRuntime();
        await pollMeta();
        log(`Init done. Runtime interval ${POLL_RUNTIME_MS} ms, meta interval ${POLL_META_MS} ms.`, 'info');

        setInterval(pollRuntime, POLL_RUNTIME_MS);
        setInterval(pollMeta,    POLL_META_MS);
    } catch (err) {
        log(`Init error: ${err.message}`, 'error');
        log(err.stack || 'no stack', 'error');
    }
})();
