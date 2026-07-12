"""Tariff provider abstraction.

T-27 (GOVERNANCE-LEDGER Entry 020, 29 April 2026): External data services are
accessed through Protocol-bounded provider abstractions. Transport, parsing,
and product knowledge for an external service MUST live inside the provider
module — never in pipeline controllers, HTTP route handlers, or `utils`-style
modules.
"""

import logging
from dataclasses import dataclass
from typing import List, Literal, Protocol, Tuple, runtime_checkable

logger = logging.getLogger(__name__)

# V3 M8: Hard upper bound on every upstream HTTP call made by any provider.
# Provenance: INSTRUCTION-116 set REQUEST_TIMEOUT_SECONDS = 5 for HP control
# mutations. Same value, same review schedule.
TARIFF_HTTP_TIMEOUT_SECONDS = 5

Fuel = Literal["electricity", "gas", "lpg", "oil"]
ProviderKind = Literal[
    "octopus_electricity",
    "octopus_gas",
    "edf_freephase",
    "fixed",
    "fallback",
    "ha_entity",          # 158B
]

# V5 E-M1: backend capability flag. Frontend (150E) gates radio options on
# this list — NOT on whether a provider is currently configured. Each
# sub-instruction extends the tuple as concrete provider modules ship:
#   150A: ("fixed", "fallback")
#   150B: + "octopus_electricity"
#   150C: + "octopus_gas"
#   150D: + "edf_freephase"
#   158B: + "ha_entity"
SUPPORTED_PROVIDER_KINDS: tuple[ProviderKind, ...] = (
    "fixed",
    "fallback",
    "octopus_electricity",
    "octopus_gas",
    "edf_freephase",
    "ha_entity",          # 158B
)

# V4 NEW-V3-1: shared base for Octopus product-code prefixes. Declared at
# package root from 150A onwards because 150A owns the file's creation;
# 150B and 150C compose their fuel-specialised prefixes from this base.
#
#   150B uses: f"{_SILVER_PREFIX_BASE}-ELEC" → "SILVER-FLEX-ELEC"
#   150C uses: f"{_SILVER_PREFIX_BASE}-GAS"  → "SILVER-FLEX-GAS"
_SILVER_PREFIX_BASE: str = "SILVER-FLEX"


class ConfigurationError(Exception):
    """Raised when tariff configuration is structurally invalid (e.g. unknown
    provider_kind within a recognised fuel section). Distinct from a missing
    fuel section — that returns FallbackProvider per V3 L7."""


@dataclass(frozen=True)
class ProviderStatus:
    fuel: Fuel
    provider_kind: ProviderKind     # V3 L8: typed Literal, not raw str
    last_refresh_at: float | None   # unix timestamp; None if never refreshed
    stale: bool                     # true if last_refresh_at older than provider's stale-window
    last_price: float               # most recent £/kWh_input
    source_url: str | None          # for debugging; None for FixedRateProvider
    last_error: str | None          # most recent transport/parse error if any
    tariff_label: str | None        # V5 C-2: short human-readable display
                                    # ("Octopus Agile", "EDF FreePhase Green Band",
                                    #  "Fixed £0.30/kWh"). None pre-refresh or
                                    #  for FallbackProvider.


@dataclass(frozen=True)
class CredentialTestResult:
    success: bool
    message: str
    tariff_code: str | None = None
    additional_tariffs: list[str] | None = None
    export_tariff: str | None = None


