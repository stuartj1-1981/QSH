# MQTT Forecast Publisher Reference

Operator-facing reference for publishing weather forecast data to QSH
running with the MQTT driver. QSH does NOT publish forecast data —
operators are responsible for sourcing forecasts (Home Assistant
weather integration, Met Office Datahub, OpenWeatherMap, etc.) and
relaying them as retained MQTT messages on the agreed topic.

This document defines the wire format. Anything that produces a
conformant retained-message payload on the configured topic will work.

## Update cadence and freshness

QSH is a cyclic engine: every 30 s it samples a complete process image
from the MQTT cache and runs one control pass. Topics that feed the
control scan — setpoints and live telemetry — should refresh at **≤ 30 s**,
and their freshness is governed by the per-category `mqtt.staleness_defaults`.
The `default` category is:

```yaml
mqtt:
  staleness_defaults:
    default:
      fresh: 90         # s — within this the value is current
      unavailable: 300  # s — past this the value is treated as lost
```

Between the two thresholds the value is stale but still used
(last-known-good); past `unavailable` it is dropped. Categories other than
`default` (temperature, outdoor, price, …) ship with much wider windows for
sources that legitimately cannot report every 30 s.

**Forecast is a deliberate exception to both rules.** It is slow-cadence,
on-change data, not per-scan telemetry: publish it **retained** every
15–30 min and QSH reads the last retained value from cache on each cycle.
Forecast is *excluded* from `staleness_defaults` — routing a 20-minute topic
through the 90/300 `default` category would flag a perfectly healthy forecast
"unavailable" a few minutes after every publish. Forecast freshness is instead
tracked by its own failure counter; see Failure handling, below.

## QSH-side configuration

In `qsh.yaml`:

```yaml
mqtt:
  broker: localhost
  port: 1883
  topic_prefix: qsh    # whatever your install uses
  inputs:
    forecast:
      topic: weather/forecast   # the topic suffix; prefix is applied automatically
```

QSH subscribes to `{topic_prefix}/{inputs.forecast.topic}` at startup.
With the example above the fully-qualified topic is
`qsh/weather/forecast`. Subscription is QoS 0 (same as other input
topics); publishers MUST publish with **Retain=True** so QSH sees the
latest forecast immediately on connect and after broker restarts.

If `mqtt.inputs.forecast.topic` is absent from `qsh.yaml`, QSH does NOT
subscribe and the forecast provider returns `NullForecastProvider` (no
forecast capability advertised).

On the first successful payload receipt after startup, QSH emits a
one-shot `FORECAST.first_payload_summary` event (via EventAnnunciator)
reporting topic, entry count, interval, and time range. If
`forecast_extension_master_enable: true` is set but no forecast topic is
configured, QSH logs a WARNING at startup naming the missing key.

## Topic conventions

| Property | Value | Notes |
|---|---|---|
| Topic suffix | configurable (`mqtt.inputs.forecast.topic`) | typical: `weather/forecast` |
| Full topic | `{topic_prefix}/{suffix}` | prefix from `mqtt.topic_prefix` |
| QoS | 1 (publisher), 0 (subscriber) | retained delivery makes QoS 0 acceptable on the subscriber side |
| Retain | **True** (mandatory) | QSH reads via cache snapshot; non-retained messages are dropped if the broker disconnects |
| Refresh cadence | every 15–30 minutes recommended | provider re-evaluates each pipeline cycle (30 s); the cache is the freshness limit |
| Encoding | UTF-8 JSON | root MUST be a JSON object |

## Payload schema

The payload is a JSON object compatible with Home Assistant's
`weather.get_forecasts` service response shape. A minimal example:

```json
{
  "forecast": [
    {
      "datetime": "2026-05-13T10:00:00+00:00",
      "temperature": 12.4,
      "condition": "cloudy",
      "wind_speed": 8.2,
      "precipitation_probability": 20
    },
    {
      "datetime": "2026-05-13T11:00:00+00:00",
      "temperature": 13.1,
      "condition": "partly_cloudy",
      "wind_speed": 9.1,
      "precipitation_probability": 10
    }
  ],
  "source": "met_office_datahub"
}
```

### Required fields

| Field | Type | Notes |
|---|---|---|
| `forecast` | JSON array | non-empty; each entry is a forecast point |
| `forecast[].datetime` | ISO 8601 string | timezone-aware preferred (`+00:00` or explicit offset) |
| `forecast[].temperature` | number (°C) | dry-bulb air temperature |

### Optional fields

