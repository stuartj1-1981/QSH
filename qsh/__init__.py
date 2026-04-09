"""
QSH Provider Abstraction Layer

Defines platform-agnostic interfaces for sensor reading, actuator control,
and state publishing. The engine talks to these interfaces; concrete
implementations (HA, BACnet, MQTT, etc.) live in separate modules.

Usage:
    from providers import PlatformProvider, SystemSnapshot
    from providers.mock_provider import create_mock_provider

    # For testing:
    provider = create_mock_provider(HOUSE_CONFIG)
    snapshot = provider.sensors.get_snapshot()

    # For production (future):
    from providers.ha_provider import create_ha_provider
    provider = create_ha_provider(HOUSE_CONFIG)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional
from datetime import datetime


# =============================================================================
# DATA CLASSES - What crosses the provider boundary
# =============================================================================


@dataclass
class RoomSnapshot:
    """All sensor data for a single room at a point in time."""

    temperature: float  # Current room temp (°C)
    target_temperature: float  # Current setpoint (°C)
    valve_position: float  # 0-100% (heating percentage)
    independent_sensor: Optional[float] = None  # Independent sensor reading if available
    sensor_source: str = "unknown"  # 'independent', 'climate', 'fallback'


@dataclass
class HeatPumpSnapshot:
    """Heat pump operating status."""

    flow_temperature: float = 35.0  # Primary flow temp (°C)
    power_input_kw: float = 0.0  # Electrical input (kW)
    heat_output_kw: float = 0.0  # Heat output (kW)
    cop: float = 3.5  # Coefficient of performance
    delta_t: float = 3.0  # Flow-return temperature difference (°C)
    hot_water_active: bool = False  # DHW heating active


@dataclass
class EnergySnapshot:
    """Energy system status."""

    battery_soc: float = 50.0  # Battery state of charge (%)
    solar_production_kw: float = 0.0  # Solar generation (kW)
    grid_power_kw: float = 0.0  # Grid power (kW, negative = exporting)

    @property
    def excess_solar_kw(self) -> float:
        return max(0.0, self.solar_production_kw)

    @property
    def export_kw(self) -> float:
        return max(0.0, -self.grid_power_kw) if self.grid_power_kw < 0 else 0.0


@dataclass
class WeatherSnapshot:
    """External conditions."""

    outdoor_temperature: float = 0.0  # Outside temp (°C)


@dataclass
class ElectricityRate:
    """Single electricity tariff period."""

    start: str  # ISO datetime
    end: str  # ISO datetime
    value_inc_vat: float  # p/kWh including VAT


@dataclass
class SystemSnapshot:
    """
    Complete system state at a point in time.

    This is the primary data object that crosses the provider boundary.
    All sensor reads are batched into a single snapshot for consistency -
    the engine works with a coherent point-in-time view rather than
    individual reads that might span several seconds.
    """

    rooms: Dict[str, RoomSnapshot] = field(default_factory=dict)
    heat_pump: HeatPumpSnapshot = field(default_factory=HeatPumpSnapshot)
    energy: EnergySnapshot = field(default_factory=EnergySnapshot)
    weather: WeatherSnapshot = field(default_factory=WeatherSnapshot)
    flow_min: float = 30.0  # Flow temp lower limit (°C)
    flow_max: float = 50.0  # Flow temp upper limit (°C)
    timestamp: Optional[datetime] = None

    # Convenience accessors to match existing SensorData patterns
    @property
    def outdoor_temp(self) -> float:
        return self.weather.outdoor_temperature

    @property
    def room_temps(self) -> Dict[str, float]:
        return {name: room.temperature for name, room in self.rooms.items()}

    @property
    def heating_percs(self) -> Dict[str, float]:
        return {name: room.valve_position for name, room in self.rooms.items()}

    @property
    def avg_open_frac(self) -> float:
        if not self.rooms:
            return 0.0
        return sum(r.valve_position / 100.0 for r in self.rooms.values()) / len(self.rooms)

    @property
    def independent_sensors(self) -> Dict[str, float]:
        """Returns independent sensor readings keyed by sensor_key for backward compat."""
        # This will need config context to map properly - placeholder
        return {}


# =============================================================================
# COMMAND TYPES - What the engine tells the provider to do
# =============================================================================


class HeatPumpMode(Enum):
    OFF = "off"
    HEAT = "heat"


@dataclass
class SetpointCommand:
    """Set a room's TRV setpoint (indirect control)."""

    room: str
    temperature: float
    entity_id: str = ""  # Resolved by provider from config


