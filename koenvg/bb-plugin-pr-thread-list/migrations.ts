import { PARK_MIGRATIONS } from "./park-store";
import { SNOOZE_MIGRATIONS } from "./snooze-store";

// Statement index is the migration id, so this list is append-only.
export const MIGRATIONS = [...SNOOZE_MIGRATIONS, ...PARK_MIGRATIONS];
