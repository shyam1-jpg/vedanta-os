-- One open or sent letter per booking and kind, and the same for a staff enquiry alert.
-- A cancelled row drops out of the index so a changed date can queue a fresh reminder.

CREATE UNIQUE INDEX IF NOT EXISTS auto_comm_group_kind_once
  ON auto_comm (group_id, kind)
  WHERE group_id IS NOT NULL AND cancelled_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS auto_comm_enquiry_kind_once
  ON auto_comm (enquiry_id, kind)
  WHERE enquiry_id IS NOT NULL AND cancelled_at IS NULL;