@runtime_checkable
class TariffProvider(Protocol):
    """Source-agnostic tariff abstraction.

    Threading model (V5 C-4): providers are accessed exclusively from the
    pipeline thread. Concrete provider implementations MUST NOT use
    threading.Lock or any other concurrency primitive. The pipeline is
    single-threaded; coordination overhead would be dead weight.

    Contract:
      - refresh() MUST NOT raise. Network and parse failures are absorbed
        and surfaced via status().last_error. The throttle floor is
        ≥ 1/60s (V3 M1) — refresh() may be called every cycle but actual
        upstream traffic is rate-limited internally.
      - current_price() MUST always return a finite float. Cold-start (no
        successful refresh yet) returns 0.0 — CostController gates on
        ctx.input_power_kw < 0.01 (not on price), so 0.0 is safe.
      - test_credentials() (subtype only) MAY raise; HTTP-fronted callers
        translate exceptions into structured 4xx/5xx.
    """

    @property
    def fuel(self) -> Fuel: ...
    def current_price(self) -> float: ...
    def refresh(self) -> None: ...
    def status(self) -> ProviderStatus: ...

    # INSTRUCTION-392 — OPTIONAL method (NOT a Protocol member, so it does not
    # widen the @runtime_checkable structural contract that every provider must
    # satisfy): providers that can source a daily standing charge (Octopus
    # electricity/gas) expose
    #     def standing_charge_per_day(self) -> float   # £/day, 0.0 if unknown
    # Consumers MUST read it via a getattr guard defaulting to 0.0, so a provider
    # without the method is treated as "no standing charge known".

    # INSTRUCTION-136A V7 Task 4b: sibling addition for rate-curve consumers
    # (TariffOptimiserController). Sibling-addition only — no semantic change
    # to current_price() or any other 150-series Protocol method.
    def rates_for_window(
        self,
        start_ts: float,
        end_ts: float,
    ) -> List[Tuple[float, float, float]]:
        """Return the rate slots intersecting [start_ts, end_ts] as a continuous
        wall-clock window. Each tuple is (slot_start_ts, slot_end_ts, price_per_kwh).
        Empty list if no rate data available for the requested window.

        The returned list MAY span midnight (UK local time) — providers do not
        artificially truncate at day boundaries. Slots are returned in
        chronological order.

        This method exposes the rate cache the provider already maintains
        internally to back current_price(). It is NOT a fetch-on-demand call —
        no network IO is implied. If the provider has no cached data for the
        requested window, return an empty list.
        """
        ...


@runtime_checkable
class CredentialedProvider(TariffProvider, Protocol):
    """Subtype for providers that authenticate against an upstream API.
    Wizard credential-test endpoints route to this protocol."""

    def test_credentials(self) -> CredentialTestResult: ...


# Public registry of provider strings recognised by `_build_provider` for
# the electricity fuel. Single source of truth for provider validation:
# any new provider added to the branches in `_build_provider()` must be
# added here in lockstep, and vice versa. Imported by
# `qsh/api/routes/wizard.py:validate_config` for wizard-step validation
# (INSTRUCTION-188 Task 3 / V2 M-1 closure). T-30-aligned mirror --
# wizard validator and runtime factory share state without ongoing
# coordination overhead. The structural lockstep tests in
# `qsh/tariff/tests/test_factory.py` (constant <-> factory) and
# `qsh/api/tests/test_wizard_validate.py` (constant <-> wizard validator)
# fail if any of the three places drifts.
VALID_ELECTRICITY_PROVIDERS: tuple[str, ...] = (
    "octopus",
    "ha_entity",
    "fixed",
    "edf_freephase",
)


# INSTRUCTION-305: canonical "fixed-rate required" messages — the single
# source of truth for the wording emitted by the wizard validator
# (qsh/api/routes/wizard.py), the energy PATCH route
# (qsh/api/routes/config.py), and the runtime factory below. One place to
# change the rule. The electricity string is byte-identical to the inline
# message INSTRUCTION-188 placed in validate_config (preserved verbatim).
ELECTRICITY_FIXED_RATE_REQUIRED_MSG = (
    "energy.electricity.provider='fixed' requires "
    "energy.electricity.fixed_rate to be set"
)
GAS_FIXED_RATE_REQUIRED_MSG = (
    "energy.gas.provider='fixed' requires "
    "energy.gas.fixed_rate to be set"
)


# INSTRUCTION-411 R8: the new-shape credential keys required, per fuel, for a
# block to resolve to the Octopus provider. Single source of truth shared by
# `_normalise_legacy_config` (below — its legacy synthesis gate derives from
# this), by the migration's D7 resolution-preserving declaration, and by
# `_legacy_still_consumed` in qsh/api/routes/config.py. The cross-module
# lockstep test asserts the config.py forward map agrees with this constant.
#
# These mirror `_normalise_legacy_config`'s legacy synthesis gates exactly:
#   electricity legacy `api_key ∧ account_number`  → octopus_api_key ∧ octopus_account_number
#   gas         legacy `api_key ∧ gas_tariff_code` → octopus_api_key ∧ octopus_tariff_code
OCTOPUS_REQUIRED_CREDENTIALS: dict[Fuel, tuple[str, ...]] = {
    "electricity": ("octopus_api_key", "octopus_account_number"),
    "gas": ("octopus_api_key", "octopus_tariff_code"),
}


