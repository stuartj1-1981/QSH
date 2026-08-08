# QSH — Quantum Swarm Heating

Adaptive heat source agnostic optimisation for multi-zone residential heating. Learns your building's thermal characteristics from passive observation and optimises flow temperature, zone control, and scheduling to reduce energy consumption.

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

Designed for any heat source that exposes flow temperature setpoint and on/off control — either via Home Assistant entities or MQTT topics.

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

## Research & Publications

The methods behind QSH are documented in a four-part preprint series (Stuart J. Hunt, 2026 — all open access — CC BY 4.0 — archived on Zenodo; PDFs mirrored in [`docs/publications/`](docs/publications/)):

- **Physics-Based Thermal Optimisation for Residential Heat Pumps: Fleet Simulation, Weather Compensation Analysis, and the Shoulder Mode Discovery** (Mar 2026) — 348,170-run fleet simulation, weather-compensation analysis, and the shoulder-mode discovery. [doi:10.5281/zenodo.18903154](https://doi.org/10.5281/zenodo.18903154)
- **Air-Gapped AI Development Pipeline** (Mar 2026) — the GAMP-inspired, multi-station governance regime under which QSH is engineered: structurally separated authoring, independent review, deployment, and validation. [doi:10.5281/zenodo.19323404](https://doi.org/10.5281/zenodo.19323404)
- **Domain-Expert AI Collaboration: Crossing the Paradigm Boundary from Industrial Control to Application Software** (Apr 2026) — engineering judgement as the scarce resource in AI-assisted development. [doi:10.5281/zenodo.19382919](https://doi.org/10.5281/zenodo.19382919)
- **DFAN: Distributed Fractal Awareness Network — A Biomimetic Control Architecture for Intelligent Energy Transfer Systems** (Apr 2026) — the design philosophy: QSH as the first deployment of a general energy-transfer architecture. [doi:10.5281/zenodo.19443158](https://doi.org/10.5281/zenodo.19443158) (v2, Aug 2026 — reference list corrected)

**Synthesis (Jul 2026):**

- **Two Loops, One V-Model: Composing Process Governance and Formal Product Verification for Assurance of AI-Generated Software** (Jul 2026) — the synthesis of the strands above: how a process-assurance regime and formal product verification compose into a single V-model for AI-generated software. The QSH governance ledger is included as a worked existence proof, with the supporting data artefacts deposited alongside. [doi:10.5281/zenodo.21556620](https://doi.org/10.5281/zenodo.21556620)

### Correction notice

**Physics-Based Thermal Optimisation** (Mar 2026) contains errors in its reference list, identified in an audit on 7 August 2026. Three entries do not correspond to real publications and one describes a real standard inaccurately:

- **[6]** Jack, Sunikka-Blank & Lowe, *Energy and Buildings* 258, 111846 — no such paper. That volume and article number belong to unrelated work.
- **[7]** Mozer, *"The intelligent home"*, ISMB 1994 — incorrect. The intended reference is Mozer, M.C., *"The Neural Network House: An Environment that Adapts to its Inhabitants"*, AAAI Spring Symposium on Intelligent Environments, 1998.
- **[9]** Vetterli, Sulzer & Jauslin, *Energy and Buildings* 294, 113228 — no such paper.
- **[15]** MCS 020 is the planning standard for permitted development installations, not a heat pump systems standard.

**The simulation data, physics engine, archetype profiles, live validation measurements, results and conclusions are unaffected.** The errors are confined to the bibliography. The claim in §2.2 attributing support to references [3] and [6] is withdrawn pending re-grounding; the weather-compensation quantification reported in the paper is original to this work and does not depend on it.

The full notice is attached to the Zenodo record: [doi:10.5281/zenodo.18903286](https://doi.org/10.5281/zenodo.18903286)

**DFAN** contained one fabricated reference (Chen & Shi, *Applied Energy* 84(11), 2007) and one that could not be verified. Both are corrected in **v2**, which is the version linked above and mirrored here.

Both bibliographies were assembled with AI literature-search assistance and were not independently resolved to primary sources before deposit. Every citation is now resolved to a primary source before deposit — each DOI resolved and its returned title and authors compared against the citation as written, and each standard retrieved and its issuing body confirmed. The fabricated entries carried real journal, volume and article-number coordinates attached to fabricated author and title pairs, which makes them undetectable by reading and trivially detectable by resolution.

Citation metadata for this repository: [`CITATION.cff`](CITATION.cff).

## Licence

AGPLv3. See [LICENSE](LICENSE).

Core optimisation modules are distributed as compiled binaries. Frontend source is included under AGPLv3.
