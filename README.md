# QSH — Quantum Swarm Heating

Adaptive heat pump optimisation for multi-zone residential heating. Learns your building's thermal characteristics from passive observation and optimises flow temperature, zone control, and scheduling to reduce energy consumption.

## What It Does

- Per-room thermal parameter learning (heat loss, thermal mass) from passive observation
- Weather-compensated flow temperature optimisation
- Multi-zone valve and TRV control
- Reinforcement learning layer for continuous improvement
- Web dashboard with real-time monitoring

## Supported Setups

| Setup | Requirements |
|---|---|
| **Home Assistant Add-on** | Home Assistant OS or Supervised. Heat pump and room sensors as HA entities. |
| **MQTT Standalone** | Any MQTT broker (mosquitto, etc.). Sensors and HP control via MQTT topics. Docker host (Pi, NUC, server). |

Designed for any heat source that exposes flow temperature setpoint and on/off control — either via Home Assistant entities or MQTT topics. Currently validated on Octopus Cosy 6 (via GraphQL). 

## Quick Start

See [Installation Guide](docs/install.md) for step-by-step instructions.

### Home Assistant Add-on

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fstuartj1-1981%2FQSH)

1. Add this repository URL to your HA add-on store
2. Install "Quantum Swarm Heating"
3. Open the QSH panel and run the setup wizard

### MQTT Standalone

1. Ensure your MQTT broker is running and your sensors are publishing
2. Run the QSH container:
   ```bash
   docker compose up -d
   ```
3. Open `http://<host>:9100` and run the setup wizard
4. The wizard will ask for your MQTT broker address and guide you through topic mapping

## Documentation

- [Installation Guide](docs/install.md)
- [Privacy Policy](docs/privacy.md)
- [Changelog](CHANGELOG.md)

## Licence

AGPLv3. See [LICENSE](LICENSE).

Core optimisation modules are distributed as compiled binaries. Frontend source is included under AGPLv3.
