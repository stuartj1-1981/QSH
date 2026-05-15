"""Driver-specific forecast provider implementations.

Each provider satisfies the ForecastProvider Protocol declared in
qsh.forecast.provider. Transport and provider-shape parsing for the
specific data source live inside the provider module. The pipeline
layer is driver-agnostic by construction.
"""
