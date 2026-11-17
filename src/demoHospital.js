// "Load demo hospital": 30 sample devices for trying RecallRadar without a real inventory.
//
// Manufacturer and model names are real ones taken from actual openFDA device recalls
// (api.fda.gov/device/enforcement), checked in November 2026. Where a device is meant to be
// affected by a real recall, its serial/lot number is one that the recall itself lists.
// Ward names, "name" labels, and the serial numbers of devices that are NOT meant to be
// affected are made up.
//
// How the demo is built (what the matching engine is meant to find, in the order devices appear):
//   demo-001..012  serial/lot is listed in a real recall             -> expect "exact"
//   demo-013..021  model is in a real recall, serial/lot is not      -> expect "likely"
//   demo-022..024  same manufacturer + type, or same model number    -> expect "possible"
//   demo-025..030  real devices with older recalls                   -> with the three-year look-back several of these
//                  now match too (that is what the longer window is for); two have no match at all
// Six devices carry a real UDI-DI from the same recalls (Philips 5500, Baxter Novum IQ and SIGMA Spectrum, Impella, ResMed
// Astral, GE Carescape), so recalls that name the identifier are found by it: the Astral ventilator is exact because its
// serial is inside the range the recall states ("serial number < 22241890149").
//
// Checked live on 2026-11-17 (scripts/check-demo-matches.mjs, three-year look-back, paging, UDI-DI queries): 16 exact,
// 9 likely, 3 possible, 2 with no match. Serial numbers of the "likely" group were chosen so they do NOT appear in
// the real recall (an invented number can collide with a real one: the Plum Duo recall lists
// thousands). Expected results can drift as FDA publishes new recalls and as recalls leave the three-year window.
import { DEVICE_SOURCES } from './deviceStore.js';

const DEMO_ID_PREFIX = 'demo-';