@dataclass
class ValveCommand:
    """Set a room's valve position (direct control)."""

    room: str
    position: float  # 0-100%
    hardware_type: str = "generic"  # 'direct_type1', 'direct_type2', 'generic'


@dataclass
class FlowCommand:
    """Set heat pump flow temperature."""

    temperature: float
    weather_comp: bool = False
    wc_min: float = 30.0
    wc_max: float = 50.0


@dataclass
class ModeCommand:
    """Set heat pump operating mode."""

    mode: HeatPumpMode


# =============================================================================
# PROVIDER INTERFACES (ABCs)
# =============================================================================


class SensorProvider(ABC):
    """
    Reads all sensor data from the platform.

    The key design decision: get_snapshot() batches ALL sensor reads into
    a single call. This gives the engine a consistent point-in-time view
    and makes the provider responsible for handling partial failures
    (e.g., one TRV offline).
    """

    @abstractmethod
    def get_snapshot(self) -> SystemSnapshot:
        """
        Fetch complete system state.

        Implementations must handle:
        - Individual sensor timeouts (return defaults, flag in sensor_source)
        - Partial failures (return what's available, log warnings)
        - Rate limiting (cache if called too frequently)

        Returns:
            SystemSnapshot with all available data populated
        """
        ...

    @abstractmethod
    def is_control_enabled(self) -> bool:
        """Check if QSH active control is enabled (vs shadow mode)."""
        ...

    @abstractmethod
    def get_electricity_rates(self) -> List[ElectricityRate]:
        """
        Fetch current electricity tariff rates.

        Returns:
            List of ElectricityRate periods, sorted by start time
        """
        ...


class ActuatorProvider(ABC):
    """
    Sends control commands to the platform.

    All methods are fire-and-forget with boolean success return.
    The provider handles retries, timeouts, and hardware-specific quirks
    (e.g., Tado vs Sonoff TRV differences).
    """

    @abstractmethod
    def set_room_setpoint(self, cmd: SetpointCommand) -> bool:
        """Set TRV setpoint for indirect room control."""
        ...

    @abstractmethod
    def set_valve_position(self, cmd: ValveCommand) -> bool:
        """Set valve position for direct room control."""
        ...

    @abstractmethod
    def set_flow_temperature(self, cmd: FlowCommand) -> bool:
        """Set heat pump flow temperature."""
        ...

    @abstractmethod
    def set_heat_pump_mode(self, cmd: ModeCommand) -> bool:
        """Set heat pump operating mode (heat/off)."""
        ...

    @abstractmethod
    def emergency_failsafe(self) -> bool:
        """
        Emergency shutdown - set HP to safe state.

        This is the ONE method that should be as simple and direct
        as possible. Implementations should minimise abstraction layers
        between this call and the actual hardware command.

        Returns:
            True if failsafe was applied successfully
        """
        ...


class StateProvider(ABC):
    """
    Publishes QSH internal state for monitoring/dashboards.

    In HA this maps to shadow entities (input_number.qsh_*).
    Other platforms might use MQTT topics, REST endpoints, etc.
    """

    @abstractmethod
    def publish_metric(self, key: str, value, metric_type: str = "number") -> bool:
        """
        Publish a single metric value.

        Args:
            key: Metric identifier (e.g., 'total_demand', 'shadow_flow',
                 'optimal_mode', 'room_setpoint.lounge')
            value: The value (float for numbers, str for selects)
            metric_type: 'number' or 'select'

        Returns:
            True if published successfully
        """
        ...

    @abstractmethod
    def publish_snapshot(self, metrics: Dict[str, any]) -> bool:
        """
        Publish multiple metrics at once.

        Args:
            metrics: Dict of {key: value} pairs

        Returns:
            True if all published successfully
        """
        ...


# =============================================================================
# PLATFORM PROVIDER - Container
# =============================================================================


class PlatformProvider:
    """
    Container for all provider interfaces.

    This is what gets passed to sim_step() and other engine functions.

    Usage:
        provider = PlatformProvider(
            sensors=HASensorProvider(config),
            actuators=HAActuatorProvider(config),
            state=HAStateProvider(config)
        )

        snapshot = provider.sensors.get_snapshot()
        provider.actuators.set_flow_temperature(FlowCommand(35.0))
        provider.state.publish_metric('total_demand', 2.5)
    """

    def __init__(self, sensors: SensorProvider, actuators: ActuatorProvider, state: StateProvider):
        self.sensors = sensors
        self.actuators = actuators
        self.state = state