| Field | Type | Notes |
|---|---|---|
| `source` | string | provider attribution (e.g. `met_office_datahub`, `openweathermap`) |
| `forecast[].templow` | number (°C) | daily-summary low; populated for daily entries |
| `forecast[].condition` | string | HA weather condition (`sunny`, `partly_cloudy`, `cloudy`, `rainy`, …) |
| `forecast[].wind_speed` | number | unit per `wind_speed_unit` if provided, else km/h by convention |
| `forecast[].wind_speed_unit` | string | `km/h`, `m/s`, `mph` |
| `forecast[].wind_bearing` | number (degrees) | 0 = N, 90 = E, etc. |
| `forecast[].cloud_coverage` | number (%) | 0–100 |
| `forecast[].precipitation_probability` | number (%) | 0–100 |
| `forecast[].uv_index` | number | UV index |

Unknown fields are passed through to consumers untouched. Adding
provider-specific fields is harmless.

### Failure handling

QSH treats the following as "no forecast available" (FailureTracker
records a failure):

- Topic absent from the cache (no retained message ever received).
- Payload is not valid JSON.
- Root payload is not a JSON object.
- `forecast` key absent, empty, or not a list.
- Cache entry shape unexpected (defence-in-depth; should not happen).

After 3 consecutive failed `fetch_bundle()` calls the WARN line
`Weather forecast unavailable: <full_topic>` emits exactly once.
On the next successful payload the INFO line
`Weather forecast restored: <full_topic>` emits exactly once.

## Publisher reference sketches

These are **non-normative** — anything that produces a conformant
retained payload works. Use them as starting points.

### Home Assistant automation (YAML)

Publishes the HA weather entity forecast to MQTT every 20 minutes:

```yaml
automation:
  - alias: "Publish weather forecast to QSH"
    trigger:
      - platform: time_pattern
        minutes: "/20"
      - platform: homeassistant
        event: start
    action:
      - service: weather.get_forecasts
        target:
          entity_id: weather.home
        data:
          type: hourly
        response_variable: hourly_response
      - service: mqtt.publish
        data:
          topic: qsh/weather/forecast
          retain: true
          qos: 1
          payload: >-
            {{ {
              "forecast": hourly_response['weather.home']['forecast'],
              "source": "home_assistant"
            } | to_json }}
```

### Standalone Python (paho-mqtt + requests)

```python
import json
import time
import requests
import paho.mqtt.client as mqtt

BROKER = "localhost"
PORT = 1883
TOPIC = "qsh/weather/forecast"
DATAHUB_URL = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly"

def fetch_forecast() -> dict:
    # ... operator's own logic to fetch + transform into the QSH schema
    # Return a dict with at minimum {"forecast": [...]}.
    return {"forecast": [], "source": "met_office_datahub"}

def main():
    client = mqtt.Client()
    client.connect(BROKER, PORT, 60)
    client.loop_start()
    while True:
        try:
            payload = fetch_forecast()
            if payload.get("forecast"):
                client.publish(
                    TOPIC,
                    payload=json.dumps(payload),
                    qos=1,
                    retain=True,
                )
        except Exception as exc:
            print(f"publish failed: {exc}")
        time.sleep(1200)  # 20 minutes

if __name__ == "__main__":
    main()
```

### NodeRED

Use an `inject` node on a 20-minute interval to trigger an `http
request` against your provider, a `function` node to transform into
the QSH schema, and an `mqtt out` node with `retain=true` and `qos=1`
publishing to the configured topic.

## Troubleshooting

### Verify the broker is receiving retained messages

```bash
mosquitto_sub -h <broker> -t qsh/weather/forecast -v
```

On connect you should see the most recent retained payload immediately.
If nothing arrives, the publisher is not publishing with retain=True
or the payload is being rejected by ACLs.

### Verify QSH is reading the cache

In QSH logs after startup, look for:

```
MQTT forecast: subscribing to qsh/weather/forecast (configured via mqtt.inputs.forecast.topic)
MQTT forecast: configured (qsh/weather/forecast) [MQTTForecastProvider instance ...]
```

The "configured" line emits once at provider construction. On the first
cycle after a payload is received you should see the one-shot event:

```
EVENT key=FORECAST.first_payload_summary action=occurred topic=qsh/weather/forecast entries=N interval_seconds=S ...
```

If the "configured" line appears but the `FORECAST.first_payload_summary`
line does not within ~90 s, the broker has no retained payload on the
topic — check the broker (see above) and any TLS or ACL settings.

The `Weather forecast restored:` line only fires on recovery from a
failure state, not on first boot. Its absence on a clean boot is normal.

If `forecast_extension_master_enable: true` is set but no forecast topic
is configured, QSH logs a WARNING at startup:

```
Forecast commissioning interlock: forecast_extension_master_enable is True but the MQTTDriver returned NullForecastProvider ...
```

Set `mqtt.inputs.forecast.topic` as shown above and restart.

### Verify the schema

Publish a single test payload manually:

```bash
mosquitto_pub -h <broker> -t qsh/weather/forecast -r -q 1 -m '{
  "forecast": [{"datetime": "2026-05-13T10:00:00+00:00", "temperature": 12.0}]
}'
```

QSH should emit the `FORECAST.first_payload_summary` event within one
cycle (30 s).
