# QSH Privacy Policy

**Last updated:** 25 October 2026

**Data controller:** Stuart Hunt (QSH Project)

**Contact:** quantum.swarm.heating@gmail.com (contact via email only)

## What QSH Collects

QSH sends no data to the QSH project unless you turn data sharing on. Data sharing is off
when you install QSH. You can turn it on during setup, or at any time in
Settings > Data Sharing.

When data sharing is on, QSH sends pseudonymous operational data from your installation.
The data is used to improve the heating optimisation algorithms, and to develop and operate
the swarm functions that QSH homes share.

### Data categories

1. **Thermal parameters** — learned heat loss coefficients, thermal mass, and solar gain
   factors for each zone, with the number of observations and the confidence of each value
   (zones identified by index, not by name)
2. **Building metadata** — total floor area (the sum of the room areas you entered), zone
   count, and emitter type and declared output per zone; the construction year and fabric
   class, if you entered them; the number of storeys, from the floor of each room; the
   outdoor temperature below which frost protection operates
3. **Heat sources** — for each heat source: its type, fuel type, declared thermal output,
   and the label it has in your QSH configuration
4. **Location** — the region you selected (e.g. "London"), or, for an installation outside
   the UK, the region you typed. Type the name of a region only: QSH sends that text as
   you typed it. If you choose a more detailed level, also the first part of your postcode
   (a postcode district, e.g. "SW1A") or the first part and the next digit (a postcode
   sector, e.g. "SW1A 1"). The default is the region only.
5. **Control performance** — optimisation blend factor, a combined comfort and efficiency
   score, the flow temperatures that QSH calculated, proposed and applied, the part of the
   day that QSH control was on, and confidence and controller-load indicators
6. **Energy metrics** — daily energy consumption (kWh) and heat output for each heat
   source, and the part of the heat output that is space heating; operating cycles,
   achieved coefficient of performance, normalised cost per degree-hour
7. **Operating state, about every 15 minutes** — outdoor temperature; the operating
   state of the heating system (hot-water heating and tariff pre-heating included) and its
   season mode; heat pump mode, power, flow and return temperatures, flow rate and
   coefficient of performance; whether QSH control is on; and for each zone the indoor
   temperature, the target temperature, the valve position and an estimate of the heat
   demand
8. **Events, when they occur** — a fast change in outdoor temperature; the heat pump
   turning on or off; a change of a zone's target temperature (the old and the new
   value); QSH control being turned on or off; alarms clearing; and controller health
   events. The swarm self-suspension function also sends health events. It is off unless
   it is turned on in the QSH configuration, and its events can hold the names of rooms.
9. **Equipment present** — yes or no for each of: outdoor sensor, solar, flow control,
   COP sensor, delta-T sensor, return temperature sensor, flow rate sensor, and an Octopus
   Energy integration
10. **Software and connection** — the QSH version, the time QSH last started, the number
    of messages waiting to be sent, the time and a random identifier of each message, the
    access key that your installation uses for the QSH server, and the group of similar
    homes that the QSH server put your installation in

Indoor temperatures, target temperatures, hot-water heating and the times of events can
indicate when a home is in use. QSH does not send the occupancy state of a room, a
schedule, or data from a presence sensor.

### What QSH does NOT collect

- Names, email addresses, or any account information
- Addresses, full postcodes, or GPS coordinates
- Room names (replaced with positional indices: room_0, room_1, ...), except in the
  events of the swarm self-suspension function (item 8)
- Occupancy schedules, occupancy states, or presence detection data
- Energy tariff rates, bills, account numbers or credentials
- Data from devices that QSH does not use to control the heating

Earlier versions of QSH sent the occupancy state of each room and, in some events, room
names. That data is kept as the rest is (see Storage and Retention), and it is deleted if
you ask (see Deletion).

When QSH connects to the QSH servers, the servers and their hosting provider see the IP
address of your internet connection, as every internet service does.

## How Data is Identified

