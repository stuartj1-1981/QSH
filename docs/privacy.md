# QSH Privacy Policy

**Last updated:** 11 April 2026
**Data controller:** Stuart Hunt (QSH Project)
**Contact:** quantum_swarm_heating@gmail.com (contact via email only)

## What QSH Collects

QSH can collect anonymised operational data from your installation to improve heating
optimisation algorithms. Data sharing can be enabled during setup or at any time in
Settings > Data Sharing.

### Data categories

1. **Thermal parameters** — learned heat loss coefficients, thermal mass, and solar gain
   factors for each zone (zones identified by index, not by name)
2. **Building metadata** — approximate floor area, zone count, and emitter type per zone
3. **Heat pump characteristics** — make/model category, declared thermal output, fuel type
4. **Climate region** — the region you selected during setup (e.g. "North West England")
5. **Control performance** — optimisation blend factor, comfort and efficiency scores
6. **Energy metrics** — daily energy consumption (kWh), achieved coefficient of performance,
   normalised cost per degree-hour

### What QSH does NOT collect

- Names, email addresses, or any account information
- Addresses, postcodes, or GPS coordinates
- Room names (replaced with positional indices: room_0, room_1, ...)
- Occupancy schedules or presence detection data
- Energy tariff details or billing information
- Any data from other devices on your network

## How Data is Identified

Each installation is identified by a random UUID generated at first setup. This UUID has
no relationship to your name, email, Home Assistant instance, or any other identifier.
The QSH project cannot determine who you are from the telemetry data alone.

## Purpose

The collected data is used exclusively to:

- Validate and improve thermal parameter learning algorithms
- Measure control optimisation performance across different building types and climates
- Identify patterns that improve heating efficiency for all QSH users

The data is not sold, shared with third parties, or used for advertising.

## Storage and Retention

Telemetry data is stored on CloudFlare R2 infrastructure operated by the QSH project.
Data is retained for 3 years from the date of collection. Retention is reviewed annually.
Data older than the retention period is deleted.

## Your Rights

**Opt out:** You can disable data sharing at any time in Settings > Data Sharing. QSH
continues to operate normally with telemetry disabled.

**Deletion:** You may request deletion of all data associated with your installation UUID
by contacting the QSH project at the address above. Deletion will be completed within
30 days.

**Access:** You may request a copy of all data associated with your installation UUID.

## Legal Basis (GDPR)

Processing is based on consent (Article 6(1)(a) GDPR), obtained through the setup wizard.
Consent is freely given — you may decline or withdraw consent at any time without affecting
your ability to use QSH. The data collected is pseudonymous — identified by a random UUID
that is not linked to personal identity within the telemetry system.

## Contact

For data requests or questions: quantum_swarm_heating@gmail.com (contact via email only)


## Changes

This policy may be updated. Changes will be noted in the CHANGELOG and will take effect
with the next QSH release.