def _fixed_rate_missing(value) -> bool:
    """True when a fixed_rate is absent or unusable: None, or an empty/blank
    string. The single definition of 'missing fixed_rate' shared by the
    validator and the runtime factory, so the two cannot diverge (a blank
    string must be rejected at the factory before it reaches float("") in
    FixedRateProvider)."""
    return value is None or (isinstance(value, str) and not value.strip())


def validate_energy_fixed_rate(energy: dict) -> list[str]:
    """Return error strings for any electricity/gas section whose provider is
    'fixed' but whose fixed_rate is missing per _fixed_rate_missing (None or
    empty/blank string). Empty list = no fixed-rate problem. Does not validate
    lpg/oil — the runtime factory defaults those to 0.0 by design."""
    errors: list[str] = []
    for fuel, msg in (
        ("electricity", ELECTRICITY_FIXED_RATE_REQUIRED_MSG),
        ("gas", GAS_FIXED_RATE_REQUIRED_MSG),
    ):
        section = energy.get(fuel) if isinstance(energy, dict) else None
        if isinstance(section, dict) and section.get("provider") == "fixed":
            if _fixed_rate_missing(section.get("fixed_rate")):
                errors.append(msg)
    return errors


def fuel_for_source(source_type: str) -> Fuel:
    """Map heat_source type to fuel. Single source of truth for the mapping.
    Raises KeyError for unrecognised source types — caller must have already
    validated against VALID_HEAT_SOURCE_TYPES in qsh/config.py."""
    return {
        "heat_pump": "electricity",
        "gas_boiler": "gas",
        "lpg_boiler": "lpg",
        "oil_boiler": "oil",
    }[source_type]


# Module-level imports for factory paths (V2 A-L1).
# 150B: _LegacyOctopusElectricityProvider deleted; OctopusElectricityProvider
# is imported lazily inside _build_provider to avoid a circular import.
# 150C: _LegacyBoilerProvider deleted; OctopusGasProvider is imported
# lazily for the same reason.
from qsh.tariff.fixed import FixedRateProvider  # noqa: E402
from qsh.tariff.fallback import FallbackProvider  # noqa: E402

# INSTRUCTION-411 D5/D6: a built Octopus provider that will silently degrade to
# its fallback rate (api_key present but tariff_code missing — the REST refresh
# gate is unsatisfiable) is a LATCHED in-fault condition, annunciated once and
# aggregated from create_tariff_providers. The EventSpec is registered at module
# scope so it is import-guaranteed before any factory call; re-registration of
# the identical spec is idempotent (a suite that drops the annunciator singleton
# via reset_for_testing() is defended by the re-register in the raise site).
from qsh.events import EventKind, EventSpec, get_annunciator  # noqa: E402

_OCTOPUS_CREDS_INCOMPLETE_SPEC = EventSpec(
    name="TARIFF.octopus_credentials_incomplete",
    kind=EventKind.LATCHED,
    payload_fields=(),
    latch_key=(),
    default_level=logging.WARNING,
)
get_annunciator().register(_OCTOPUS_CREDS_INCOMPLETE_SPEC)


