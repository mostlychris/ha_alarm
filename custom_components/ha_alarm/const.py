DOMAIN = "ha_alarm"
PLATFORM = "alarm_control_panel"

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
