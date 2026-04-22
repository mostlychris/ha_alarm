DOMAIN = "ha_alarm"
PLATFORM = "alarm_control_panel"

# Shared flag so API saves don't trigger an integration reload
API_UPDATE_FLAG = "api_update"

# Arm modes (match HA state strings)
MODE_AWAY = "armed_away"
MODE_HOME = "armed_home"
MODE_NIGHT = "armed_night"
MODE_VACATION = "armed_vacation"
MODE_CUSTOM = "armed_custom_bypass"

ALL_MODES = [MODE_AWAY, MODE_HOME, MODE_NIGHT, MODE_VACATION, MODE_CUSTOM]

# Config keys
CONF_CODES = "codes"
CONF_CODE_NAME = "name"
CONF_CODE_VALUE = "code"
CONF_CODE_IS_ADMIN = "is_admin"
CONF_CODE_SALT = "salt"

CONF_SENSORS = "sensors"

CONF_DELAYS = "delays"
CONF_ENTRY_DELAY = "entry_delay"
CONF_EXIT_DELAY = "exit_delay"

CONF_CODE_ARM_REQUIRED = "code_arm_required"
CONF_TRIGGER_TIME = "trigger_time"
CONF_DISARM_AFTER_TRIGGER = "disarm_after_trigger"
CONF_SIREN_ENTITY = "siren_entity"
CONF_SIREN_TONE = "siren_tone"
CONF_CHIME_TONE = "chime_tone"

CONF_BYPASSED_SENSORS = "bypassed_sensors"
BYPASS_ONE_CYCLE = 0    # cleared automatically on next disarm
BYPASS_INDEFINITE = -1  # until manually cleared

CONF_CHIME_MODE = "chime_mode"
CONF_CHIME_SENSORS = "chime_sensors"

CONF_SIREN_VOLUME = "siren_volume"   # float 0.0-1.0; 0.0 = don't override device default
CONF_CHIME_VOLUME = "chime_volume"   # float 0.0-1.0; 0.0 = don't override device default

DEFAULT_TRIGGER_TIME = 600  # 10 minutes

CONF_NOTIFICATIONS = "notifications"
CONF_NOTIFY_TARGETS = "notify_targets"
CONF_NOTIFY_EVENTS = "notify_events"

# Notification events
EVENT_ARMING = "arming"
EVENT_ARMED = "armed"
EVENT_TRIGGERED = "triggered"
EVENT_DISARMED = "disarmed"
EVENT_DISARMING = "disarming"
EVENT_PENDING = "pending"
EVENT_FAILED = "failed"

ALL_EVENTS = [
    EVENT_ARMING,
    EVENT_ARMED,
    EVENT_TRIGGERED,
    EVENT_DISARMED,
    EVENT_DISARMING,
    EVENT_PENDING,
    EVENT_FAILED,
]

# Default delays in seconds
DEFAULT_ENTRY_DELAY = 30
DEFAULT_EXIT_DELAY = 60

# Typical binary_sensor device classes per arm mode.
# None means no filter (show all).
MODE_SENSOR_CLASSES: dict[str, list[str] | None] = {
    # Perimeter only — you're inside so motion sensors would cause false trips
    MODE_HOME: ["door", "window", "garage_door", "opening", "lock"],
    # All perimeter + interior detection
    MODE_AWAY: [
        "door", "window", "garage_door", "opening", "lock",
        "motion", "occupancy", "presence", "vibration", "tamper",
    ],
    # Perimeter + entry-point motion (e.g. hallway/stairwell)
    MODE_NIGHT: ["door", "window", "garage_door", "opening", "lock", "motion"],
    # Everything including safety sensors for extended absence
    MODE_VACATION: [
        "door", "window", "garage_door", "opening", "lock",
        "motion", "occupancy", "presence", "vibration", "tamper",
        "smoke", "carbon_monoxide", "moisture",
    ],
    MODE_CUSTOM: None,
}