def _normalise_legacy_config(energy_config: dict, fuel: Fuel) -> dict | None:
    """V2 L3 read-side compatibility.

    First try the new shape: energy.<fuel>.provider.
    If absent, synthesise an equivalent dict from the legacy keys.
    Returns None if neither shape has any keys at all (caller returns
    FallbackProvider per V3 L7).
    """
    new_section = energy_config.get(fuel)
    if isinstance(new_section, dict) and "provider" in new_section:
        return new_section

    # Legacy electricity: full-Octopus credentials win first.
    if fuel == "electricity":
        legacy_octopus = energy_config.get("octopus", {})
        api_key = legacy_octopus.get("api_key")
        account_number = legacy_octopus.get("account_number")
        # INSTRUCTION-411 R8: gate derives from OCTOPUS_REQUIRED_CREDENTIALS so
        # the synthesis rule, the migration's D7 declaration, and the strip's
        # consumer gate cannot drift. Behaviour is identical to the prior
        # `if api_key and account_number:` check.
        candidate = {
            "provider": "octopus",
            "octopus_api_key": api_key,
            "octopus_account_number": account_number,
            "octopus_tariff_code": legacy_octopus.get("electricity_tariff_code"),
        }
        if all(candidate.get(k) for k in OCTOPUS_REQUIRED_CREDENTIALS["electricity"]):
            return candidate
        # 158B V2 (Finding 6): partial-credentials warn-and-route. A user
        # with only api_key OR only account_number cannot construct the
        # OctopusElectricityProvider. Silent reroute to ha_entity is a
        # process-control anti-pattern (no operator signal of the degraded
        # state). Emit an explicit warning identifying which credential is
        # missing, then let the ha_entity branch below handle them iff
        # rates.current_day is also present. If no rates entity is
        # configured either, the outer logic returns FallbackProvider —
        # which is the correct degraded state for "credentials half-set,
        # no fallback path."
        if (api_key or account_number) and not (api_key and account_number):
            import logging
            logging.warning(
                "energy.octopus has partial credentials — api_key=%s, "
                "account_number=%s. Cannot construct "
                "OctopusElectricityProvider. Falling through to legacy "
                "HA-entity auto-detection.",
                "set" if api_key else "MISSING",
                "set" if account_number else "MISSING",
            )
        # 158B Task 4: HA-brokered legacy. The user has the Octopus Energy
        # HACS integration set up and `energy.octopus.rates.current_day`
        # points at the integration's rate event/sensor. They have no
        # QSH-side API credentials and never did (or had partial — see
        # warn-and-route block above). Synthesise an ha_entity provider
        # config so existing installs upgrade silently.
        legacy_rates = legacy_octopus.get("rates", {})
        if isinstance(legacy_rates, dict) and legacy_rates.get("current_day"):
            return {
                "provider": "ha_entity",
                "rates_entity": legacy_rates["current_day"],
            }

    # Legacy gas: energy.octopus credentials + tariff.gas_price for fixed
    if fuel == "gas":
        legacy_octopus = energy_config.get("octopus", {})
        legacy_tariff = energy_config.get("tariff", {})
        # INSTRUCTION-411 R8: gate derives from OCTOPUS_REQUIRED_CREDENTIALS
        # (octopus_api_key ∧ octopus_tariff_code). Behaviour is identical to the
        # prior `if api_key and gas_tariff_code:` check.
        candidate = {
            "provider": "octopus",
            "octopus_api_key": legacy_octopus.get("api_key"),
            "octopus_account_number": legacy_octopus.get("account_number"),
            "octopus_tariff_code": legacy_octopus.get("gas_tariff_code"),
        }
        if all(candidate.get(k) for k in OCTOPUS_REQUIRED_CREDENTIALS["gas"]):
            return candidate
        if "gas_price" in legacy_tariff:
            return {"provider": "fixed", "fixed_rate": legacy_tariff["gas_price"]}

    # Legacy LPG / oil: tariff.lpg_price / tariff.oil_price
    if fuel in ("lpg", "oil"):
        legacy_tariff = energy_config.get("tariff", {})
        key = f"{fuel}_price"
        if key in legacy_tariff:
            return {"provider": "fixed", "fixed_rate": legacy_tariff[key]}

    return None


def create_tariff_providers(
    heat_sources: list[dict],
    energy_config: dict,
) -> dict[Fuel, TariffProvider]:
    """Construct one provider per fuel actually in use.

    Multi-fuel installs (HP + boiler hybrid, boiler + immersion) get one
    provider per fuel. EnergyController picks the active provider each cycle
    from `ctx.active_source_type` via `fuel_for_source()`. Both providers
    always remain in the snapshot for parallel display.

    `heat_sources` is a list of dict entries (qsh/config.py shape) each with
    at least a `type` key.
    """
    fuels_in_use: set[Fuel] = {fuel_for_source(hs["type"]) for hs in heat_sources}
    providers = {fuel: _build_provider(fuel, energy_config) for fuel in fuels_in_use}
    _annunciate_degraded_octopus_credentials(providers)
    return providers


