"""qsh.swarm — Quantum Swarm telemetry-cadence foundation.

INSTRUCTION-263A V5 (Bucket 8.2). Ships the SQLite local persistent queue,
HTTP publisher, two outbound packet builders (State / Disturbance), runtime
singleton holding queue + publisher + detector, and the pipeline controller
that drives per-cycle cadence + event detection.

The retirement of the legacy daily-batch path (qsh/telemetry.py) is
INSTRUCTION-263B's responsibility — 263A leaves it untouched.
"""
