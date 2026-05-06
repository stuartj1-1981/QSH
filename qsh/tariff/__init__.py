"""Tariff provider abstraction.

T-27 (GOVERNANCE-LEDGER Entry 020, 29 April 2026): External data services are
accessed through Protocol-bounded provider abstractions. Transport, parsing,
and product knowledge for an external service MUST live inside the provider
module — never in pipeline controllers, HTTP route handlers, or `utils`-style
modules.
"""

from dataclasses import dataclass
from typing import List, Literal, Protocol, Tuple, runtime_checkable

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
        if api_key and account_number:
            return {
                "provider": "octopus",
                "octopus_api_key": api_key,
                "octopus_account_number": account_number,
                "octopus_tariff_code": legacy_octopus.get("electricity_tariff_code"),
            }
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
        if legacy_octopus.get("api_key") and legacy_octopus.get("gas_tariff_code"):
            return {
                "provider": "octopus",
                "octopus_api_key": legacy_octopus["api_key"],
                "octopus_account_number": legacy_octopus.get("account_number"),
                "octopus_tariff_code": legacy_octopus["gas_tariff_code"],
            }
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
    return {fuel: _build_provider(fuel, energy_config) for fuel in fuels_in_use}


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
            return FixedRateProvider(fuel, value=fuel_section["fixed_rate"])

    if fuel == "gas":
        if provider_kind == "octopus":
            # Local import: avoids circular imports between qsh.tariff and
            # qsh.tariff.octopus_gas (the provider module imports types
            # from this package root).
            from qsh.tariff.octopus_gas import OctopusGasProvider
            return OctopusGasProvider(energy_config)
        if provider_kind == "fixed":
            return FixedRateProvider(fuel, value=fuel_section["fixed_rate"])

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
    "fuel_for_source",
    "create_tariff_providers",
    "FixedRateProvider",
    "FallbackProvider",
]