def _annunciate_degraded_octopus_credentials(
    providers: dict[Fuel, TariffProvider],
) -> None:
    """INSTRUCTION-411 D5/D6: raise a single aggregated LATCHED alarm naming
    every fuel whose built Octopus provider will silently degrade to its
    fallback rate (`credentials_degraded()` — api_key set, tariff_code missing).

    Provider-sourced (M1/M2/R2): reads each built provider's own credential view,
    so a declared block that resolves its credentials from the legacy
    energy.octopus.* section (OctopusGasProvider merges legacy) does NOT
    false-fire. The falling edge (all providers healthy) clears the latch.

    Defensively re-registers the spec — a full-suite run may have dropped the
    annunciator singleton via reset_for_testing(); register() is idempotent."""
    ann = get_annunciator()
    ann.register(_OCTOPUS_CREDS_INCOMPLETE_SPEC)
    degraded = sorted(
        fuel
        for fuel, provider in providers.items()
        if callable(getattr(provider, "credentials_degraded", None))
        and provider.credentials_degraded()
    )
    if degraded:
        logger.warning(
            "Octopus credentials incomplete for fuel(s) %s — api_key set but "
            "tariff_code missing; the provider will use the fallback rate until "
            "the tariff code is set (run wizard Test Connection).",
            ", ".join(degraded),
        )
        ann.entered("TARIFF.octopus_credentials_incomplete")
    else:
        ann.exited("TARIFF.octopus_credentials_incomplete")


def create_export_provider(
    energy_config: dict,
    config_entities: dict | None = None,
) -> "TariffProvider | None":
    """INSTRUCTION-410 — construct a DEDICATED export/outgoing electricity
    provider, reusing OctopusElectricityProvider unchanged (D1). Returns None
    when no export tariff code AND no export rate entity is configured.

    The export provider is NOT registered in the `create_tariff_providers`
    Fuel-keyed dict (D6): that dict is iterated whole by the per-fuel status
    snapshot and must stay `Fuel`-typed. It is passed to EnergyController as a
    dedicated `export_provider` and read explicitly to author ctx.export_rate.

    Construction mirrors import: the shared Octopus credentials come from the
    electricity section (new-shape, legacy `energy.octopus` fallback), the
    tariff code from the wizard-persisted `energy.electricity.
    octopus_export_tariff_code`, the HA rate entity from the RESOLVED entity_id
    value `config_entities["current_day_export_rates"]` (M2 — the value, not the
    map key), and the cold-start fallback from the operator-set static export
    rate (`energy.fixed_rates.export_rate` | `energy.fallback_rates.export`).
    """
    config_entities = config_entities or {}
    elec = energy_config.get("electricity")
    if not isinstance(elec, dict):
        elec = {}

    # INSTRUCTION-410 N4 — read ONLY the new-shape persisted key. There is no
    # legacy `energy.octopus.export_tariff_code` writer anywhere (grep-empty), so
    # a legacy read-fallback would be a dead branch that misleads future readers.
    export_code = elec.get("octopus_export_tariff_code")
    export_entity = config_entities.get("current_day_export_rates")
    if not export_code and not export_entity:
        return None

    legacy = energy_config.get("octopus")
    legacy = legacy if isinstance(legacy, dict) else {}
    api_key = elec.get("octopus_api_key") or legacy.get("api_key")
    account_number = elec.get("octopus_account_number") or legacy.get("account_number")

    fixed_rates = energy_config.get("fixed_rates") or {}
    fallback_rates = energy_config.get("fallback_rates") or {}
    static_export = fixed_rates.get("export_rate")
    if static_export is None:
        static_export = fallback_rates.get("export", 0.0)
    try:
        static_export = float(static_export)
    except (TypeError, ValueError):
        static_export = 0.0

    # The provider reads its config from the "electricity" key of the dict it is
    # given (OctopusElectricityProvider._read_section); feeding it an
    # export-directed section yields an export instance with zero class edit.
    export_section = {
        "electricity": {
            "provider": "octopus",
            "octopus_api_key": api_key,
            "octopus_account_number": account_number,
            "octopus_tariff_code": export_code,
            "ha_rate_entity": export_entity,
            "fallback_rate": static_export,
        }
    }
    from qsh.tariff.octopus_electricity import OctopusElectricityProvider
    return OctopusElectricityProvider(export_section)