Each installation is identified by a random installation ID, which QSH generates when
data sharing is turned on, and by a swarm unit ID that the QSH server gives the
installation when it first connects. QSH can generate a new installation ID when you save
the Data Sharing settings. A save of those settings does not change the swarm unit ID,
unless the installation registers again. Neither has any relationship to your name,
email, Home Assistant instance, or any other identifier. The QSH project cannot determine
who you are from these identifiers alone.

A postcode district or sector, together with the building metadata above, can be enough to
identify a home from public records such as the EPC register. It is personal data. If you
choose one of these levels, QSH holds it in the swarm registry against the swarm unit ID
of your installation. It is not part of the data packets QSH sends.

## Purpose

The collected data is used exclusively to:

- Validate and improve thermal parameter learning algorithms
- Measure control optimisation performance across different building types and climates
- Identify patterns that improve heating efficiency for all QSH users
- Develop and operate swarm functions, such as shared learning between similar homes and
  warnings of weather changes

The data is not sold and is not used for advertising. It is not shared with third
parties, with two exceptions that follow from how QSH works. The hosting provider
(Cloudflare) stores and processes the data for the QSH project. And when your
installation and another installation report the same untrained thermal parameters, the
QSH server can send to the other installation the parameter values that the two have in
common and, when the two are in the same group of similar homes, the swarm unit ID of
your installation. No other data of your installation is sent to other QSH homes.

## Storage and Retention

The data is stored on Cloudflare infrastructure operated by the QSH project. The
retention period is 3 years from the date of collection. The deletion of data older than
the retention period is not automatic yet, so at present data can stay for longer.
Retention is reviewed annually.

The location level and any postcode district or sector are stored in the swarm registry.
A change of level replaces the stored value. The retention period above does not apply to
the registry: after you turn data sharing off, it keeps the last value until you ask for
its deletion.

## Your Rights

**Opt out:** You can turn data sharing off at any time in Settings > Data Sharing. QSH
restarts and then sends nothing more to the QSH project. QSH continues to operate normally
with data sharing off.

**After you opt out:** Data that was sent before is kept as Storage and Retention says.
It is deleted earlier if you ask (see Deletion). The last location value in the swarm
registry is kept until you ask for its deletion.

**Lower the location level:** You can change the level at any time in Settings > Data
Sharing. QSH replaces the value in the swarm registry at its next connection.
Configuration snapshots and backups on your own machine that were made before the change
can still hold the earlier value. So can the history database of your installation, after
you revert to a snapshot.

**Deletion:** You may request deletion of all data associated with your installation, by
email to the contact address in this policy. Give the swarm unit ID that
Settings > Data Sharing shows. If the page shows no swarm unit ID, give the first eight
characters of the installation ID, which the details on the same page show as "Install
ID". If the page shows neither, say so in your request, and we will help you to identify
your installation. If you saved the Data Sharing settings after setup, say so: data that
was sent under an earlier installation ID is not found by the present one. Deletion will
be completed within 30 days.

**What a deletion keeps:** When we delete your data on your request, we keep the audit
record of the QSH server. It has a line for each message that your installation sent, and
for each registration, each change of your location level and each action of our operator
on your installation. Each line holds the swarm unit ID, the type of the action, the
result and the time. It holds no measurement, no location level and no postcode. We add
one line that records the deletion. We do not delete these lines: they have no time limit.

**Access:** You may request a copy of all data associated with your installation, in the
same way.

**Complaints:** You can complain to the UK Information Commissioner's Office (ico.org.uk)
about how your data is handled. If you are outside the UK, you can also complain to the
data protection authority of your country.

## Legal Basis (GDPR)

Processing is based on consent (Article 6(1)(a) GDPR), obtained through the setup wizard
or Settings > Data Sharing. Consent is freely given — you may decline or withdraw consent
at any time without affecting your ability to use QSH. The data collected is pseudonymous
— identified by random identifiers that are not linked to personal identity within the
telemetry system.

## Contact

For data requests or questions: quantum.swarm.heating@gmail.com (contact via email only)

## Changes

This policy may be updated. Changes will be noted in the CHANGELOG and will take effect
with the next QSH release.
