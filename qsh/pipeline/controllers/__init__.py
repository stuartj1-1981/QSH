"""
Pipeline controllers — one per functional domain.

Controller execution order follows the phase numbering from sim_step
and preserves data dependencies:

   1. SensorController    (Phases 1-3, 1E)  — fetch sensors, detect HW, staleness
   2. ThermalController   (Phase 5)         — thermal model, demand, solar
   3. EnergyController    (Phase 4)         — tariff rate fetching
   4. ForecastController                    — weather forecast + pre-charge
   5. CycleController     (Phase 7, 7B)     — cycle detection, COP, balancing
   6. ValveController     (Phase 8)         — dissipation, hybrid room control
   7. AntifrostOverrideController             — antifrost off-decision suppression
   8. ShoulderController  (Phase 1E ext)    — shoulder season shutdown/restart
   9. SummerController    (Phase 1E ext)    — summer mode graduated monitoring
   9. HWController                          — hot water awareness + pre-charge
  10. CascadeController   (C4a)             — outer-loop PI cascade control
  11. FlowController      (Phase 9)         — optimal flow + HP mode (C4 WC fallback)
  12. RLController         (Phases 0,6,10-12) — RL state, reward, training
  13. HardwareController  (Phases 13-14)    — urgency, debounce, apply hardware
  14. ShadowController   (Phase 15)        — dashboard shadow entities
  15. CostController     (Phase 15B)       — electricity cost tracking
"""

from .boost_controller import BoostController
from .sensor_controller import SensorController
from .thermal_controller import ThermalController
from .energy_controller import EnergyController
from .forecast_controller import ForecastController
from .cycle_controller import CycleController
from .valve_controller import ValveController
from .hydraulic_controller import HydraulicController
from .antifrost_override import AntifrostOverrideController
from .shoulder_controller import ShoulderController
from .summer_controller import SummerController
from .hw_controller import HWController
from .cascade_controller import CascadeController
from .auxiliary_output_controller import AuxiliaryOutputController
from .flow_controller import FlowController
from .rl_controller import RLController
from .source_selection import SourceSelectionController
from .hardware_controller import HardwareController
from .shadow_controller import ShadowController
from .cost_controller import CostController
from .historian_controller import HistorianController
from .tariff_optimiser import TariffOptimiserController

__all__ = [
    "BoostController",
    "SensorController",
    "ThermalController",
    "EnergyController",
    "ForecastController",
    "CycleController",
    "ValveController",
    "HydraulicController",
    "AntifrostOverrideController",
    "ShoulderController",
    "SummerController",
    "HWController",
    "CascadeController",
    "AuxiliaryOutputController",
    "FlowController",
    "RLController",
    "SourceSelectionController",
    "HardwareController",
    "ShadowController",
    "CostController",
    "HistorianController",
    "TariffOptimiserController",
]