// [name, type, manufacturer, model, lotOrSerial, ward, udiDi (optional)]
// The UDI-DIs are real ones, taken from the same real recalls (openFDA code_info), so a recall that names the identifier is found
// by it. Only some devices have one, as in a real hospital.
const DEMO_ROWS = [
  // --- listed serial/lot -> exact -------------------------------------------------------
  ['Plum Duo infusion pump', 'infusion pump', 'ICU Medical', '400020401', '50003704', 'ICU'],
  ['Plum Duo infusion pump', 'infusion pump', 'ICU Medical', '400020403', '50004072', 'Med-Surg 3W'],
  ['Aisys CS2 anesthesia machine', 'anesthesia system', 'Datex-Ohmeda', 'Aisys CS2', 'ANAS01357', 'OR-1'],
  ['Aisys CS2 anesthesia machine', 'anesthesia system', 'Datex-Ohmeda', 'Aisys CS2', 'ANAQ00988', 'OR-2'],
  ['SERVO-U Y sensor module', 'ventilator', 'Maquet Critical Care AB', '6693662', '21088', 'ICU'],
  ['MiniMed 780G insulin pump', 'insulin pump', 'Medtronic MiniMed', 'MMT-1885CLW', 'NG3150737H', 'Endocrinology'],
  ['Radius VSM ECG pre-connected set', 'ECG set', 'Masimo', '4842', '25AJH', 'Telemetry'],
  ['Telemetry Monitor 5500', 'telemetry monitor', 'Philips', '867232', 'US001A00AW', 'Telemetry', '00884838102842'],
  ['Novum IQ syringe pump', 'syringe pump', 'Baxter Healthcare', '40800BAXUS', 'BX-20431', 'Oncology', '05413765852428'],
  ['samaritan PAD defibrillator', 'defibrillator', 'HeartSine Technologies', '350P', '24D98056051D24', 'ER'],
  ['Digital ECG HD+12', 'ECG', 'Midmark', '4-000-0080', '7817519', 'Cardiology'],
  ['Impella Controller', 'heart pump controller', 'Abiomed', '0042-0000-US', 'IC1014', 'Cath Lab', '00813502010022'],

  // --- model in a real recall, serial/lot not listed -> likely ---------------------------
  ['MiniMed 780G insulin pump', 'insulin pump', 'Medtronic MiniMed', 'MMT-1885CLW', 'NG9999999X', 'Endocrinology'],
  ['Plum Duo infusion pump', 'infusion pump', 'ICU Medical', '400020401', 'ICU-PD-7731', 'Pediatrics'],
  ['BeneVision N15 patient monitor', 'patient monitor', 'Mindray', 'N15', 'BV-N15-0457', 'Cardiology'],
  ['Astral 100 ventilator', 'ventilator', 'ResMed', 'Astral 100', '22241800001', 'Respiratory', '00619498003259'],
  ['IQvitals Zone vital signs monitor', 'vital signs monitor', 'Midmark', '1-200-0330', 'V9999999', 'ER'],
  ['Alaris System with Guardrails Suite MX', 'infusion pump', 'CareFusion 303', 'Guardrails Suite MX', 'AL-55120', 'ICU'],
  ['SIGMA Spectrum infusion pump', 'infusion pump', 'Baxter Healthcare', '35700BAX2', 'SP-30977', 'Med-Surg 4E', '00085412498683'],
  ['LIFEPAK 15 monitor/defibrillator', 'defibrillator', 'Physio-Control', '99577-001256', 'LP15-44801', 'ER'],
  ['Carescape Central Station', 'central station', 'GE Medical Systems Information Technologies', '5867474-04', 'CS-20871', 'Telemetry', '00195278343512'],

  // --- same manufacturer + type, or same model number -> possible ------------------------
  ['DPM 6 patient monitor', 'patient monitor', 'Mindray', 'DPM 6', '', 'NICU'],
  ['Novum IQ syringe pump (older model)', 'syringe pump', 'Baxter Healthcare', '40700BAX', 'BX-7781', 'Oncology'],
  ['SERVO-U ventilator', 'ventilator', 'Getinge', '6693662', '21500', 'ICU'],

  // --- real devices with no current recall -> no match -----------------------------------
  ['Evita V500 ventilator', 'ventilator', 'Draeger Medical', 'Evita V500', 'EV-90013', 'ICU'],
  ['Centrella Smart+ hospital bed', 'hospital bed', 'Baxter Healthcare', 'P7900B000001', 'CB-1204', 'Med-Surg 3W'],
  ['Rad-G pulse oximeter', 'pulse oximeter', 'Masimo', '9847', '6000062119', 'ER'],
  ['LIFEPAK CR2 defibrillator', 'defibrillator', 'Physio-Control', 'CR2-2-001451', 'CR2-49638156', 'ER'],
  ['Servo-i ventilator', 'ventilator', 'Getinge', '6487800', 'SI-77120', 'ICU'],
  ['Puritan Bennett 980 ventilator', 'ventilator', 'Covidien', '980X2ESDIEC', 'PB-30114', 'ICU'],
];

// The 30 demo devices in the shape the device store expects.
export function buildDemoDevices() {
  return DEMO_ROWS.map(([name, type, manufacturer, model, lotOrSerial, ward, udiDi = ''], index) => ({
    id: `${DEMO_ID_PREFIX}${String(index + 1).padStart(3, '0')}`,
    name,
    type,
    manufacturer,
    model,
    lotOrSerial,
    ward,
    udiDi,
    source: DEVICE_SOURCES.DEMO,
  }));
}

// Replace only the demo devices, never the hospital's own: a judge or user who has added real
// devices keeps them. Safe to run repeatedly. Returns how many demo devices are now stored.
export async function loadDemoHospital(store) {
  const devices = buildDemoDevices();
  await store.removeBySource(DEVICE_SOURCES.DEMO);
  return store.saveDevices(devices);
}
