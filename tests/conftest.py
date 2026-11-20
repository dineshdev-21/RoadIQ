import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

SAMPLE_SENSOR = {
    "vehicle_speed": 45.0,
    "imu_z_rms": 1.5,
    "gyro_x_peak": 22.0,
    "peak_frequency": 14.0,
    "kurtosis": 5.5,
    "suspension_deflection_d": 18.0,
    "suspension_onset_rate_r": 1.2,
    "visual_confidence": 0.94,
}

SAMPLE_LOW_RISK = {
    "vehicle_speed": 30.0,
    "imu_z_rms": 0.75,
    "gyro_x_peak": 8.0,
    "peak_frequency": 4.0,
    "kurtosis": 2.5,
    "suspension_deflection_d": 5.0,
    "suspension_onset_rate_r": 0.25,
    "visual_confidence": 0.85,
}
