"""qsh.swarm.builders — Packet builders for swarm outbound traffic.

State / Disturbance / Parameter / Health packet builders + derivation helpers
(operating-state, seasonal-mode, occupancy-state mapping). INSTRUCTION-263A V5
shipped the first three; INSTRUCTION-274B adds the fourth (Health), an
event-driven builder + stateless allostatic-excursion → HealthPacket mapper.
"""
