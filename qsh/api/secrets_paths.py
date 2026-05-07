"""Canonical inventory of credential-bearing paths in qsh.yaml.

Single source of truth for the snapshot diff endpoint's `is_secret`
resolution (INSTRUCTION-192). The legacy energy-only redaction in
`qsh/api/routes/config.py::restore_redacted_energy` is NOT yet unified
with this list — that is a follow-on instruction. The list here is a
strict superset of `restore_redacted_energy`'s coverage.

Paths use dotted notation. Containment is on the dotted-path prefix:
a path matches when it equals a known secret path or has a known secret
path as a prefix. Example: `energy.electricity.octopus_api_key` matches;
`energy.electricity.octopus_api_key.subkey` would also match if that ever
existed.

Audit date: 7 May 2026 (INSTRUCTION-192 V4 Step 2.1).

Audit method:
1. Walked the wizard's section enumerations
   (`qsh/api/routes/wizard.py::validate_config` at line 703 and
   `qsh/api/routes/config.py::valid_sections` at line 285).
2. Cross-referenced with the existing redaction discipline at
   `qsh/api/routes/config.py::_redact_recursive` (keyword-based:
   key, secret, token, password) and `restore_redacted_energy`
   at `qsh/api/routes/config.py:235`.
3. Scanned `qsh/config.py`, `qsh/historian.py`, `qsh/telemetry.py`,
   `qsh/drivers/mqtt/client.py` for credential field references.

Audit dispositions:
- energy.electricity.octopus_api_key — INCLUDED. Octopus Energy REST API
  authentication key.
- energy.electricity.octopus_account_number — INCLUDED. Account-class
  identifier; redacted alongside API key in existing infrastructure.
- energy.gas.octopus_api_key — INCLUDED. Mirror of electricity for
  multi-fuel installs.
- energy.gas.octopus_account_number — INCLUDED. Mirror.
- energy.octopus.api_key — INCLUDED. Legacy single-key shape predating
  the per-fuel split (still supported as the source for the legacy
  bridge in restore_redacted_energy).
- energy.octopus.account_number — INCLUDED. Legacy shape.
- mqtt.password — INCLUDED. MQTT broker authentication password.
- mqtt.username — INCLUDED. MQTT username is credential-class in MQTT
  auth contexts (broker access control identifier; treating it as a
  credential aligns with the keyword-based redaction at config.py:521).
- historian.password — INCLUDED. InfluxDB v1 password (also v2 fallback
  if a password-class field is configured).
- historian.username — INCLUDED. InfluxDB username — credential-class
  by the same logic as mqtt.username.
- historian.token — INCLUDED. InfluxDB v2 token (forward-compatible
  field; not yet in the live schema but reserved here so future
  migrations don't drop the flag).
- telemetry.api_token — INCLUDED. Fleet-telemetry registration token.
  Persisted by qsh/telemetry.py::_persist_api_token.

Excluded (not credential-class):
- ha section credentials — HA addon supervisor manages access tokens via
  the SUPERVISOR_TOKEN env var, not through qsh.yaml. No HA-token field
  exists in the qsh.yaml schema today.
- account identifiers that are NOT authentication-class (e.g.,
  energy.octopus.zone_entity_id) — these are entity references, not
  credentials.
"""

from __future__ import annotations


SECRETS_PATHS: frozenset[str] = frozenset({
    # Energy — Octopus per-fuel (current shape)
    "energy.electricity.octopus_api_key",
    "energy.electricity.octopus_account_number",
    "energy.gas.octopus_api_key",
    "energy.gas.octopus_account_number",
    # Energy — Octopus single-key (legacy shape, still supported via the
    # legacy bridge in restore_redacted_energy).
    "energy.octopus.api_key",
    "energy.octopus.account_number",
    # MQTT broker auth
    "mqtt.username",
    "mqtt.password",
    # Historian (InfluxDB)
    "historian.username",
    "historian.password",
    "historian.token",
    # Fleet telemetry registration
    "telemetry.api_token",
})


def is_secret_path(path: str) -> bool:
    """Return True if `path` (dotted-path notation) is a known credential
    path or is contained within one.

    Containment is prefix-based: `path` matches when it equals a known
    secret or has a known secret as a strict dotted prefix. This covers
    structural changes to a credential's representation (e.g., turning a
    string into a sub-object) without requiring the canonical list to be
    updated.
    """
    for secret in SECRETS_PATHS:
        if path == secret or path.startswith(secret + "."):
            return True
    return False
