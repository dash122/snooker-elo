export type AvailabilityEvent =
  | "availability_view"
  | "availability_date_select"
  | "availability_composer_open"
  | "availability_slot_draft_add"
  | "availability_validation_error"
  | "availability_overnight_created"
  | "availability_slot_publish"
  | "availability_slot_edit"
  | "availability_slot_cancel";

// Intentionally transport-free until the club selects an analytics provider.
// Keeping the callsite contract now avoids coupling the UI to a vendor later.
export function trackAvailabilityEvent(_event: AvailabilityEvent) {}