def _build_provider(fuel: Fuel, energy_config: dict) -> TariffProvider:
    fuel_section = _normalise_legacy_config(energy_config, fuel)
    if fuel_section is None:
        # V3 L7: ONLY path that returns FallbackProvider. Typo'd provider_kind
        # within a recognised fuel section raises rather than silently falling
        # through.
        return FallbackProvider(fuel)

    provider_kind = fuel_section.get("provider")

    if fuel == "electricity":
        if provider_kind == "octopus":
            # Local import: avoids circular imports between qsh.tariff and
            # qsh.tariff.octopus_electricity (the provider module imports
            # types from this package root).
            from qsh.tariff.octopus_electricity import OctopusElectricityProvider
            return OctopusElectricityProvider(energy_config)
        if provider_kind == "edf_freephase":
            from qsh.tariff.edf_freephase import EDFFreephaseProvider
            return EDFFreephaseProvider(energy_config)
        if provider_kind == "ha_entity":
            from qsh.tariff.ha_entity import HAEntityProvider
            rates_entity = fuel_section.get("rates_entity")
            if not rates_entity:
                raise ConfigurationError(
                    "energy.electricity.provider=ha_entity requires "
                    "energy.electricity.rates_entity to be set"
                )
            # 159B Task 3: optional dual-entity slot for next-day rates.
            # The legacy synthesis path in _normalise_legacy_config does not
            # populate this key, which produces None — the correct
            # backwards-compatible behaviour for unmigrated installs.
            rates_entity_next = fuel_section.get("rates_entity_next")
            # 158B V2 (Finding 5): inject the user-configured fallback so
            # cold-start current_price() returns a sensible value rather
            # than 0.0. Single source of truth for the cold-start fallback
            # is energy.fallback_rates.standard — same value the rest of
            # the system uses when live rates are unavailable.
            fallback_rate = float(
                energy_config.get("fallback_rates", {}).get("standard", 0.0)
            )
            return HAEntityProvider(
                fuel="electricity",
                rates_entity=rates_entity,
                rates_entity_next=rates_entity_next,
                fallback_rate=fallback_rate,
            )
        if provider_kind == "fixed":
            # INSTRUCTION-305: guarded read using the same _fixed_rate_missing
            # predicate as validate_energy_fixed_rate, so a hand-edited
            # fixed_rate: "" (blank) raises the canonical ConfigurationError
            # here rather than a cryptic KeyError (absent key) or ValueError
            # (float("") in FixedRateProvider). Mirrors the ha_entity guard.
            fixed_rate = fuel_section.get("fixed_rate")
            if _fixed_rate_missing(fixed_rate):
                raise ConfigurationError(ELECTRICITY_FIXED_RATE_REQUIRED_MSG)
            return FixedRateProvider(fuel, value=fixed_rate)

    if fuel == "gas":
        if provider_kind == "octopus":
            # Local import: avoids circular imports between qsh.tariff and
            # qsh.tariff.octopus_gas (the provider module imports types
            # from this package root).
            from qsh.tariff.octopus_gas import OctopusGasProvider
            return OctopusGasProvider(energy_config)
        if provider_kind == "fixed":
            # INSTRUCTION-305: same guard as the electricity fixed branch.
            fixed_rate = fuel_section.get("fixed_rate")
            if _fixed_rate_missing(fixed_rate):
                raise ConfigurationError(GAS_FIXED_RATE_REQUIRED_MSG)
            return FixedRateProvider(fuel, value=fixed_rate)

    if fuel in ("lpg", "oil"):
        if provider_kind in (None, "fixed"):
            return FixedRateProvider(fuel, value=fuel_section.get("fixed_rate", 0.0))

    raise ConfigurationError(
        f"Unknown provider '{provider_kind}' for fuel '{fuel}'. "
        f"Valid: octopus, fixed (and edf_freephase for electricity)."
    )


__all__ = [
    "Fuel",
    "ProviderKind",
    "ProviderStatus",
    "CredentialTestResult",
    "TariffProvider",
    "CredentialedProvider",
    "ConfigurationError",
    "TARIFF_HTTP_TIMEOUT_SECONDS",
    "SUPPORTED_PROVIDER_KINDS",
    "VALID_ELECTRICITY_PROVIDERS",
    "ELECTRICITY_FIXED_RATE_REQUIRED_MSG",
    "GAS_FIXED_RATE_REQUIRED_MSG",
    "OCTOPUS_REQUIRED_CREDENTIALS",
    "validate_energy_fixed_rate",
    "fuel_for_source",
    "create_tariff_providers",
    "create_export_provider",
    "FixedRateProvider",
    "FallbackProvider",
]
