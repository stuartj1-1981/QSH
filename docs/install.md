# Installation Guide

## Home Assistant Add-on

### Prerequisites
- Home Assistant OS or Home Assistant Supervised
- Heat pump controllable via HA (native integration, Modbus, or custom component)
- Room temperature sensors as HA entities (one per zone)
- Outdoor temperature sensor as HA entity

### Steps

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**
2. Click the three-dot menu (top right) → **Repositories**
3. Add: `https://github.com/stuartj1-1981/QSH`
4. Find "Quantum Swarm Heating" in the store and click **Install**
5. Once installed, click **Start**, then open the **QSH** panel in the sidebar
6. Follow the setup wizard — it will scan your HA entities and guide you through room assignment, heat pump selection, and control preferences

### After Setup

QSH runs continuously in the background. The web dashboard (accessible from the HA sidebar) shows real-time status, room temperatures, and system performance. QSH begins learning your building's thermal characteristics immediately — optimisation improves over the first 2-4 weeks as observations accumulate.

---

## MQTT Standalone

### Prerequisites
- Docker host (Raspberry Pi 4/5, Intel NUC, server, NAS — any Linux with Docker)
- MQTT broker running and accessible (mosquitto, EMQX, HiveMQ, etc.)
- Room temperature sensors publishing to MQTT topics
- Heat pump controllable via MQTT (direct, Modbus-to-MQTT bridge, or zigbee2mqtt)
- Outdoor temperature sensor publishing to MQTT

### Steps

1. Create a directory for QSH config and data:
   ```bash
   mkdir -p ~/qsh/config ~/qsh/data
   ```

2. Download the compose file:
   ```bash
   curl -o ~/qsh/docker-compose.yml \
     https://raw.githubusercontent.com/stuartj1-1981/QSH/main/docker-compose.yml
   ```

3. Start QSH:
   ```bash
   cd ~/qsh && docker compose up -d
   ```

4. Open `http://<your-host-ip>:9100` in a browser

5. Follow the setup wizard:
   - Enter your MQTT broker address (hostname or IP) and port
   - Map your sensor topics to QSH inputs (room temperatures, outdoor temp, HP power)
   - Map your control topics (flow temperature setpoint, HP mode)
   - Assign rooms and set comfort targets

### Publishing contract

QSH is a cyclic engine: every 30 s it samples a complete process image from the MQTT cache and runs one control pass. Your install owns that image — QSH reads whatever is in the cache each cycle and does not reconstruct missing values. Three rules follow:

- **Publish retained.** Every topic QSH reads — sensors and control setpoints — should be published with `retain=true`, so QSH has the latest value on connect and after a broker or QSH restart.
- **Refresh at ≤ 30 s.** Any value that feeds the control scan should be republished at least once per cycle. A control setpoint not seen on a given cycle falls back to its internal default until the next message arrives.
- **Complete payloads, not deltas.** If you multiplex fields onto one topic (a JSON telemetry blob), every field QSH reads must be present in *every* message. Publishing sparse deltas — where a setpoint appears only when it changes — makes QSH read it as absent on the cycles it is missing, and the value flips between the published value and the internal default. Send the full object each publish, or give the setpoint its own retained topic.

Freshness tolerances are set by `mqtt.staleness_defaults` (per-category `fresh` / `unavailable` seconds); the shipped defaults suit 30 s telemetry. Slow, on-change sources such as the weather forecast and unit prices are handled separately — see their own references.

### Node-RED Users

If you use Node-RED, QSH connects to the same MQTT broker as your Node-RED instance. No special integration is needed — QSH subscribes to sensor topics and publishes control commands via MQTT. Your existing Node-RED flows continue to work alongside QSH.

---

## Restoring from Backup

If you are migrating from an existing QSH installation:

1. On your old installation, go to **Settings → Backup → Export**
2. Save the ZIP file
3. On the new installation, complete the setup wizard first
4. Go to **Settings → Backup → Restore** and upload the ZIP
5. Choose **Merge** to preserve the best learned parameters from both old and new

The merge mode keeps whichever data has more observations per room — your months of accumulated learning transfer to the new installation.
